import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AuditAction,
  PartyStatus,
  Prisma,
  PurchaseOrderStatus,
  RequisitionStatus,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { TaxEngineService } from '../tax/tax-engine.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

export interface RequisitionLineInput {
  itemId: string;
  description?: string;
  quantity: Decimal.Value;
  estimatedUnitCostKobo?: bigint;
}

export interface PurchaseOrderLineInput {
  itemId: string;
  description?: string;
  requisitionLineId?: string | null;
  quantity: Decimal.Value;
  unitPriceKobo: bigint;
  taxCode?: string | null;
}

/**
 * Purchase Requisition, RFQ and Purchase Order (§5).
 *
 * None of these post to the ledger. A requisition is a request, an RFQ is a
 * question, and a purchase order is a commitment — but nothing has been
 * received or owed, so nothing has happened financially. The first GL entry in
 * this chain is the goods receipt.
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly tax: TaxEngineService,
  ) {}

  // -------------------------------------------------------------------------
  // Requisition
  // -------------------------------------------------------------------------

  async createRequisition(input: {
    companyId: string;
    requisitionNumber: string;
    requestDate: Date;
    requiredDate?: Date | null;
    branchId: string;
    departmentId?: string | null;
    costCentreId?: string | null;
    farmId?: string | null;
    currencyId: string;
    justification?: string | null;
    lines: RequisitionLineInput[];
    actor: WorkflowActor;
  }) {
    if (input.lines.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Purchase requisition',
        'A requisition must request at least one item.',
        { requisitionNumber: input.requisitionNumber },
      );
    }

    const items = await this.prisma.item.findMany({
      where: { id: { in: input.lines.map((l) => l.itemId) } },
      include: {
        standardCosts: {
          where: { effectiveTo: null },
          select: { standardCostKobo: true },
        },
      },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));

    let estimatedTotal = 0n;
    const lines = input.lines.map((line, index) => {
      const item = itemById.get(line.itemId);
      if (!item) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Item master',
          `Item ${line.itemId} on line ${index + 1} does not exist.`,
          { lineNumber: index + 1 },
        );
      }

      // The standard cost is only an estimate here; the real price comes from
      // the supplier's quotation or the purchase order.
      const unitCost =
        line.estimatedUnitCostKobo ?? item.standardCosts[0]?.standardCostKobo ?? 0n;
      const quantity = new Decimal(line.quantity.toString());
      const extended = BigInt(
        new Decimal(unitCost.toString())
          .mul(quantity)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toFixed(0),
      );
      estimatedTotal += extended;

      return {
        lineNumber: index + 1,
        itemId: item.id,
        description: line.description ?? item.description,
        quantity: new Prisma.Decimal(quantity.toFixed(6)),
        estimatedUnitCostKobo: unitCost,
      };
    });

    return this.prisma.$transaction(async (tx) => {
      const requisition = await tx.purchaseRequisition.create({
        data: {
          companyId: input.companyId,
          requisitionNumber: input.requisitionNumber,
          requestDate: input.requestDate,
          requiredDate: input.requiredDate ?? null,
          requesterId: input.actor.userId,
          branchId: input.branchId,
          departmentId: input.departmentId ?? null,
          costCentreId: input.costCentreId ?? null,
          farmId: input.farmId ?? null,
          currencyId: input.currencyId,
          justification: input.justification ?? null,
          estimatedCostKobo: estimatedTotal,
          lines: { create: lines },
        },
        include: { lines: true },
      });

      await this.audit.write(
        {
          transactionId: requisition.id,
          module: 'procurement',
          entityType: 'PurchaseRequisition',
          entityId: requisition.id,
          status: requisition.status,
          action: AuditAction.CREATE,
          userId: input.actor.userId,
          comments: `Raised requisition ${requisition.requisitionNumber}.`,
        },
        tx,
      );

      return requisition;
    });
  }

  async submitRequisition(params: { requisitionId: string; actor: WorkflowActor }) {
    const requisition = await this.prisma.purchaseRequisition.findUniqueOrThrow({
      where: { id: params.requisitionId },
    });

    if (requisition.status !== RequisitionStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Purchase requisition',
        `${requisition.requisitionNumber} is ${requisition.status} and cannot be submitted.`,
        { requisitionNumber: requisition.requisitionNumber },
      );
    }

    const result = await this.workflow.submit({
      companyId: requisition.companyId,
      transactionType: 'PURCHASE_REQUISITION',
      module: 'procurement',
      documentType: 'PurchaseRequisition',
      documentId: requisition.id,
      documentReference: requisition.requisitionNumber,
      amount: kobo(requisition.estimatedCostKobo),
      currencyId: requisition.currencyId,
      branchId: requisition.branchId,
      departmentId: requisition.departmentId,
      costCentreId: requisition.costCentreId,
      farmId: requisition.farmId,
      actor: params.actor,
    });

    await this.prisma.purchaseRequisition.update({
      where: { id: requisition.id },
      data: {
        status: RequisitionStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // RFQ
  // -------------------------------------------------------------------------

  /**
   * Award an RFQ to one quotation.
   *
   * The reason is required. §5 makes the RFQ optional, but where one exists,
   * "why did we pick this supplier" is the question a procurement audit asks
   * first — and the cheapest quotation is not always the awarded one.
   */
  async awardRfq(params: {
    rfqId: string;
    quotationId: string;
    reason: string;
    actor: WorkflowActor;
  }) {
    if (!params.reason?.trim()) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — RFQ',
        'Awarding an RFQ requires a stated reason.',
        { rfqId: params.rfqId },
      );
    }

    const quotation = await this.prisma.supplierQuotation.findUniqueOrThrow({
      where: { id: params.quotationId },
      include: { supplier: true },
    });

    if (quotation.rfqId !== params.rfqId) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — RFQ',
        'That quotation was not submitted against this RFQ.',
        { rfqId: params.rfqId, quotationId: params.quotationId },
      );
    }
    this.assertSupplierTransactable(quotation.supplier);

    return this.prisma.$transaction(async (tx) => {
      const rfq = await tx.rfq.update({
        where: { id: params.rfqId },
        data: {
          status: 'EVALUATED',
          awardedQuotationId: params.quotationId,
          awardReason: params.reason,
        },
      });

      await this.audit.write(
        {
          transactionId: rfq.id,
          module: 'procurement',
          entityType: 'Rfq',
          entityId: rfq.id,
          status: rfq.status,
          action: AuditAction.APPROVE,
          userId: params.actor.userId,
          comments: `Awarded ${rfq.rfqNumber} to ${quotation.supplier.name}: ${params.reason}`,
          metadata: {
            supplierCode: quotation.supplier.code,
            totalAmountKobo: quotation.totalAmountKobo.toString(),
          },
        },
        tx,
      );

      return rfq;
    });
  }

  /** Compare every quotation received against an RFQ. */
  async compareQuotations(rfqId: string) {
    const quotations = await this.prisma.supplierQuotation.findMany({
      where: { rfqId },
      include: {
        supplier: { select: { code: true, name: true, status: true } },
        lines: { include: { item: { select: { code: true } } } },
      },
      orderBy: { totalAmountKobo: 'asc' },
    });

    const cheapest = quotations[0]?.totalAmountKobo ?? 0n;

    return quotations.map((quotation) => ({
      quotationId: quotation.id,
      supplierCode: quotation.supplier.code,
      supplierName: quotation.supplier.name,
      supplierStatus: quotation.supplier.status,
      quotationReference: quotation.quotationReference,
      totalAmountKobo: quotation.totalAmountKobo.toString(),
      /// How much more than the cheapest quotation this one costs.
      varianceToCheapestKobo: (quotation.totalAmountKobo - cheapest).toString(),
      leadTimeDays: quotation.leadTimeDays,
      lines: quotation.lines.map((line) => ({
        itemCode: line.item.code,
        quantity: line.quantity.toString(),
        unitPriceKobo: line.unitPriceKobo.toString(),
      })),
    }));
  }

  // -------------------------------------------------------------------------
  // Purchase Order
  // -------------------------------------------------------------------------

  async createOrder(input: {
    companyId: string;
    orderNumber: string;
    supplierId: string;
    requisitionId?: string | null;
    rfqId?: string | null;
    orderDate: Date;
    expectedDeliveryDate?: Date | null;
    currencyId: string;
    exchangeRate?: string;
    branchId: string;
    warehouseId: string;
    farmId?: string | null;
    departmentId?: string | null;
    costCentreId?: string | null;
    deliveryAddress?: string | null;
    lines: PurchaseOrderLineInput[];
    actor: WorkflowActor;
  }) {
    const supplier = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: input.supplierId },
      include: { paymentTerm: true },
    });
    this.assertSupplierTransactable(supplier);

    if (input.lines.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Purchase order',
        'A purchase order must order at least one item.',
        { orderNumber: input.orderNumber },
      );
    }

    const { prepared, net, vat } = await this.prepareLines({
      companyId: input.companyId,
      orderDate: input.orderDate,
      lines: input.lines,
    });

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.create({
        data: {
          companyId: input.companyId,
          orderNumber: input.orderNumber,
          supplierId: input.supplierId,
          requisitionId: input.requisitionId ?? null,
          rfqId: input.rfqId ?? null,
          orderDate: input.orderDate,
          expectedDeliveryDate: input.expectedDeliveryDate ?? null,
          currencyId: input.currencyId,
          exchangeRate: new Prisma.Decimal(input.exchangeRate ?? '1.00000000'),
          paymentTermId: supplier.paymentTermId,
          deliveryAddress: input.deliveryAddress ?? null,
          branchId: input.branchId,
          warehouseId: input.warehouseId,
          farmId: input.farmId ?? null,
          departmentId: input.departmentId ?? null,
          costCentreId: input.costCentreId ?? null,
          netAmountKobo: net,
          vatAmountKobo: vat,
          grossAmountKobo: net + vat,
          createdById: input.actor.userId,
          lines: { createMany: { data: prepared } },
        },
        include: { lines: true },
      });

      // Advance the requisition lines this order draws down.
      for (const line of order.lines) {
        if (!line.requisitionLineId) continue;
        const requisitionLine = await tx.purchaseRequisitionLine.findUniqueOrThrow({
          where: { id: line.requisitionLineId },
        });
        await tx.purchaseRequisitionLine.update({
          where: { id: line.requisitionLineId },
          data: {
            orderedQuantity: new Prisma.Decimal(
              new Decimal(requisitionLine.orderedQuantity.toString())
                .plus(new Decimal(line.quantity.toString()))
                .toFixed(6),
            ),
          },
        });
      }

      if (input.requisitionId) {
        await tx.purchaseRequisition.update({
          where: { id: input.requisitionId },
          data: { status: RequisitionStatus.CONVERTED },
        });
      }

      await this.audit.write(
        {
          transactionId: order.id,
          module: 'procurement',
          entityType: 'PurchaseOrder',
          entityId: order.id,
          status: order.status,
          action: AuditAction.CREATE,
          userId: input.actor.userId,
          comments: `Raised purchase order ${order.orderNumber} on ${supplier.name}.`,
        },
        tx,
      );

      return order;
    });
  }

  /**
   * Amend a draft order — a price correction, a quantity change, a new line
   * — versioned rather than silently overwritten. Only a DRAFT order may be
   * amended, which an order reaches two ways: it was never submitted yet, or
   * an approver returned it for correction (`syncStatus` puts a RETURNED
   * order back in DRAFT for exactly this). Either way nothing has been
   * received or invoiced against it — that requires APPROVED — so replacing
   * the line set outright is safe. Once an order leaves DRAFT its lines are
   * locked at the database level (`bap_block_locked_purchase_order_lines`) —
   * this method never races that trigger because it never touches a
   * non-draft order's lines. Resubmitting after an amendment is the same
   * `submitOrder` call as the first submission: `workflow.submit()` already
   * knows to resume a RETURNED transaction rather than duplicate it.
   */
  async amendOrder(input: {
    purchaseOrderId: string;
    lines: PurchaseOrderLineInput[];
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: input.purchaseOrderId },
    });

    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Purchase order',
        `${order.orderNumber} is ${order.status} and cannot be amended — only a draft order's ` +
          'lines are still open to change.',
        { orderNumber: order.orderNumber },
      );
    }

    if (input.lines.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Purchase order',
        'A purchase order must order at least one item.',
        { orderNumber: order.orderNumber },
      );
    }

    const { prepared, net, vat } = await this.prepareLines({
      companyId: order.companyId,
      orderDate: order.orderDate,
      lines: input.lines,
    });

    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: order.id } });

      const updated = await tx.purchaseOrder.update({
        where: { id: order.id },
        data: {
          version: { increment: 1 },
          netAmountKobo: net,
          vatAmountKobo: vat,
          grossAmountKobo: net + vat,
          lines: { createMany: { data: prepared } },
        },
        include: { lines: true },
      });

      await this.audit.write(
        {
          transactionId: updated.id,
          module: 'procurement',
          entityType: 'PurchaseOrder',
          entityId: updated.id,
          status: updated.status,
          action: AuditAction.UPDATE,
          userId: input.actor.userId,
          comments:
            `Amended ${updated.orderNumber} to version ${updated.version} — gross now ` +
            `${updated.grossAmountKobo.toString()} kobo (was ${order.grossAmountKobo.toString()}).`,
          metadata: {
            previousVersion: order.version,
            previousGrossAmountKobo: order.grossAmountKobo.toString(),
            newGrossAmountKobo: updated.grossAmountKobo.toString(),
          },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Validate and price a line set — the shared work behind both raising a
   * new order and amending a draft one, so the two can never compute net,
   * VAT or line shape differently.
   */
  private async prepareLines(params: {
    companyId: string;
    orderDate: Date;
    lines: PurchaseOrderLineInput[];
  }): Promise<{
    prepared: Prisma.PurchaseOrderLineCreateManyPurchaseOrderInput[];
    net: bigint;
    vat: bigint;
  }> {
    const items = await this.prisma.item.findMany({
      where: { id: { in: params.lines.map((l) => l.itemId) } },
      include: { vatTaxCode: { select: { code: true } } },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));

    const prepared: Prisma.PurchaseOrderLineCreateManyPurchaseOrderInput[] = [];
    let net = 0n;
    let vat = 0n;

    for (const [index, line] of params.lines.entries()) {
      const item = itemById.get(line.itemId);
      if (!item) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Item master',
          `Item ${line.itemId} on line ${index + 1} does not exist.`,
          { lineNumber: index + 1 },
        );
      }
      if (!item.active) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Item master',
          `Item "${item.code}" is inactive and cannot be ordered.`,
          { lineNumber: index + 1, itemCode: item.code },
        );
      }

      const quantity = new Decimal(line.quantity.toString());
      if (quantity.lessThanOrEqualTo(0)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §5 — Purchase order',
          `Line ${index + 1} has a quantity of ${quantity.toString()}.`,
          { lineNumber: index + 1 },
        );
      }

      const lineNet = BigInt(
        new Decimal(line.unitPriceKobo.toString())
          .mul(quantity)
          .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
          .toFixed(0),
      );

      // Input VAT through the shared engine (Rule 5).
      const taxCode = line.taxCode ?? item.vatTaxCode?.code ?? null;
      let lineVat = 0n;
      let taxCodeId: string | null = null;
      if (taxCode) {
        const calculation = await this.tax.calculateVat({
          companyId: params.companyId,
          taxCode,
          amount: lineNet as never,
          on: params.orderDate,
        });
        lineVat = calculation.taxKobo;
        taxCodeId = calculation.taxCodeId;
      }

      net += lineNet;
      vat += lineVat;

      prepared.push({
        lineNumber: index + 1,
        itemId: item.id,
        description: line.description ?? item.description,
        requisitionLineId: line.requisitionLineId ?? null,
        quantity: new Prisma.Decimal(quantity.toFixed(6)),
        unitPriceKobo: line.unitPriceKobo,
        taxCodeId,
        netAmountKobo: lineNet,
        vatAmountKobo: lineVat,
      });
    }

    return { prepared, net, vat };
  }

  async submitOrder(params: { purchaseOrderId: string; actor: WorkflowActor }) {
    const order = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: params.purchaseOrderId },
    });

    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Purchase order',
        `${order.orderNumber} is ${order.status} and cannot be submitted.`,
        { orderNumber: order.orderNumber },
      );
    }

    const result = await this.workflow.submit({
      companyId: order.companyId,
      transactionType: 'PURCHASE_ORDER',
      module: 'procurement',
      documentType: 'PurchaseOrder',
      documentId: order.id,
      documentReference: order.orderNumber,
      amount: kobo(order.grossAmountKobo),
      currencyId: order.currencyId,
      branchId: order.branchId,
      farmId: order.farmId,
      departmentId: order.departmentId,
      costCentreId: order.costCentreId,
      actor: params.actor,
    });

    await this.prisma.purchaseOrder.update({
      where: { id: order.id },
      data: {
        status: PurchaseOrderStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return result;
  }

  /** Keep the order status in line with its workflow and its receipts. */
  async syncStatus(purchaseOrderId: string): Promise<void> {
    const order = await this.prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrderId },
      include: { lines: true },
    });

    if (
      order.status === PurchaseOrderStatus.CANCELLED ||
      order.status === PurchaseOrderStatus.CLOSED
    ) {
      return;
    }

    if (order.workflowTransactionId) {
      const transaction = await this.prisma.workflowTransaction.findUnique({
        where: { id: order.workflowTransactionId },
        select: { status: true },
      });

      if (transaction?.status === 'REJECTED' || transaction?.status === 'CANCELLED') {
        await this.prisma.purchaseOrder.update({
          where: { id: order.id },
          data: { status: PurchaseOrderStatus.CANCELLED },
        });
        return;
      }

      // An approver returning an order for correction has to land somewhere
      // the maker can act on. DRAFT is that state — it's already what
      // `amendOrder` requires, and `workflow.submit()` already knows to
      // resume rather than duplicate a RETURNED transaction, so resubmitting
      // after an amendment here needs no special case of its own (US-897-006).
      if (transaction?.status === 'RETURNED') {
        if (order.status !== PurchaseOrderStatus.DRAFT) {
          await this.prisma.purchaseOrder.update({
            where: { id: order.id },
            data: { status: PurchaseOrderStatus.DRAFT },
          });
        }
        return;
      }

      const approved =
        transaction?.status === 'APPROVED' || transaction?.status === 'POSTED';
      if (!approved) return;
    }

    const anyReceived = order.lines.some((l) =>
      new Decimal(l.receivedQuantity.toString()).greaterThan(0),
    );
    const allReceived = order.lines.every((l) =>
      new Decimal(l.receivedQuantity.toString()).greaterThanOrEqualTo(
        new Decimal(l.quantity.toString()),
      ),
    );

    const status = allReceived
      ? PurchaseOrderStatus.FULLY_RECEIVED
      : anyReceived
        ? PurchaseOrderStatus.PARTIALLY_RECEIVED
        : PurchaseOrderStatus.APPROVED;

    if (status !== order.status) {
      await this.prisma.purchaseOrder.update({
        where: { id: order.id },
        data: { status },
      });
    }
  }

  /**
   * Keep a requisition's status in line with its workflow.
   *
   * Same gap as `syncStatus` above, one document type over: approving a
   * requisition posts nothing, so no handler runs, so nothing was writing
   * the outcome back onto the row — it stayed SUBMITTED with an APPROVED
   * workflow behind it, and nothing could ever be converted from it.
   */
  async syncRequisitionStatus(requisitionId: string): Promise<void> {
    const requisition = await this.prisma.purchaseRequisition.findUniqueOrThrow({
      where: { id: requisitionId },
    });

    if (
      requisition.status === RequisitionStatus.CONVERTED ||
      requisition.status === RequisitionStatus.CLOSED ||
      requisition.status === RequisitionStatus.CANCELLED ||
      !requisition.workflowTransactionId
    ) {
      return;
    }

    const transaction = await this.prisma.workflowTransaction.findUnique({
      where: { id: requisition.workflowTransactionId },
      select: { status: true },
    });

    if (transaction?.status === 'REJECTED' || transaction?.status === 'CANCELLED') {
      await this.prisma.purchaseRequisition.update({
        where: { id: requisition.id },
        data: { status: RequisitionStatus.REJECTED },
      });
      return;
    }

    const approved = transaction?.status === 'APPROVED' || transaction?.status === 'POSTED';
    if (approved && requisition.status !== RequisitionStatus.APPROVED) {
      await this.prisma.purchaseRequisition.update({
        where: { id: requisition.id },
        data: { status: RequisitionStatus.APPROVED },
      });
    }
  }

  /** §5: a blocked or inactive supplier cannot transact. */
  private assertSupplierTransactable(supplier: {
    code: string;
    status: PartyStatus;
    statusReason: string | null;
  }): void {
    if (supplier.status !== PartyStatus.ACTIVE) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Supplier status',
        `Supplier ${supplier.code} is ${supplier.status}` +
          `${supplier.statusReason ? `: ${supplier.statusReason}` : ''}. ` +
          `No procurement document may be raised for them.`,
        { supplierCode: supplier.code, status: supplier.status },
      );
    }
  }
}
