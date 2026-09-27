import { Injectable, Logger } from '@nestjs/common';
import { nextReference, siteOf } from '../numbering/numbering';
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
import { StockMovementService } from '../inventory/stock-movement.service';
import { AccountingRuleViolation } from '../common/errors';
import { expiryFromShelfLife, registerLot } from '../inventory/lots';
import { kobo } from '../common/money';
import { assertPenRoom } from '../operations/pen-capacity';

export interface GrnLineInput {
  purchaseOrderLineId: string;
  /** QUANTITY physically delivered. */
  receivedQuantity: Decimal.Value;
  /** QUANTITY refused on inspection. Never enters stock or GRNI. */
  rejectedQuantity?: Decimal.Value;
  batchReference?: string | null;
  expiryDate?: Date | null;
  /** US-897-007. Omit to use the GRN's own header warehouse, same as before. */
  warehouseId?: string | null;
  /** Live animals only: the batch the accepted quantity is placed as. */
  placement?: LivestockPlacement | null;
}

/** Where live animals received on a purchase order go (Test_Environment_Script steps 5 and 12). */
export interface LivestockPlacement {
  /** The new batch's code, e.g. BRD-1. */
  code: string;
  /** The pen or house code. */
  house: string;
  /** The stage they arrive at, e.g. Breeder or Day-old chick. */
  stage: string;
  breed: string;
  purpose?: string | null;
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
    private readonly stockMovements: StockMovementService,
  ) {}

  async create(input: {
    purchaseOrderId: string;
    /** Given by NumberingService when not supplied (Numbering_Parameters). */
    grnNumber?: string;
    receiptDate: Date;
    financialYearId: string;
    financialPeriodId: string;
    deliveryNoteReference?: string | null;
    qualityStatus?: QualityStatus;
    /** Hold everything received in quarantine until QA releases it. */
    quarantine?: boolean;
    lines: GrnLineInput[];
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: input.purchaseOrderId },
      include: { lines: { include: { item: true } } },
    });
    const grnNumber =
      input.grnNumber?.trim() ||
      (await nextReference(this.prisma, {
        companyId: order.companyId,
        type: 'GRN',
        site: await siteOf(this.prisma, { farmId: order.farmId, branchId: order.branchId }),
        date: input.receiptDate,
      }));


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

      // Live animals are placed as a batch, so the receipt has to say where.
      let placement: LivestockPlacement | null = null;
      if (orderLine.item.livestockSpeciesKey) {
        const p = line.placement;
        if (!p?.code?.trim() || !p.house?.trim() || !p.stage?.trim() || !p.breed?.trim()) {
          throw new AccountingRuleViolation(
            'Consolidated Reference §5 — Goods receipt',
            `${orderLine.item.code} is live animals: give the batch code, house, stage and breed they are placed as.`,
            { itemCode: orderLine.item.code },
          );
        }
        if (!accepted.isInteger()) {
          throw new AccountingRuleViolation('Consolidated Reference §5 — Goods receipt', `Animals are counted whole: ${accepted.toString()} accepted.`, {});
        }
        const taken = await this.prisma.livestockGroup.findUnique({ where: { companyId_code: { companyId: order.companyId, code: p.code.trim() } } });
        if (taken) {
          throw new AccountingRuleViolation('UAT-010 — Duplicate cohort', `There is already a batch called ${p.code.trim()}. Give this one another code.`, { code: p.code.trim() });
        }
        placement = { code: p.code.trim(), house: p.house.trim(), stage: p.stage.trim(), breed: p.breed.trim(), purpose: p.purpose?.trim() || null };
      }

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
        warehouseId: line.warehouseId ?? null,
        livestockPlacement: placement ? (placement as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const grn = await tx.goodsReceiptNote.create({
        data: {
          companyId: order.companyId,
          grnNumber,
          purchaseOrderId: order.id,
          supplierId: order.supplierId,
          receiptDate: input.receiptDate,
          warehouseId: order.warehouseId,
          branchId: order.branchId,
          deliveryNoteReference: input.deliveryNoteReference ?? null,
          qualityStatus: input.qualityStatus ?? QualityStatus.PENDING,
          quarantine: input.quarantine === true,
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
      (line) => line.item.itemType === ItemType.INVENTORY && line.valueKobo > 0n && !line.item.livestockSpeciesKey,
    );

    // Live animals: each accepted line becomes a batch, carried at what it cost,
    // and its debit goes to the biological-asset account for its species and stage.
    const livestockDebits = await this.placeLivestock({ tx: params.tx, grn, actor: params.actor });

    let journalEntryId: string | null = null;

    if (inventoryLines.length > 0 || livestockDebits.length > 0) {
      const total = inventoryLines.reduce((s, l) => s + l.valueKobo, 0n) + livestockDebits.reduce((s, l) => s + l.debit, 0n);

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
        farmId?: string;
        penHouseId?: string;
      }> = [
        ...inventoryLines.map((line) => ({
          glAccountId: line.item.inventoryGlAccountId!,
          description: `Goods received — ${line.item.code}`,
          debit: line.valueKobo,
          itemId: line.itemId,
        })),
        ...livestockDebits,
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
            dimensions: { ...lineDimensions, itemId: line.itemId, ...(line.farmId ? { farmId: line.farmId, penHouseId: line.penHouseId } : {}) },
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
      // Animals are a batch, not stock on a shelf.
      if (line.item.livestockSpeciesKey) continue;
      const accepted = new Decimal(line.acceptedQuantity.toString());
      if (accepted.lessThanOrEqualTo(0)) continue;

      /*
       * The lot (handbook §35, FR-FM-02): a line with a lot number, an expiry,
       * a shelf life or a quarantine becomes a lot the issue check knows.
       * Quarantined goods are in the books from now but cannot be issued
       * until QA releases them (Store → Lots and expiry).
       */
      const quarantined = grn.quarantine || line.item.quarantineOnReceipt;
      const expiry = line.expiryDate ?? expiryFromShelfLife(grn.receiptDate, line.item.shelfLifeDays);
      let lotReference = line.batchReference;
      if (lotReference || expiry || quarantined) {
        lotReference = lotReference ?? `${grn.grnNumber}/${line.lineNumber}`;
        await registerLot(params.tx, {
          companyId: grn.companyId,
          itemId: line.itemId,
          lotReference,
          expiryDate: expiry,
          receivedOn: grn.receiptDate,
          quarantine: quarantined,
          sourceType: 'GoodsReceiptNote',
          sourceId: grn.id,
          receivedById: grn.createdById,
        });
        if (!line.batchReference) {
          await params.tx.goodsReceiptNoteLine.update({ where: { id: line.id }, data: { batchReference: lotReference } });
        }
      }

      // The moving weighted-average cost, from on-hand quantity/value just
      // before this receipt lands — before the movement below is created, or
      // this receipt would be averaged against itself.
      await this.stockMovements.advanceWeightedAverageCostOnReceipt({
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
          // US-897-007 — a line can land somewhere other than the GRN's own
          // header warehouse; falls back to it when the line didn't say.
          warehouseId: line.warehouseId ?? grn.warehouseId,
          direction: StockDirection.IN,
          quantity: line.acceptedQuantity,
          unitCostKobo: line.unitPriceKobo,
          valueKobo: line.valueKobo,
          batchReference: lotReference,
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
   * Live animals on a receipt become batches, inside the receipt's own
   * transaction: the batch is created with the accepted count, carried at
   * what it cost (UAT-010/016: code unique, house not overfilled), and the
   * debit for the receipt's journal goes to the biological-asset account for
   * its species and arrival stage — `Dr BA / Cr GRNI`, the same entry a
   * placement with an acquisition cost makes, but matched to the order so
   * the supplier's invoice clears it.
   */
  private async placeLivestock(params: {
    tx: Prisma.TransactionClient;
    grn: Prisma.GoodsReceiptNoteGetPayload<{ include: { lines: { include: { item: true } }; purchaseOrder: true } }>;
    actor: WorkflowActor;
  }) {
    const { tx, grn } = params;
    const debits: Array<{ glAccountId: string; description: string; debit: bigint; itemId: string; farmId: string; penHouseId: string }> = [];
    for (const line of grn.lines) {
      const species = line.item.livestockSpeciesKey;
      if (!species || line.valueKobo <= 0n) continue;
      const placement = line.livestockPlacement as unknown as LivestockPlacement | null;
      if (!placement) {
        throw new AccountingRuleViolation('Consolidated Reference §5 — Goods receipt', `${grn.grnNumber} line ${line.lineNumber}: live animals with no batch to place them as.`, {});
      }
      const count = Number(line.acceptedQuantity.toString());
      if (count <= 0) continue;

      const pen = await tx.penHouse.findFirst({
        where: { code: placement.house, farm: { companyId: grn.companyId } },
        include: { farm: { select: { branchId: true } } },
      });
      if (!pen) {
        throw new AccountingRuleViolation('Consolidated Reference §5 — Goods receipt', `There is no house or pen ${placement.house} to place ${placement.code} in.`, { house: placement.house });
      }
      await assertPenRoom(tx, grn.companyId, pen, count);

      const mapping = await tx.biologicalAssetStageAccount.findUnique({
        where: { companyId_speciesKey_stage: { companyId: grn.companyId, speciesKey: species, stage: placement.stage } },
      });
      if (!mapping?.active) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §67 — Biological asset stage account',
          `No biological-asset account is set for ${species} at ${placement.stage}. Set it under Books → Controls, then approve ${grn.grnNumber} again.`,
          { speciesKey: species, stage: placement.stage },
        );
      }

      const group = await tx.livestockGroup.create({
        data: {
          companyId: grn.companyId,
          branchId: pen.farm.branchId,
          farmId: pen.farmId,
          penHouseId: pen.id,
          code: placement.code,
          speciesKey: species,
          breed: placement.breed,
          purpose: placement.purpose ?? placement.stage,
          stage: placement.stage,
          openingPopulation: count,
          population: count,
          startedOn: grn.receiptDate,
          source: `${grn.grnNumber} (${grn.purchaseOrder.orderNumber})`,
          acquisitionCostKobo: line.valueKobo,
          // Carried at cost from arrival; marks the acquisition as booked, so a
          // later placement posting does not book it a second time.
          currentFvlctsPerUnitKobo: line.valueKobo / BigInt(count),
        },
      });
      await tx.goodsReceiptNoteLine.update({ where: { id: line.id }, data: { livestockGroupId: group.id } });
      await this.audit.write(
        {
          transactionId: group.id,
          module: 'OPERATIONS',
          entityType: 'LivestockGroup',
          entityId: group.id,
          status: 'ACTIVE',
          action: AuditAction.CREATE,
          userId: params.actor.userId,
          comments: `Placed ${count} ${placement.breed} at ${placement.house} from ${grn.grnNumber}.`,
        },
        tx,
      );
      debits.push({
        glAccountId: mapping.glAccountId,
        description: `Biological asset — ${placement.code} (${grn.grnNumber})`,
        debit: line.valueKobo,
        itemId: line.itemId,
        farmId: pen.farmId,
        penHouseId: pen.id,
      });
    }
    return debits;
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
      // Goods returned before invoicing left GRNI with the return.
      const uninvoiced = new Decimal(line.acceptedQuantity.toString())
        .minus(new Decimal(line.invoicedQuantity.toString()))
        .minus(new Decimal(line.returnedQuantity.toString()).minus(line.debitNotedQuantity.toString()));
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
