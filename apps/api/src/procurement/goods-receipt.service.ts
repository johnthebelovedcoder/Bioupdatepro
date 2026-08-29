import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AuditAction,
  GrnStatus,
  ItemType,
  Prisma,
  PurchaseOrderStatus,
  QualityStatus,
  StockDirection,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { ProcurementConfigService } from './procurement-config.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

export interface GrnLineInput {
  purchaseOrderLineId: string;
  /** QUANTITY physically delivered. */
  receivedQuantity: Decimal.Value;
  /** QUANTITY refused on inspection. Never enters stock or GRNI. */
  rejectedQuantity?: Decimal.Value;
  batchReference?: string | null;
  expiryDate?: Date | null;
}

/**
 * Goods Receipt Note (§5).
 *
 * Posts `Dr Inventory / Cr GRNI` for inventory items. Expense items post
 * nothing here — §5 says they "await the supplier invoice", which is right: an
 * expense is incurred when billed, not when a box arrives.
 *
 * GRNI is a holding account meaning "we have the goods but not the bill". The
 * supplier invoice later debits it to clear. That is what stops inventory being
 * recognised twice, and it is why the GRNI balance for a fully received and
 * invoiced order must return to exactly zero.
 *
 * Rejected quantities are excluded from both stock and GRNI: goods refused on
 * inspection were never ours to owe for.
 */
@Injectable()
export class GoodsReceiptService {
  private readonly logger = new Logger(GoodsReceiptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly config: ProcurementConfigService,
  ) {}

