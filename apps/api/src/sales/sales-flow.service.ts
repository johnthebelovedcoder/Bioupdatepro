import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryStatus, SalesOrderStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { SalesOrderService } from './sales-order.service';
import { DeliveryService } from './delivery.service';
import { SalesInvoiceService } from './sales-invoice.service';
import { CustomerReceiptService } from './customer-receipt.service';
import { WorkflowService } from '../workflow/workflow.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Order-to-Cash, as a person walks it.
 *
 * Same shape as `ProcurementFlowService`, one chain over: raise a sales
 * order, approve it, ship against it, approve the delivery, invoice what
 * shipped, approve the invoice, receive the customer's payment, approve
 * that. Every one of these existed as complete domain logic in `SalesOrderService`
 * / `DeliveryService` / `SalesInvoiceService` / `CustomerReceiptService` with
 * no HTTP surface at all — this is that surface.
 *
 * The accounting moment is the delivery (or the invoice, if the company
 * recognises cost of sales there instead) — raising an order commits the
 * farm to nothing in the ledger, the same reasoning as a purchase order.
 */
@Injectable()
export class SalesFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: SalesOrderService,
    private readonly deliveries: DeliveryService,
    private readonly invoices: SalesInvoiceService,
    private readonly receipts: CustomerReceiptService,
    private readonly workflow: WorkflowService,
  ) {}

  /** Orders, newest first, with what can be done to each. */
  async listOrders(companyId: string) {
    await this.reconcileStrandedOrders(companyId);

    const orders = await this.prisma.salesOrder.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        customer: { select: { name: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, description: true } } },
        },
      },
    });

    const transactions = await this.prisma.workflowTransaction.findMany({
      where: {
        companyId,
        documentId: { in: orders.map((order) => order.id) },
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
      },
      select: { id: true, documentId: true },
    });
    const pending = new Map(transactions.map((t) => [t.documentId, t.id]));

    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      customer: order.customer.name,
      status: order.status,
      orderDate: order.orderDate,
      netKobo: order.lines
        .reduce((sum, line) => sum + (line.netAmountKobo ?? 0n), 0n)
        .toString(),
      lineCount: order.lines.length,
      pendingTransactionId: pending.get(order.id) ?? null,
      canDeliver:
        order.status === SalesOrderStatus.APPROVED ||
        order.status === SalesOrderStatus.PARTIALLY_DELIVERED,
      canInvoice: order.lines.some(
        (line) =>
          Number(line.deliveredQuantity?.toString() ?? '0') >
          Number(line.invoicedQuantity?.toString() ?? '0'),
      ),
      lines: order.lines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        itemCode: line.item.code,
        description: line.item.description,
        orderedQuantity: line.quantity.toString(),
        deliveredQuantity: line.deliveredQuantity?.toString() ?? '0',
        invoicedQuantity: line.invoicedQuantity?.toString() ?? '0',
        unitPriceKobo: line.unitPriceKobo.toString(),
      })),
    }));
  }

  /**
   * Move on any order whose workflow has been decided without it.
   *
   * Same gap `ProcurementFlowService.reconcileStrandedOrders` names: a sales
   * order posts nothing on approval, so nothing was writing the outcome back
   * onto the row unless something reads it and asks.
   */
  private async reconcileStrandedOrders(companyId: string): Promise<void> {
    const submitted = await this.prisma.salesOrder.findMany({
      where: {
        companyId,
        status: SalesOrderStatus.SUBMITTED,
        workflowTransactionId: { not: null },
      },
      select: { id: true, workflowTransactionId: true },
      take: 100,
    });
    if (submitted.length === 0) return;

    const decided = await this.prisma.workflowTransaction.findMany({
      where: {
        id: { in: submitted.map((order) => order.workflowTransactionId!) },
        status: { in: ['APPROVED', 'POSTED', 'REJECTED', 'CANCELLED'] },
      },
      select: { id: true },
    });
    if (decided.length === 0) return;

    const decidedIds = new Set(decided.map((transaction) => transaction.id));
    for (const order of submitted) {
      if (decidedIds.has(order.workflowTransactionId!)) {
        await this.orders.syncStatus(order.id);
      }
    }
  }

  async order(companyId: string, id: string) {
    const orders = await this.listOrders(companyId);
    const order = orders.find((entry) => entry.id === id);
    if (!order) throw new NotFoundException('No such sales order.');
    return order;
  }

  /** Approve an order so goods can be shipped against it. */
  async approveOrder(params: { companyId: string; id: string; actor: WorkflowActor }) {
    const transaction = await this.prisma.workflowTransaction.findFirst({
      where: {
        companyId: params.companyId,
        documentId: params.id,
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
      },
      select: { id: true },
    });
    if (!transaction) {
      throw new NotFoundException('That order is not waiting for approval.');
    }

    const result = await this.workflow.approve({
      transactionId: transaction.id,
      actor: params.actor,
    });

    await this.orders.syncStatus(params.id);
    return result;
  }

  /**
   * Deliveries, newest first, and what each one did to the ledger.
   *
   * Whether a journal fired here depends on the company's COGS-recognition
   * point — a delivery that carries no journal is not necessarily wrong;
   * see `deferredCogs` on each row.
   */
  async listDeliveries(companyId: string) {
    const deliveries = await this.prisma.deliveryNote.findMany({
      where: { companyId },
      orderBy: { deliveryDate: 'desc' },
      take: 60,
      select: {
        id: true,
        deliveryNumber: true,
        deliveryDate: true,
        status: true,
        totalCostKobo: true,
        journalEntryId: true,
        customer: { select: { name: true } },
        salesOrder: { select: { orderNumber: true } },
        _count: { select: { lines: true } },
      },
    });

    const journalIds = deliveries
      .map((delivery) => delivery.journalEntryId)
      .filter((id): id is string => Boolean(id));
    const journals = await this.prisma.journalEntry.findMany({
      where: { id: { in: journalIds } },
      select: { id: true, journalNumber: true },
    });
    const journalNumber = new Map(journals.map((entry) => [entry.id, entry.journalNumber]));

    return deliveries.map((delivery) => ({
      id: delivery.id,
      deliveryNumber: delivery.deliveryNumber,
      deliveryDate: delivery.deliveryDate,
      status: delivery.status,
      customer: delivery.customer.name,
      orderNumber: delivery.salesOrder.orderNumber,
      lineCount: delivery._count.lines,
      costKobo: delivery.totalCostKobo.toString(),
      journalEntryId: delivery.journalEntryId,
      journalNumber: delivery.journalEntryId
        ? (journalNumber.get(delivery.journalEntryId) ?? null)
        : null,
      deferredCogs: delivery.status === DeliveryStatus.POSTED && !delivery.journalEntryId,
    }));
  }

  /**
   * Ship goods against an approved order.
   *
   * Records the note and submits it for approval. Approving is what moves
   * the ledger — the engine refuses an approval from whoever submitted it,
   * so recording and approving in one call would fail every time for the
   * person who did the work.
   */
  async deliver(params: {
    companyId: string;
    actor: WorkflowActor;
    salesOrderId: string;
    deliveryDate: Date;
    driverName?: string | null;
    vehicleNumber?: string | null;
    receivedBy?: string | null;
    lines: Array<{ salesOrderLineId: string; quantity: string; batchReference?: string | null }>;
  }) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: params.salesOrderId, companyId: params.companyId },
      select: { id: true, orderNumber: true },
    });
    if (!order) throw new NotFoundException('No such sales order.');

    const deliverable = params.lines.filter((line) => Number(line.quantity) > 0);
    if (deliverable.length === 0) {
      throw new BadRequestException('Enter what is actually going out.');
    }

    const period = await this.prisma.financialPeriod.findFirst({
      where: {
        financialYear: { companyId: params.companyId },
        startDate: { lte: params.deliveryDate },
        endDate: { gte: params.deliveryDate },
      },
      select: { id: true, financialYearId: true, status: true, name: true },
    });
    if (!period) {
      throw new BadRequestException(
        `No financial period covers ${params.deliveryDate.toISOString().slice(0, 10)}.`,
      );
    }
    if (period.status !== 'OPEN') {
      throw new BadRequestException(
        `${period.name} is ${period.status.toLowerCase()}. Goods cannot be shipped into a closed period.`,
      );
    }

    const delivery = await this.deliveries.create({
      salesOrderId: order.id,
      deliveryNumber: deliveryNumber(order.orderNumber, params.deliveryDate),
      deliveryDate: params.deliveryDate,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      driverName: params.driverName ?? null,
      vehicleNumber: params.vehicleNumber ?? null,
      receivedBy: params.receivedBy ?? null,
      lines: deliverable.map((line) => ({
        salesOrderLineId: line.salesOrderLineId,
        quantity: line.quantity,
        batchReference: line.batchReference ?? null,
      })),
      actor: params.actor,
    });

    const submitted = await this.deliveries.submit({
      deliveryNoteId: delivery.id,
      actor: params.actor,
    });

    return {
      deliveryId: delivery.id,
      deliveryNumber: delivery.deliveryNumber,
      status: delivery.status,
      costKobo: delivery.totalCostKobo.toString(),
      awaitingApproval: submitted.transactionId,
    };
  }

  /** Invoices, newest first, with what is still owed on each. */
  async listInvoices(companyId: string) {
    const rows = await this.prisma.salesInvoice.findMany({
      where: { companyId },
      orderBy: { invoiceDate: 'desc' },
      take: 60,
      include: { customer: { select: { id: true, name: true } }, salesOrder: { select: { orderNumber: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      orderNumber: row.salesOrder?.orderNumber ?? null,
      customerId: row.customer.id,
      customer: row.customer.name,
      invoiceDate: row.invoiceDate,
      dueDate: row.dueDate,
      status: row.status,
      grossAmountKobo: row.grossAmountKobo.toString(),
      settledAmountKobo: row.settledAmountKobo.toString(),
      outstandingKobo: (row.grossAmountKobo - row.settledAmountKobo).toString(),
    }));
  }

  /** Invoices with an outstanding balance, for the receive-payment screen. */
  async receivableInvoices(companyId: string) {
    const invoices = await this.listInvoices(companyId);
    return invoices.filter(
      (invoice) =>
        (invoice.status === 'POSTED' || invoice.status === 'PART_PAID') &&
        BigInt(invoice.outstandingKobo) > 0n,
    );
  }

  /**
   * Raise an invoice for whatever an order has delivered but not yet billed.
   *
   * No line entry is asked for: `SalesInvoiceService.createFromOrder` reads
   * delivered-minus-invoiced off the order itself, the same "the record
   * already knows" reasoning as reading a goods receipt's outstanding
   * quantity in procurement.
   */
  async raiseInvoice(params: {
    companyId: string;
    actor: WorkflowActor;
    salesOrderId: string;
    invoiceDate: Date;
  }) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: params.salesOrderId, companyId: params.companyId },
      select: { id: true, orderNumber: true },
    });
    if (!order) throw new NotFoundException('No such sales order.');

    const period = await this.prisma.financialPeriod.findFirst({
      where: {
        financialYear: { companyId: params.companyId },
        startDate: { lte: params.invoiceDate },
        endDate: { gte: params.invoiceDate },
      },
      select: { id: true, financialYearId: true, status: true, name: true },
    });
    if (!period) {
      throw new BadRequestException(
        `No financial period covers ${params.invoiceDate.toISOString().slice(0, 10)}.`,
      );
    }
    if (period.status !== 'OPEN') {
      throw new BadRequestException(
        `${period.name} is ${period.status.toLowerCase()}. An invoice cannot be raised in a closed period.`,
      );
    }

    const invoice = await this.invoices.createFromOrder({
      salesOrderId: order.id,
      invoiceNumber: invoiceNumberFrom(order.orderNumber, params.invoiceDate),
      invoiceDate: params.invoiceDate,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      actor: params.actor,
    });

    const submitted = await this.invoices.submit({ invoiceId: invoice.id, actor: params.actor });

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      grossAmountKobo: invoice.grossAmountKobo.toString(),
      awaitingApproval: submitted.transactionId,
    };
  }

  /**
   * Receive a customer's payment against one or more of their posted invoices.
   *
   * Same shape as `recordSupplierPayment`: the bank account and the amount
   * per invoice are what a treasury officer actually decides; company,
   * currency and the financial period come from context.
   */
  async recordReceipt(params: {
    companyId: string;
    actor: WorkflowActor;
    customerId: string;
    receiptDate: Date;
    method: 'BANK_TRANSFER' | 'CASH' | 'CHEQUE';
    bankGlAccountId: string;
    reference?: string | null;
    allocations: Array<{ invoiceId: string; amountKobo: string }>;
  }) {
    const funded = params.allocations.filter((line) => Number(line.amountKobo) > 0);
    if (funded.length === 0) {
      throw new BadRequestException('Enter how much is being received against at least one invoice.');
    }

    const customer = await this.prisma.customer.findFirst({
      where: { id: params.customerId, companyId: params.companyId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('No such customer.');

    const context = await this.prisma.company.findUniqueOrThrow({
      where: { id: params.companyId },
      select: {
        baseCurrencyId: true,
        branches: { where: { active: true }, take: 1, select: { id: true } },
      },
    });
    const branch = context.branches[0];
    if (!branch) throw new BadRequestException('This company has no active branch.');

    const period = await this.prisma.financialPeriod.findFirst({
      where: {
        financialYear: { companyId: params.companyId },
        startDate: { lte: params.receiptDate },
        endDate: { gte: params.receiptDate },
      },
      select: { id: true, financialYearId: true, status: true, name: true },
    });
    if (!period) {
      throw new BadRequestException(
        `No financial period covers ${params.receiptDate.toISOString().slice(0, 10)}.`,
      );
    }
    if (period.status !== 'OPEN') {
      throw new BadRequestException(
        `${period.name} is ${period.status.toLowerCase()}. A receipt cannot be entered into a closed period.`,
      );
    }

    const receipt = await this.receipts.create({
      companyId: params.companyId,
      receiptNumber: receiptNumber(customer.id, params.receiptDate),
      customerId: params.customerId,
      receiptDate: params.receiptDate,
      method: params.method,
      bankGlAccountId: params.bankGlAccountId,
      reference: params.reference ?? null,
      branchId: branch.id,
      currencyId: context.baseCurrencyId,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      amountKobo: funded.reduce((sum, line) => sum + BigInt(line.amountKobo), 0n),
      allocations: funded.map((line) => ({
        invoiceId: line.invoiceId,
        amountKobo: BigInt(line.amountKobo),
      })),
      actor: params.actor,
    });

    const submitted = await this.receipts.submit({ receiptId: receipt.id, actor: params.actor });

    return {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      amountKobo: receipt.amountKobo.toString(),
      awaitingApproval: submitted.transactionId,
    };
  }
}

/** A delivery number derived from the order and the day. */
function deliveryNumber(orderNumber: string, date: Date): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `DN-${orderNumber.replace(/^SO-/, '')}-${day}`;
}

/** An invoice number derived from the order and the day. */
function invoiceNumberFrom(orderNumber: string, date: Date): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `SI-${orderNumber.replace(/^SO-/, '')}-${day}`;
}

/** A receipt number from the customer and the day. */
function receiptNumber(customerId: string, date: Date): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `RCT-${customerId.slice(0, 8).toUpperCase()}-${day}-${Date.now().toString().slice(-4)}`;
}
