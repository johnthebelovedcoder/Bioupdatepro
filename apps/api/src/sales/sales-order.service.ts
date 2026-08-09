import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AuditAction,
  Prisma,
  QuotationStatus,
  SalesOrderStatus,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { PartyService } from '../masters/party.service';
import { SalesPricingService, PricedLineInput } from './sales-pricing.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

/**
 * Quotation and Sales Order (§6).
 *
 * Neither document posts to the ledger — nothing has happened financially until
 * goods move or an invoice is raised. They exist to be approved, and to carry
 * the credit decision.
 */
@Injectable()
export class SalesOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    private readonly parties: PartyService,
    private readonly pricing: SalesPricingService,
  ) {}

  // -------------------------------------------------------------------------
  // Quotation
  // -------------------------------------------------------------------------

  async createQuotation(input: {
    companyId: string;
    quoteNumber: string;
    customerId: string;
    quoteDate: Date;
    validUntil: Date;
    currencyId: string;
    exchangeRate?: string;
    branchId: string;
    farmId?: string | null;
    costCentreId?: string | null;
    salespersonId?: string | null;
    remarks?: string | null;
    lines: PricedLineInput[];
    actor: WorkflowActor;
  }) {
    if (input.validUntil < input.quoteDate) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Sales quotation',
        'A quotation cannot expire before it is issued.',
        { quoteNumber: input.quoteNumber },
      );
    }

    await this.assertCustomerTransactable(input.customerId);

    const priced = await this.pricing.priceDocument({
      companyId: input.companyId,
      on: input.quoteDate,
      lines: input.lines,
    });

    return this.prisma.$transaction(async (tx) => {
      const quotation = await tx.salesQuotation.create({
        data: {
          companyId: input.companyId,
          quoteNumber: input.quoteNumber,
          customerId: input.customerId,
          quoteDate: input.quoteDate,
          validUntil: input.validUntil,
          currencyId: input.currencyId,
          exchangeRate: new Prisma.Decimal(input.exchangeRate ?? '1.00000000'),
          branchId: input.branchId,
          farmId: input.farmId ?? null,
          costCentreId: input.costCentreId ?? null,
          salespersonId: input.salespersonId ?? null,
          remarks: input.remarks ?? null,
          netAmountKobo: priced.netAmountKobo,
          vatAmountKobo: priced.vatAmountKobo,
          grossAmountKobo: priced.grossAmountKobo,
          createdById: input.actor.userId,
          lines: {
            create: priced.lines.map((line) => ({
              lineNumber: line.lineNumber,
              itemId: line.itemId,
              description: line.description,
              quantity: new Prisma.Decimal(line.quantity),
              unitPriceKobo: line.unitPriceKobo,
              discountKobo: line.discountKobo,
              taxCodeId: line.taxCodeId,
              netAmountKobo: line.netAmountKobo,
              vatAmountKobo: line.vatAmountKobo,
            })),
          },
        },
        include: { lines: true },
      });

      await this.writeAudit(tx, {
        entityType: 'SalesQuotation',
        entityId: quotation.id,
        status: quotation.status,
        action: AuditAction.CREATE,
        userId: input.actor.userId,
        comments: `Raised quotation ${quotation.quoteNumber}.`,
      });

      return quotation;
    });
  }

  async submitQuotation(params: { quotationId: string; actor: WorkflowActor }) {
    const quotation = await this.prisma.salesQuotation.findUniqueOrThrow({
      where: { id: params.quotationId },
    });

    if (quotation.status !== QuotationStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Sales quotation',
        `${quotation.quoteNumber} is ${quotation.status} and cannot be submitted.`,
        { quoteNumber: quotation.quoteNumber, status: quotation.status },
      );
    }

    const result = await this.workflow.submit({
      companyId: quotation.companyId,
      transactionType: 'SALES_QUOTATION',
      module: 'sales',
      documentType: 'SalesQuotation',
      documentId: quotation.id,
      documentReference: quotation.quoteNumber,
      amount: kobo(quotation.grossAmountKobo),
      currencyId: quotation.currencyId,
      branchId: quotation.branchId,
      farmId: quotation.farmId,
      costCentreId: quotation.costCentreId,
      actor: params.actor,
    });

    await this.prisma.salesQuotation.update({
      where: { id: quotation.id },
      data: {
        status: QuotationStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return result;
  }

  /**
   * Convert an approved quotation into a sales order.
   *
   * Prices are carried across rather than recalculated: a quotation is an offer,
   * and re-pricing it at conversion would let the customer be charged something
   * they never accepted.
   */
  async convertQuotation(params: {
    quotationId: string;
    orderNumber: string;
    orderDate: Date;
    deliveryDate?: Date | null;
    warehouseId: string;
    departmentId?: string | null;
    actor: WorkflowActor;
  }) {
    const quotation = await this.prisma.salesQuotation.findUniqueOrThrow({
      where: { id: params.quotationId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });

    const convertible: QuotationStatus[] = [
      QuotationStatus.APPROVED,
      QuotationStatus.ACCEPTED,
    ];
    if (!convertible.includes(quotation.status)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Sales quotation',
        `${quotation.quoteNumber} is ${quotation.status}; only an approved or accepted ` +
          `quotation converts to an order.`,
        { quoteNumber: quotation.quoteNumber, status: quotation.status },
      );
    }
    if (quotation.validUntil < params.orderDate) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Sales quotation',
        `${quotation.quoteNumber} expired on ` +
          `${quotation.validUntil.toISOString().slice(0, 10)} and cannot be converted on ` +
          `${params.orderDate.toISOString().slice(0, 10)}. Re-quote instead.`,
        { quoteNumber: quotation.quoteNumber },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.create({
        data: {
          companyId: quotation.companyId,
          orderNumber: params.orderNumber,
          customerId: quotation.customerId,
          quotationId: quotation.id,
          orderDate: params.orderDate,
          deliveryDate: params.deliveryDate ?? null,
          currencyId: quotation.currencyId,
          exchangeRate: quotation.exchangeRate,
          branchId: quotation.branchId,
          warehouseId: params.warehouseId,
          farmId: quotation.farmId,
          departmentId: params.departmentId ?? null,
          costCentreId: quotation.costCentreId,
          netAmountKobo: quotation.netAmountKobo,
          vatAmountKobo: quotation.vatAmountKobo,
          grossAmountKobo: quotation.grossAmountKobo,
          createdById: params.actor.userId,
          lines: {
            create: quotation.lines.map((line) => ({
              lineNumber: line.lineNumber,
              itemId: line.itemId,
              description: line.description,
              quantity: line.quantity,
              unitPriceKobo: line.unitPriceKobo,
              discountKobo: line.discountKobo,
              taxCodeId: line.taxCodeId,
              netAmountKobo: line.netAmountKobo,
              vatAmountKobo: line.vatAmountKobo,
            })),
          },
        },
        include: { lines: true },
      });

      await tx.salesQuotation.update({
        where: { id: quotation.id },
        data: { status: QuotationStatus.CONVERTED },
      });

      await this.writeAudit(tx, {
        entityType: 'SalesOrder',
        entityId: order.id,
        status: order.status,
        action: AuditAction.CREATE,
        userId: params.actor.userId,
        comments: `Converted ${quotation.quoteNumber} into order ${order.orderNumber}.`,
      });

      return order;
    });
  }

  // -------------------------------------------------------------------------
  // Sales Order
  // -------------------------------------------------------------------------

  async createOrder(input: {
    companyId: string;
    orderNumber: string;
    customerId: string;
    orderDate: Date;
    deliveryDate?: Date | null;
    currencyId: string;
    exchangeRate?: string;
    branchId: string;
    warehouseId: string;
    farmId?: string | null;
    departmentId?: string | null;
    costCentreId?: string | null;
    lines: PricedLineInput[];
    actor: WorkflowActor;
  }) {
    await this.assertCustomerTransactable(input.customerId);

    const priced = await this.pricing.priceDocument({
      companyId: input.companyId,
      on: input.orderDate,
      lines: input.lines,
    });

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.create({
        data: {
          companyId: input.companyId,
          orderNumber: input.orderNumber,
          customerId: input.customerId,
          orderDate: input.orderDate,
          deliveryDate: input.deliveryDate ?? null,
          currencyId: input.currencyId,
          exchangeRate: new Prisma.Decimal(input.exchangeRate ?? '1.00000000'),
          branchId: input.branchId,
          warehouseId: input.warehouseId,
          farmId: input.farmId ?? null,
          departmentId: input.departmentId ?? null,
          costCentreId: input.costCentreId ?? null,
          netAmountKobo: priced.netAmountKobo,
          vatAmountKobo: priced.vatAmountKobo,
          grossAmountKobo: priced.grossAmountKobo,
          createdById: input.actor.userId,
          lines: {
            create: priced.lines.map((line) => ({
              lineNumber: line.lineNumber,
              itemId: line.itemId,
              description: line.description,
              quantity: new Prisma.Decimal(line.quantity),
              unitPriceKobo: line.unitPriceKobo,
              discountKobo: line.discountKobo,
              taxCodeId: line.taxCodeId,
              netAmountKobo: line.netAmountKobo,
              vatAmountKobo: line.vatAmountKobo,
            })),
          },
        },
        include: { lines: true },
      });

      await this.writeAudit(tx, {
        entityType: 'SalesOrder',
        entityId: order.id,
        status: order.status,
        action: AuditAction.CREATE,
        userId: input.actor.userId,
        comments: `Raised order ${order.orderNumber}.`,
      });

      return order;
    });
  }

  /**
   * Submit an order for approval, running §6 credit control first.
   *
   * A failed credit check does NOT block the order — §6 says it "routes to
   * Credit Approval Workflow". So the order is submitted under a different
   * transaction type, which the routing engine already knows how to give a
   * tighter ladder. No special case in the engine; just a different route.
   *
   * The outcome is recorded on the order either way, because "why was this
   * allowed" has to be answerable long after the fact.
   */
  async submitOrder(params: { salesOrderId: string; actor: WorkflowActor }) {
    const order = await this.prisma.salesOrder.findUniqueOrThrow({
      where: { id: params.salesOrderId },
    });

    if (order.status !== SalesOrderStatus.DRAFT) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Sales order',
        `${order.orderNumber} is ${order.status} and cannot be submitted.`,
        { orderNumber: order.orderNumber, status: order.status },
      );
    }

    const config = await this.pricing.configuration(order.companyId, order.orderDate);

    const creditCheck = await this.parties.creditCheck({
      customerId: order.customerId,
      proposedAmount: kobo(order.grossAmountKobo),
    });

    const transactionType = creditCheck.passed
      ? config.salesOrderTransactionType
      : config.creditOverrideTransactionType;

    const result = await this.workflow.submit({
      companyId: order.companyId,
      transactionType,
      module: 'sales',
      documentType: 'SalesOrder',
      documentId: order.id,
      documentReference: order.orderNumber,
      amount: kobo(order.grossAmountKobo),
      currencyId: order.currencyId,
      branchId: order.branchId,
      farmId: order.farmId,
      departmentId: order.departmentId,
      costCentreId: order.costCentreId,
      actor: params.actor,
      comments: creditCheck.passed
        ? null
        : `Credit control failed: ${creditCheck.reasons.join(' ')}`,
    });

    await this.prisma.salesOrder.update({
      where: { id: order.id },
      data: {
        status: SalesOrderStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
        creditCheckPassed: creditCheck.passed,
        creditCheckReasons: creditCheck.reasons.join(' ') || null,
        creditOverride: !creditCheck.passed,
      },
    });

    return { ...result, creditCheck, routedAs: transactionType };
  }

  /**
   * Bring the order's status into line with its workflow instance, and with how
   * much of it has been delivered.
   */
  async syncStatus(salesOrderId: string): Promise<void> {
    const order = await this.prisma.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      include: { lines: true },
    });

    if (
      order.status === SalesOrderStatus.CANCELLED ||
      order.status === SalesOrderStatus.CLOSED
    ) {
      return;
    }

    if (order.workflowTransactionId) {
      const transaction = await this.prisma.workflowTransaction.findUnique({
        where: { id: order.workflowTransactionId },
        select: { status: true },
      });

      if (transaction?.status === 'REJECTED' || transaction?.status === 'CANCELLED') {
        await this.prisma.salesOrder.update({
          where: { id: order.id },
          data: { status: SalesOrderStatus.CANCELLED },
        });
        return;
      }

      const approved =
        transaction?.status === 'APPROVED' || transaction?.status === 'POSTED';
      if (!approved) return;
    }

    const anyDelivered = order.lines.some((l) =>
      new Decimal(l.deliveredQuantity.toString()).greaterThan(0),
    );
    const allDelivered = order.lines.every((l) =>
      new Decimal(l.deliveredQuantity.toString()).greaterThanOrEqualTo(
        new Decimal(l.quantity.toString()),
      ),
    );

    const status = allDelivered
      ? SalesOrderStatus.FULLY_DELIVERED
      : anyDelivered
        ? SalesOrderStatus.PARTIALLY_DELIVERED
        : SalesOrderStatus.APPROVED;

    if (status !== order.status) {
      await this.prisma.salesOrder.update({
        where: { id: order.id },
        data: { status },
      });
    }
  }

  // -------------------------------------------------------------------------

  /** §6: a blocked or inactive customer cannot transact at all. */
  private async assertCustomerTransactable(customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { code: true, status: true, statusReason: true },
    });

    if (customer.status !== 'ACTIVE') {
      throw new AccountingRuleViolation(
        'Consolidated Reference §6 — Customer status',
        `Customer ${customer.code} is ${customer.status}` +
          `${customer.statusReason ? `: ${customer.statusReason}` : ''}. ` +
          `No sales document may be raised for them.`,
        { customerCode: customer.code, status: customer.status },
      );
    }
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    event: {
      entityType: string;
      entityId: string;
      status: string;
      action: AuditAction;
      userId: string;
      comments: string;
    },
  ): Promise<void> {
    await this.audit.write(
      {
        transactionId: event.entityId,
        module: 'sales',
        entityType: event.entityType,
        entityId: event.entityId,
        status: event.status,
        action: event.action,
        userId: event.userId,
        comments: event.comments,
      },
      tx,
    );
  }
}