  async create(input: {
    purchaseOrderId: string;
    grnNumber: string;
    receiptDate: Date;
    financialYearId: string;
    financialPeriodId: string;
    deliveryNoteReference?: string | null;
    qualityStatus?: QualityStatus;
    lines: GrnLineInput[];
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: input.purchaseOrderId },
      include: { lines: { include: { item: true } } },
    });

    const receivable: PurchaseOrderStatus[] = [
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
    ];
    if (!receivable.includes(order.status)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Goods receipt',
        `Purchase order ${order.orderNumber} is ${order.status}. Goods are only received ` +
          `against an approved order.`,
        { orderNumber: order.orderNumber, status: order.status },
      );
    }

    const settings = await this.config.resolve(order.companyId, input.receiptDate);
    const lineById = new Map(order.lines.map((l) => [l.id, l]));

    const prepared: Prisma.GoodsReceiptNoteLineCreateManyGoodsReceiptNoteInput[] = [];
    let totalValue = 0n;
    let lineNumber = 1;
    const toleranceFindings: string[] = [];

    for (const line of input.lines) {
      const orderLine = lineById.get(line.purchaseOrderLineId);
      if (!orderLine) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Goods receipt',
          `Line ${line.purchaseOrderLineId} does not belong to order ${order.orderNumber}.`,
          { orderNumber: order.orderNumber },
        );
      }

      const received = new Decimal(line.receivedQuantity.toString());
      const rejected = new Decimal((line.rejectedQuantity ?? 0).toString());

      if (received.lessThanOrEqualTo(0)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Goods receipt',
          `Received quantity must be positive; got ${received.toString()}.`,
          {},
        );
      }
      if (rejected.greaterThan(received)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Goods receipt',
          `Cannot reject ${rejected.toFixed(6)} of ${received.toFixed(6)} received.`,
          {},
        );
      }

      const ordered = new Decimal(orderLine.quantity.toString());
      const alreadyReceived = new Decimal(orderLine.receivedQuantity.toString());
      const tolerance = new Decimal(settings.overReceiptTolerancePercent.toString()).div(100);
      const ceiling = ordered.mul(new Decimal(1).plus(tolerance));

      // Over tolerance is flagged, not refused (US-897-007) — the same
      // "exceptions require approval, not rejection" rule §5 already applies
      // to a three-way match exception. `submit` routes a flagged GRN through
      // the tighter exception ladder instead of the standard one.
      if (alreadyReceived.plus(received).greaterThan(ceiling)) {
        toleranceFindings.push(
          `Line ${orderLine.lineNumber}: ${alreadyReceived.plus(received).toFixed(6)} against ` +
            `${ordered.toFixed(6)} ordered (tolerance ${settings.overReceiptTolerancePercent.toString()}%).`,
        );
      }

      const accepted = received.minus(rejected);
      const value = BigInt(
        new Decimal(orderLine.unitPriceKobo.toString())
          .mul(accepted)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toFixed(0),
      );

      // Only inventory items carry value into stock and GRNI at receipt.
      if (orderLine.item.itemType === ItemType.INVENTORY) totalValue += value;

      prepared.push({
        lineNumber: lineNumber++,
        purchaseOrderLineId: orderLine.id,
        itemId: orderLine.itemId,
        orderedQuantity: orderLine.quantity,
        receivedQuantity: new Prisma.Decimal(received.toFixed(6)),
        rejectedQuantity: new Prisma.Decimal(rejected.toFixed(6)),
        acceptedQuantity: new Prisma.Decimal(accepted.toFixed(6)),
        unitPriceKobo: orderLine.unitPriceKobo,
        valueKobo: value,
        batchReference: line.batchReference ?? null,
        expiryDate: line.expiryDate ?? null,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const grn = await tx.goodsReceiptNote.create({
        data: {
          companyId: order.companyId,
          grnNumber: input.grnNumber,
          purchaseOrderId: order.id,
          supplierId: order.supplierId,
          receiptDate: input.receiptDate,
          warehouseId: order.warehouseId,
          branchId: order.branchId,
          deliveryNoteReference: input.deliveryNoteReference ?? null,
          qualityStatus: input.qualityStatus ?? QualityStatus.PENDING,
          totalValueKobo: totalValue,
          overTolerance: toleranceFindings.length > 0,
          toleranceNote: toleranceFindings.length > 0 ? toleranceFindings.join(' ') : null,
          financialYearId: input.financialYearId,
          financialPeriodId: input.financialPeriodId,
          currencyId: order.currencyId,
          createdById: input.actor.userId,
          lines: { createMany: { data: prepared } },
        },
        include: { lines: true },
      });

      await this.audit.write(
        {
          transactionId: grn.id,
          module: 'procurement',
          entityType: 'GoodsReceiptNote',
          entityId: grn.id,
          status: grn.status,
          action: AuditAction.CREATE,
          userId: input.actor.userId,
          comments:
            toleranceFindings.length > 0
              ? `Received goods on ${grn.grnNumber} against ${order.orderNumber} — over tolerance: ${toleranceFindings.join(' ')}`
              : `Received goods on ${grn.grnNumber} against ${order.orderNumber}.`,
        },
        tx,
      );

      return grn;
    });
  }

  async submit(params: { grnId: string; actor: WorkflowActor }) {
    const grn = await this.prisma.goodsReceiptNote.findUniqueOrThrow({
      where: { id: params.grnId },
      include: { lines: true },
    });

    if (grn.status !== GrnStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Goods receipt',
        `${grn.grnNumber} is ${grn.status} and cannot be submitted.`,
        { grnNumber: grn.grnNumber },
      );
    }

    // §5 lists Quality Inspection Status on the GRN. Goods still pending
    // inspection have not been accepted, so they must not enter stock.
    if (grn.qualityStatus === QualityStatus.PENDING) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Goods receipt',
        `${grn.grnNumber} is still awaiting quality inspection. Goods that have not been ` +
          `inspected have not been accepted, and must not enter stock.`,
        { grnNumber: grn.grnNumber },
      );
    }

    const settings = await this.config.resolve(grn.companyId, grn.receiptDate);
    const transactionType = grn.overTolerance
      ? settings.grnExceptionTransactionType
      : settings.grnTransactionType;

    const result = await this.workflow.submit({
      companyId: grn.companyId,
      transactionType,
      module: 'procurement',
      documentType: 'GoodsReceiptNote',
      documentId: grn.id,
      documentReference: grn.grnNumber,
      amount: kobo(grn.totalValueKobo),
      currencyId: grn.currencyId,
      branchId: grn.branchId,
      actor: params.actor,
      comments: grn.overTolerance ? `Over-receipt tolerance exceeded: ${grn.toleranceNote}` : null,
    });

    await this.prisma.goodsReceiptNote.update({
      where: { id: grn.id },
      data: {
        status: GrnStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return { ...result, routedAs: transactionType };
  }

  /**
   * Post the receipt: `Dr Inventory / Cr GRNI` for inventory lines.
   *
   * Expense lines record the stock movement of nothing and post nothing —
   * their cost arrives with the invoice.
   */
  async postApproved(params: {
    grnId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string | null }> {
    const grn = await params.tx.goodsReceiptNote.findUniqueOrThrow({
      where: { id: params.grnId },
      include: {
        lines: { include: { item: true } },
        purchaseOrder: true,
      },
    });

    if (grn.status === GrnStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${grn.grnNumber} is already posted.`,
        { grnNumber: grn.grnNumber },
      );
    }

    const settings = await this.config.resolve(
      grn.companyId,
      grn.receiptDate,
      params.tx,
    );

    const dimensions = {
      companyId: grn.companyId,
      branchId: grn.branchId,
      financialYearId: grn.financialYearId,
      financialPeriodId: grn.financialPeriodId,
      currencyId: grn.currencyId,
      exchangeRate: '1.00000000',
    };
    const lineDimensions = {
      ...dimensions,
      costCentreId: grn.purchaseOrder.costCentreId,
      farmId: grn.purchaseOrder.farmId,
      departmentId: grn.purchaseOrder.departmentId,
      supplierId: grn.supplierId,
    };

    const inventoryLines = grn.lines.filter(
      (line) => line.item.itemType === ItemType.INVENTORY && line.valueKobo > 0n,
    );

    let journalEntryId: string | null = null;

    if (inventoryLines.length > 0) {
      const total = inventoryLines.reduce((s, l) => s + l.valueKobo, 0n);

      /*
       * Every stocked line must name the account its value lands in.
       *
       * This used to fall back to GRNI when an item had no inventory account,
       * which put the debit and the credit on the same account: a journal that
       * balanced, passed every check, posted cleanly and recorded nothing. The
       * stock never appeared on the balance sheet and the GRNI liability
       * cancelled itself out, so the one control this posting exists to create
       * was silently absent.
       *
       * There is no safe guess here. An item's inventory account is a decision
       * about where the farm's money sits, and refusing by name is the only
       * honest answer.
       */
      const unmapped = inventoryLines.filter((line) => !line.item.inventoryGlAccountId);
      if (unmapped.length > 0) {
        const codes = [...new Set(unmapped.map((line) => line.item.code))];
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Goods receipt',
          `${codes.join(', ')} ${codes.length === 1 ? 'has' : 'have'} no stock account, so ` +
            `there is nowhere to debit the goods received on ${grn.grnNumber}. Set the ` +
            `stock account on ${codes.length === 1 ? 'the item' : 'those items'} under ` +
            `Setup → Items, then approve this receipt again.`,
          { grnNumber: grn.grnNumber, itemCodes: codes },
        );
      }

      const lines: Array<{
        glAccountId: string;
        description: string;
        debit?: bigint;
        credit?: bigint;
        itemId: string | null;
      }> = [
        ...inventoryLines.map((line) => ({
          glAccountId: line.item.inventoryGlAccountId!,
          description: `Goods received — ${line.item.code}`,
          debit: line.valueKobo,
          itemId: line.itemId,
        })),
        {
          glAccountId: settings.grniGlAccountId,
          description: `Goods received not invoiced — ${grn.grnNumber}`,
          credit: total,
          itemId: null,
        },
      ];

      const result = await this.posting.post(
        {
          sourceModule: 'procurement',
          sourceDocumentType: 'GoodsReceiptNote',
          sourceDocumentId: grn.id,
          journalNumber: grn.grnNumber,
          journalDate: grn.receiptDate,
          narration: `Goods receipt ${grn.grnNumber}`,
          ...dimensions,
          idempotencyKey: `grn:${grn.id}`,
          actor: params.actor,
          lines: lines.map((line) => ({
            glAccountId: line.glAccountId,
            description: line.description,
            debit: line.debit !== undefined ? kobo(line.debit) : undefined,
            credit: line.credit !== undefined ? kobo(line.credit) : undefined,
            dimensions: { ...lineDimensions, itemId: line.itemId },
          })),
        },
        params.tx,
      );
      journalEntryId = result.journalEntryId;
    }

    // The inward side of the stock ledger — the half that has been missing
    // since Phase 8 introduced it.
    for (const line of grn.lines) {
      if (line.item.itemType !== ItemType.INVENTORY) continue;
      const accepted = new Decimal(line.acceptedQuantity.toString());
      if (accepted.lessThanOrEqualTo(0)) continue;

      // The moving weighted-average cost, from on-hand quantity/value just
      // before this receipt lands — before the movement below is created, or
      // this receipt would be averaged against itself.
      await this.advanceWeightedAverageCost({
        tx: params.tx,
        companyId: grn.companyId,
        itemId: line.itemId,
        receivedQuantity: accepted,
        receivedValueKobo: line.valueKobo,
      });

      await params.tx.stockMovement.create({
        data: {
          companyId: grn.companyId,
          branchId: grn.branchId,
          itemId: line.itemId,
          warehouseId: grn.warehouseId,
          direction: StockDirection.IN,
          quantity: line.acceptedQuantity,
          unitCostKobo: line.unitPriceKobo,
          valueKobo: line.valueKobo,
          batchReference: line.batchReference,
          sourceModule: 'procurement',
          sourceDocumentType: 'GoodsReceiptNote',
          sourceDocumentId: grn.id,
          documentReference: grn.grnNumber,
          movementDate: grn.receiptDate,
          journalEntryId,
        },
      });
    }

    // Advance received quantities on the order.
    for (const line of grn.lines) {
      const orderLine = await params.tx.purchaseOrderLine.findUniqueOrThrow({
        where: { id: line.purchaseOrderLineId },
      });
      await params.tx.purchaseOrderLine.update({
        where: { id: line.purchaseOrderLineId },
        data: {
          receivedQuantity: new Prisma.Decimal(
            new Decimal(orderLine.receivedQuantity.toString())
              .plus(new Decimal(line.acceptedQuantity.toString()))
              .toFixed(6),
          ),
        },
      });
    }

    /*
     * And move the order itself on.
     *
     * The line quantities above were being advanced while the order's own
     * status sat unchanged at APPROVED, so an order whose goods had all
     * arrived still read as one still waiting for them — and, worse, remained
     * receivable, because the receivable check reads this field. Written here,
     * inside the posting transaction, because that is the moment it becomes
     * true; a fully received order and an unposted journal must never both
     * exist.
     */
    const lines = await params.tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: grn.purchaseOrderId },
      select: { quantity: true, receivedQuantity: true },
    });
    const allReceived = lines.every((line) =>
      new Decimal(line.receivedQuantity.toString()).greaterThanOrEqualTo(
        new Decimal(line.quantity.toString()),
      ),
    );
    await params.tx.purchaseOrder.update({
      where: { id: grn.purchaseOrderId },
      data: {
        status: allReceived
          ? PurchaseOrderStatus.FULLY_RECEIVED
          : PurchaseOrderStatus.PARTIALLY_RECEIVED,
      },
    });

    await params.tx.goodsReceiptNote.update({
      where: { id: grn.id },
      data: {
        status: GrnStatus.POSTED,
        journalEntryId,
        postedAt: new Date(),
      },
    });

    this.logger.log(`Posted goods receipt ${grn.grnNumber}`);
    return { journalEntryId };
  }

  /**
   * Roll the item's moving weighted-average cost forward by one receipt
   * (US-897-007) — the same materialised-balance discipline
   * `LivestockGroup.population` uses: computed from on-hand quantity/value
   * summed across every existing stock movement, never adjusted directly.
   *
   * Company-wide per item, not per warehouse — the same scope
   * ItemStandardCost already uses, so this sits beside it as a second, ACTUAL
   * figure rather than a third granularity nothing else in the product has.
   */
  private async advanceWeightedAverageCost(params: {
    tx: Prisma.TransactionClient;
    companyId: string;
    itemId: string;
    receivedQuantity: Decimal;
    receivedValueKobo: bigint;
  }): Promise<void> {
    const priorMovements = await params.tx.stockMovement.findMany({
      where: { companyId: params.companyId, itemId: params.itemId },
      select: { direction: true, quantity: true, valueKobo: true },
    });

    let priorQuantity = new Decimal(0);
    let priorValueKobo = 0n;
    for (const movement of priorMovements) {
      const sign = movement.direction === StockDirection.IN ? 1 : -1;
      priorQuantity = priorQuantity.plus(new Decimal(movement.quantity.toString()).mul(sign));
      priorValueKobo += movement.valueKobo * BigInt(sign);
    }

    const newQuantity = priorQuantity.plus(params.receivedQuantity);
    if (newQuantity.lessThanOrEqualTo(0)) return; // Nothing on hand to average.

    const newValueKobo = priorValueKobo + params.receivedValueKobo;
    const newWac = BigInt(
      new Decimal(newValueKobo.toString())
        .div(newQuantity)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toFixed(0),
    );

    await params.tx.item.update({
      where: { id: params.itemId },
      data: { weightedAverageCostKobo: newWac, weightedAverageCostSetAt: new Date() },
    });
  }

  /**
   * The GRNI balance outstanding on a purchase order.
   *
   * This is the phase's identity made queryable: goods accepted but not yet
   * invoiced, at purchase-order price. For an order fully received and fully
   * invoiced it must be exactly zero.
   */
  async grniBalance(purchaseOrderId: string): Promise<{
    outstandingKobo: string;
    lines: Array<{
      grnNumber: string;
      itemCode: string;
      acceptedQuantity: string;
      invoicedQuantity: string;
      outstandingKobo: string;
    }>;
  }> {
    const lines = await this.prisma.goodsReceiptNoteLine.findMany({
      where: {
        goodsReceiptNote: { purchaseOrderId, status: GrnStatus.POSTED },
        item: { itemType: ItemType.INVENTORY },
      },
      include: {
        goodsReceiptNote: { select: { grnNumber: true } },
        item: { select: { code: true } },
      },
    });

    let outstanding = 0n;
    const detail = lines.map((line) => {
      const uninvoiced = new Decimal(line.acceptedQuantity.toString()).minus(
        new Decimal(line.invoicedQuantity.toString()),
      );
      const value = BigInt(
        new Decimal(line.unitPriceKobo.toString())
          .mul(uninvoiced)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toFixed(0),
      );
      outstanding += value;

      return {
        grnNumber: line.goodsReceiptNote.grnNumber,
        itemCode: line.item.code,
        acceptedQuantity: line.acceptedQuantity.toString(),
        invoicedQuantity: line.invoicedQuantity.toString(),
        outstandingKobo: value.toString(),
      };
    });

    return { outstandingKobo: outstanding.toString(), lines: detail };
  }
}
