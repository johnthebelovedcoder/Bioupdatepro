import { Injectable, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AuditAction,
  CogsRecognitionPoint,
  DeliveryStatus,
  Prisma,
  SalesOrderStatus,
  StockDirection,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { RecipeService } from '../masters/recipe.service';
import { SalesPricingService } from './sales-pricing.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

export interface DeliveryLineInput {
  salesOrderLineId: string;
  /** QUANTITY being delivered on this note. */
  quantity: Decimal.Value;
  batchReference?: string | null;
}

/**
 * Delivery Note (§6).
 *
 * Moves goods out of stock and — depending on configuration — recognises cost
 * of sales. See the head of the O2C schema section for why that is configurable
 * and how double recognition is prevented.
 *
 * Cost comes from the Phase 4 effective-dated standard cost. Stock
 * availability is enforced at the order's warehouse via `stockOnHand()` —
 * deliberately checked against posted `StockMovement` rows only (the same
 * physical-fact discipline `StockMovementService.issueOut()` uses), not
 * against other still-draft deliveries reserving the same stock.
 */
@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly recipes: RecipeService,
    private readonly pricing: SalesPricingService,
  ) {}

  async create(input: {
    salesOrderId: string;
    deliveryNumber: string;
    deliveryDate: Date;
    financialYearId: string;
    financialPeriodId: string;
    driverName?: string | null;
    vehicleNumber?: string | null;
    receivedBy?: string | null;
    lines: DeliveryLineInput[];
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.salesOrder.findUniqueOrThrow({
      where: { id: input.salesOrderId },
      include: { lines: true },
    });

    const deliverable: SalesOrderStatus[] = [
      SalesOrderStatus.APPROVED,
      SalesOrderStatus.PARTIALLY_DELIVERED,
    ];
    if (!deliverable.includes(order.status)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Delivery',
        `Sales order ${order.orderNumber} is ${order.status}. Goods are only delivered ` +
          `against an approved order.`,
        { orderNumber: order.orderNumber, status: order.status },
      );
    }

    const lineById = new Map(order.lines.map((l) => [l.id, l]));
    const prepared: Array<{
      lineNumber: number;
      salesOrderLineId: string;
      itemId: string;
      quantity: Decimal;
      unitCostKobo: bigint;
      costKobo: bigint;
      batchReference: string | null;
    }> = [];

    let lineNumber = 1;
    for (const line of input.lines) {
      const orderLine = lineById.get(line.salesOrderLineId);
      if (!orderLine) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §6 — Delivery',
          `Line ${line.salesOrderLineId} does not belong to order ${order.orderNumber}.`,
          { orderNumber: order.orderNumber },
        );
      }

      const quantity = new Decimal(line.quantity.toString());
      if (quantity.lessThanOrEqualTo(0)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §6 — Delivery',
          `Delivery quantity must be positive; got ${quantity.toString()}.`,
          {},
        );
      }

      const alreadyDelivered = new Decimal(orderLine.deliveredQuantity.toString());
      const ordered = new Decimal(orderLine.quantity.toString());
      const outstanding = ordered.minus(alreadyDelivered);

      if (quantity.greaterThan(outstanding)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §6 — Delivery',
          `Line ${orderLine.lineNumber} of ${order.orderNumber} has ${outstanding.toFixed(6)} ` +
            `outstanding; cannot deliver ${quantity.toFixed(6)}. Over-delivery would ship ` +
            `goods the customer did not order.`,
          { orderNumber: order.orderNumber, lineNumber: orderLine.lineNumber },
        );
      }

      const onHand = await this.stockOnHand({
        companyId: order.companyId,
        itemId: orderLine.itemId,
        warehouseId: order.warehouseId,
      });
      if (new Decimal(onHand.quantity).lessThan(quantity)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §14 — Inventory issue',
          `${order.orderNumber} would take stock negative — ${onHand.quantity} on hand at this ` +
            `warehouse, ${quantity.toFixed(6)} requested for line ${orderLine.lineNumber}.`,
          { orderNumber: order.orderNumber, itemId: orderLine.itemId, onHand: onHand.quantity, requested: quantity.toFixed(6) },
        );
      }

      // Standard cost at the delivery date (Rule 8: effective-dated).
      const unitCost = await this.recipes.standardCostOn(
        orderLine.itemId,
        input.deliveryDate,
      );
      const cost = BigInt(
        new Decimal(unitCost.toString())
          .mul(quantity)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toFixed(0),
      );

      prepared.push({
        lineNumber: lineNumber++,
        salesOrderLineId: orderLine.id,
        itemId: orderLine.itemId,
        quantity,
        unitCostKobo: unitCost,
        costKobo: cost,
        batchReference: line.batchReference ?? orderLine.batchReference ?? null,
      });
    }

    const totalCost = prepared.reduce((s, l) => s + l.costKobo, 0n);

    return this.prisma.$transaction(async (tx) => {
      const delivery = await tx.deliveryNote.create({
        data: {
          companyId: order.companyId,
          deliveryNumber: input.deliveryNumber,
          salesOrderId: order.id,
          customerId: order.customerId,
          deliveryDate: input.deliveryDate,
          warehouseId: order.warehouseId,
          branchId: order.branchId,
          driverName: input.driverName ?? null,
          vehicleNumber: input.vehicleNumber ?? null,
          receivedBy: input.receivedBy ?? null,
          totalCostKobo: totalCost,
          financialYearId: input.financialYearId,
          financialPeriodId: input.financialPeriodId,
          currencyId: order.currencyId,
          createdById: input.actor.userId,
          lines: {
            create: prepared.map((line) => ({
              lineNumber: line.lineNumber,
              salesOrderLineId: line.salesOrderLineId,
              itemId: line.itemId,
              quantity: new Prisma.Decimal(line.quantity.toFixed(6)),
              unitCostKobo: line.unitCostKobo,
              costKobo: line.costKobo,
              batchReference: line.batchReference,
            })),
          },
        },
        include: { lines: true },
      });

      await this.audit.write(
        {
          transactionId: delivery.id,
          module: 'sales',
          entityType: 'DeliveryNote',
          entityId: delivery.id,
          status: delivery.status,
          action: AuditAction.CREATE,
          userId: input.actor.userId,
          comments: `Raised delivery ${delivery.deliveryNumber} against ${order.orderNumber}.`,
        },
        tx,
      );

      return delivery;
    });
  }

  async submit(params: { deliveryNoteId: string; actor: WorkflowActor }) {
    const delivery = await this.prisma.deliveryNote.findUniqueOrThrow({
      where: { id: params.deliveryNoteId },
    });

    if (delivery.status !== DeliveryStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Delivery',
        `${delivery.deliveryNumber} is ${delivery.status} and cannot be submitted.`,
        { deliveryNumber: delivery.deliveryNumber },
      );
    }

    const result = await this.workflow.submit({
      companyId: delivery.companyId,
      transactionType: 'GOODS_ISSUE',
      module: 'sales',
      documentType: 'DeliveryNote',
      documentId: delivery.id,
      documentReference: delivery.deliveryNumber,
      // Routed on the cost of goods leaving, which is the value at risk.
      amount: kobo(delivery.totalCostKobo),
      currencyId: delivery.currencyId,
      branchId: delivery.branchId,
      actor: params.actor,
    });

    await this.prisma.deliveryNote.update({
      where: { id: delivery.id },
      data: {
        status: DeliveryStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return result;
  }

  /**
   * Post the delivery on approval.
   *
   * Always writes the stock movement — goods have physically left. Only posts
   * cost of sales when the company recognises it at delivery; when it recognises
   * at invoice, the movement is recorded and the GL entry waits.
   */
  async postApproved(params: {
    deliveryNoteId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string | null }> {
    const delivery = await params.tx.deliveryNote.findUniqueOrThrow({
      where: { id: params.deliveryNoteId },
      include: { lines: true, salesOrder: true },
    });

    if (delivery.status === DeliveryStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${delivery.deliveryNumber} is already posted.`,
        { deliveryNumber: delivery.deliveryNumber },
      );
    }

    const config = await this.pricing.configuration(
      delivery.companyId,
      delivery.deliveryDate,
      params.tx,
    );

    const dimensions = {
      companyId: delivery.companyId,
      branchId: delivery.branchId,
      financialYearId: delivery.financialYearId,
      financialPeriodId: delivery.financialPeriodId,
      currencyId: delivery.currencyId,
      exchangeRate: '1.00000000',
    };

    const recogniseHere =
      config.cogsRecognitionPoint === CogsRecognitionPoint.DELIVERY;

    let journalEntryId: string | null;

    if (recogniseHere && delivery.totalCostKobo > 0n) {
      const result = await this.posting.post(
        {
          sourceModule: 'sales',
          sourceDocumentType: 'DeliveryNote',
          sourceDocumentId: delivery.id,
          journalNumber: delivery.deliveryNumber,
          journalDate: delivery.deliveryDate,
          narration: `Cost of sales on delivery ${delivery.deliveryNumber}`,
          ...dimensions,
          idempotencyKey: `delivery:${delivery.id}`,
          actor: params.actor,
          lines: [
            {
              glAccountId: config.costOfSalesGlAccountId,
              description: `Cost of sales — ${delivery.deliveryNumber}`,
              debit: kobo(delivery.totalCostKobo),
              dimensions: {
                ...dimensions,
                costCentreId: delivery.salesOrder.costCentreId,
                farmId: delivery.salesOrder.farmId,
                customerId: delivery.customerId,
              },
            },
            {
              glAccountId: config.inventoryGlAccountId,
              description: `Inventory relieved — ${delivery.deliveryNumber}`,
              credit: kobo(delivery.totalCostKobo),
              dimensions: {
                ...dimensions,
                farmId: delivery.salesOrder.farmId,
                customerId: delivery.customerId,
              },
            },
          ],
        },
        params.tx,
      );
      journalEntryId = result.journalEntryId;

      // Stamp each line so the invoice path cannot recognise it again. The
      // database refuses a second stamp regardless.
      for (const line of delivery.lines) {
        await params.tx.deliveryNoteLine.update({
          where: { id: line.id },
          data: { cogsPostedAt: CogsRecognitionPoint.DELIVERY },
        });
      }
    } else {
      // Cost of sales is recognised at invoice for this company, so the
      // delivery produces no GL entry. It is still APPROVED work — the stock
      // movements below record that the goods physically left.
      journalEntryId = null;
    }

    // Stock movements are written whether or not COGS was recognised: the goods
    // have gone either way, and the stock ledger is a record of physical fact.
    for (const line of delivery.lines) {
      await params.tx.stockMovement.create({
        data: {
          companyId: delivery.companyId,
          branchId: delivery.branchId,
          itemId: line.itemId,
          warehouseId: delivery.warehouseId,
          direction: StockDirection.OUT,
          quantity: line.quantity,
          unitCostKobo: line.unitCostKobo,
          valueKobo: line.costKobo,
          batchReference: line.batchReference,
          sourceModule: 'sales',
          sourceDocumentType: 'DeliveryNote',
          sourceDocumentId: delivery.id,
          documentReference: delivery.deliveryNumber,
          movementDate: delivery.deliveryDate,
          journalEntryId,
        },
      });

      // Advance the order line's delivered quantity.
      const orderLine = await params.tx.salesOrderLine.findUniqueOrThrow({
        where: { id: line.salesOrderLineId },
      });
      await params.tx.salesOrderLine.update({
        where: { id: line.salesOrderLineId },
        data: {
          deliveredQuantity: new Prisma.Decimal(
            new Decimal(orderLine.deliveredQuantity.toString())
              .plus(new Decimal(line.quantity.toString()))
              .toFixed(6),
          ),
        },
      });
    }

    await params.tx.deliveryNote.update({
      where: { id: delivery.id },
      data: {
        status: DeliveryStatus.POSTED,
        journalEntryId,
        postedAt: new Date(),
      },
    });

    this.logger.log(
      `Posted delivery ${delivery.deliveryNumber}` +
        (recogniseHere ? ' with cost of sales' : ' (cost of sales deferred to invoice)'),
    );

    return { journalEntryId };
  }

  /** Stock on hand for an item, derived from the movement ledger. */
  async stockOnHand(params: {
    companyId: string;
    itemId: string;
    warehouseId?: string;
  }): Promise<{ quantity: string; valueKobo: string }> {
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        companyId: params.companyId,
        itemId: params.itemId,
        ...(params.warehouseId ? { warehouseId: params.warehouseId } : {}),
      },
      select: { direction: true, quantity: true, valueKobo: true },
    });

    let quantity = new Decimal(0);
    let value = 0n;
    for (const movement of movements) {
      const sign = movement.direction === StockDirection.IN ? 1 : -1;
      quantity = quantity.plus(
        new Decimal(movement.quantity.toString()).mul(sign),
      );
      value += movement.valueKobo * BigInt(sign);
    }

    return { quantity: quantity.toFixed(6), valueKobo: value.toString() };
  }
}
