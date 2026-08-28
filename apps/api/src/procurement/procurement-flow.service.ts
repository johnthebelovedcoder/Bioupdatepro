import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PurchaseOrderStatus, QualityStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { GoodsReceiptService } from './goods-receipt.service';
import { PurchaseOrderService } from './purchase-order.service';
import { SupplierInvoiceService } from './supplier-invoice.service';
import { SupplierPaymentService } from './supplier-payment.service';
import { WorkflowService } from '../workflow/workflow.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * The buying chain, as a person walks it.
 *
 * The pieces all existed and none of them were reachable: a purchase order
 * could be raised from a phone, and then nothing could approve it, and nothing
 * could receive against it. This is the orchestration between them — approve
 * an order, then receive goods into stock — so the sequence the client
 * described can actually be performed rather than described.
 *
 * The accounting moment is the receipt, and it is worth being precise about
 * why. Raising an order commits the farm to nothing in the ledger: no journal,
 * no balance, nothing on a report. The entry fires when the goods physically
 * arrive — `Dr Inventory / Cr GRNI` — because that is the instant the farm has
 * something it did not have before and owes for something it has not been
 * billed for. Posting at the order would recognise stock nobody has yet.
 */
@Injectable()
export class ProcurementFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receipts: GoodsReceiptService,
    private readonly orders: PurchaseOrderService,
    private readonly workflow: WorkflowService,
    private readonly invoices: SupplierInvoiceService,
    private readonly payments: SupplierPaymentService,
  ) {}

  /** Orders, newest first, with what can be done to each. */
  async listOrders(companyId: string) {
    await this.reconcileStrandedOrders(companyId);

    const orders = await this.prisma.purchaseOrder.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        supplier: { select: { name: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, description: true, itemType: true } } },
        },
      },
    });

    /*
     * The approval is a workflow transaction, not a field on the order, so the
     * id to act on has to be looked up. Fetched for the whole page in one
     * query rather than one per row.
     */
    const transactions = await this.prisma.workflowTransaction.findMany({
      where: {
        companyId,
        documentId: { in: orders.map((order) => order.id) },
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
      },
      select: { id: true, documentId: true, status: true },
    });
    const pending = new Map(transactions.map((t) => [t.documentId, t]));

    return orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      supplier: order.supplier.name,
      status: order.status,
      orderDate: order.orderDate,
      netKobo: order.lines
        .reduce((sum, line) => sum + (line.netAmountKobo ?? 0n), 0n)
        .toString(),
      lineCount: order.lines.length,
      /** Set when this order is waiting for somebody to approve it. */
      pendingTransactionId: pending.get(order.id)?.id ?? null,
      canReceive:
        order.status === PurchaseOrderStatus.APPROVED ||
        order.status === PurchaseOrderStatus.PARTIALLY_RECEIVED,
      lines: order.lines.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        itemCode: line.item.code,
        description: line.item.description,
        itemType: line.item.itemType,
        orderedQuantity: line.quantity.toString(),
        receivedQuantity: line.receivedQuantity?.toString() ?? '0',
        unitPriceKobo: line.unitPriceKobo.toString(),
      })),
    }));
  }

  /**
   * Move on any order whose workflow has been decided without it.
   *
   * Approving a purchase order posts nothing, so the engine runs no handler and
   * writes nothing back to the order. That is fine when the approval came
   * through the procurement route, which calls `syncStatus` itself — and not
   * fine when it came through the shared approvals queue, which knows nothing
   * about purchase orders. An order left in that state is stranded: the
   * workflow says approved, the row still says submitted, so the screen offers
   * neither an approval nor a receipt and nobody can act on it again.
   *
   * Reconciling on read is not the long-term home for this. A post-approval
   * hook on the workflow engine is, and is worth building when a second
   * document type needs one. Until then this is cheap, idempotent, and touches
   * only rows that genuinely disagree with their own workflow.
   */
  private async reconcileStrandedOrders(companyId: string): Promise<void> {
    // Two queries rather than a join: the order carries the transaction id as
    // a plain column, with no Prisma relation to filter through.
    const submitted = await this.prisma.purchaseOrder.findMany({
      where: {
        companyId,
        status: PurchaseOrderStatus.SUBMITTED,
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

  /**
   * Goods received, newest first, and what each one did to the ledger.
   *
   * The journal reference is the point of this list. A receipt that is sitting
   * at SUBMITTED has moved stock on paper and moved nothing in the accounts,
   * and the difference between the two states is the whole reason the client
   * asked for this screen.
   */
  async listReceipts(companyId: string) {
    const receipts = await this.prisma.goodsReceiptNote.findMany({
      where: { companyId },
      orderBy: { receiptDate: 'desc' },
      take: 60,
      select: {
        id: true,
        grnNumber: true,
        receiptDate: true,
        status: true,
        qualityStatus: true,
        totalValueKobo: true,
        journalEntryId: true,
        supplier: { select: { name: true } },
        purchaseOrder: { select: { orderNumber: true } },
        _count: { select: { lines: true } },
      },
    });

    const journalIds = receipts
      .map((receipt) => receipt.journalEntryId)
      .filter((id): id is string => Boolean(id));
    const journals = await this.prisma.journalEntry.findMany({
      where: { id: { in: journalIds } },
      select: { id: true, journalNumber: true },
    });
    const journalNumber = new Map(journals.map((entry) => [entry.id, entry.journalNumber]));

    return receipts.map((receipt) => ({
      id: receipt.id,
      grnNumber: receipt.grnNumber,
      receiptDate: receipt.receiptDate,
      status: receipt.status,
      qualityStatus: receipt.qualityStatus,
      supplier: receipt.supplier.name,
      orderNumber: receipt.purchaseOrder.orderNumber,
      lineCount: receipt._count.lines,
      valueKobo: receipt.totalValueKobo.toString(),
      journalEntryId: receipt.journalEntryId,
      journalNumber: receipt.journalEntryId
        ? (journalNumber.get(receipt.journalEntryId) ?? null)
        : null,
    }));
  }

  async order(companyId: string, id: string) {
    const orders = await this.listOrders(companyId);
    const order = orders.find((entry) => entry.id === id);
    if (!order) throw new NotFoundException('No such purchase order.');
    return order;
  }

  /**
   * Approve an order so goods can be received against it.
   *
   * The actor comes from the session. Maker-checker still applies underneath —
   * the engine refuses an approval from whoever raised it, including when they
   * hold the required role.
   */
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

    /*
     * Then move the order itself.
     *
     * Approving a purchase order posts nothing, so no posting handler runs,
     * so nothing was writing the outcome back onto the order — it stayed
     * SUBMITTED with an APPROVED workflow behind it, and goods could never be
     * received against it. `syncStatus` was written for exactly this and had
     * no caller anywhere in the application.
     */
    await this.orders.syncStatus(params.id);

    return result;
  }

  /**
   * Receive goods against an approved order.
   *
   * Records the note and submits it for approval. It deliberately stops there.
   * Approving is what fires `Dr Inventory / Cr GRNI`, and the engine refuses an
   * approval from whoever submitted it — so a call that tried to record and
   * approve in one go would fail every time, for the person who did the work.
   * Somebody else confirms it, from the approvals screen.
   */
  async receive(params: {
    companyId: string;
    actor: WorkflowActor;
    purchaseOrderId: string;
    receiptDate: Date;
    deliveryNoteReference?: string | null;
    lines: Array<{
      purchaseOrderLineId: string;
      receivedQuantity: string;
      rejectedQuantity?: string;
      batchReference?: string | null;
    }>;
  }) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: params.purchaseOrderId, companyId: params.companyId },
      select: { id: true, orderNumber: true },
    });
    if (!order) throw new NotFoundException('No such purchase order.');

    const receivable = params.lines.filter((line) => Number(line.receivedQuantity) > 0);
    if (receivable.length === 0) {
      throw new BadRequestException('Enter what actually arrived.');
    }

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
        `${period.name} is ${period.status.toLowerCase()}. Goods cannot be received into a closed period.`,
      );
    }

    /*
     * The inspection outcome, read off what was actually entered rather than
     * asked as a separate question. Submitting refuses a receipt still marked
     * PENDING — goods nobody has looked at have not been accepted — and the
     * person typing rejected quantities has plainly looked.
     */
    const anyRejected = receivable.some((line) => Number(line.rejectedQuantity ?? 0) > 0);
    const allRejected = receivable.every(
      (line) => Number(line.rejectedQuantity ?? 0) >= Number(line.receivedQuantity),
    );
    const qualityStatus = allRejected
      ? QualityStatus.FAILED
      : anyRejected
        ? QualityStatus.PARTIAL
        : QualityStatus.PASSED;

    const grn = await this.receipts.create({
      purchaseOrderId: order.id,
      grnNumber: receiptNumber(order.orderNumber, params.receiptDate),
      receiptDate: params.receiptDate,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      deliveryNoteReference: params.deliveryNoteReference ?? null,
      qualityStatus,
      lines: receivable.map((line) => ({
        purchaseOrderLineId: line.purchaseOrderLineId,
        receivedQuantity: line.receivedQuantity,
        ...(line.rejectedQuantity ? { rejectedQuantity: line.rejectedQuantity } : {}),
        ...(line.batchReference ? { batchReference: line.batchReference } : {}),
      })),
      actor: params.actor,
    });

    const submitted = await this.receipts.submit({ grnId: grn.id, actor: params.actor });

    const stored = await this.prisma.goodsReceiptNote.findUniqueOrThrow({
      where: { id: grn.id },
      select: { id: true, grnNumber: true, status: true, totalValueKobo: true },
    });

    return {
      grnId: stored.id,
      grnNumber: stored.grnNumber,
      status: stored.status,
      qualityStatus,
      valueKobo: stored.totalValueKobo.toString(),
      /** Who has to confirm it before the ledger moves. */
      awaitingApproval: submitted?.transactionId ?? null,
    };
  }

  /**
   * One goods receipt, with what is left to bill on each line.
   *
   * `acceptedQuantity - invoicedQuantity` is the field the supplier-invoice
   * service itself checks before it will clear GRNI (see `resolveLineSource`
   * there) — reading the same figure here, rather than recomputing it, is
   * what keeps "what can I still invoice" on this screen from ever disagreeing
   * with what the posting will actually allow.
   */
  async receiptDetail(companyId: string, id: string) {
    const grn = await this.prisma.goodsReceiptNote.findFirst({
      where: { id, companyId },
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        purchaseOrder: { select: { id: true, orderNumber: true } },
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, description: true } } },
        },
      },
    });
    if (!grn) throw new NotFoundException('No such goods receipt.');

    return {
      id: grn.id,
      grnNumber: grn.grnNumber,
      status: grn.status,
      receiptDate: grn.receiptDate,
      supplierId: grn.supplier.id,
      supplier: grn.supplier.name,
      purchaseOrderId: grn.purchaseOrder.id,
      orderNumber: grn.purchaseOrder.orderNumber,
      lines: grn.lines.map((line) => ({
        id: line.id,
        itemCode: line.item.code,
        description: line.item.description,
        acceptedQuantity: line.acceptedQuantity.toString(),
        invoicedQuantity: line.invoicedQuantity.toString(),
        outstandingQuantity: line.acceptedQuantity.minus(line.invoicedQuantity).toString(),
        unitPriceKobo: line.unitPriceKobo.toString(),
      })),
    };
  }

  /**
   * Enter a supplier's invoice against a goods receipt.
   *
   * The context a raw `SupplierInvoiceService.create()` call needs —
   * supplier, currency, branch, farm, department, cost centre, financial
   * period — is not asked of whoever is entering the bill: every one of it
   * is already sitting on the goods receipt or its order. Asked for is
   * exactly what the vendor's own invoice states: their reference number,
   * the date, and what they billed per line. Same shape as `receive()`
   * above, for the same reason.
   */
  async recordSupplierInvoice(params: {
    companyId: string;
    actor: WorkflowActor;
    goodsReceiptNoteId: string;
    supplierInvoiceNumber: string;
    invoiceDate: Date;
    lines: Array<{ goodsReceiptNoteLineId: string; quantity: string; unitPriceKobo: string }>;
  }) {
    const grn = await this.prisma.goodsReceiptNote.findFirst({
      where: { id: params.goodsReceiptNoteId, companyId: params.companyId },
      include: { purchaseOrder: true },
    });
    if (!grn) throw new NotFoundException('No such goods receipt.');

    const billable = params.lines.filter((line) => Number(line.quantity) > 0);
    if (billable.length === 0) {
      throw new BadRequestException('Enter what the supplier actually billed.');
    }

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
        `${period.name} is ${period.status.toLowerCase()}. An invoice cannot be entered into a closed period.`,
      );
    }

    const order = grn.purchaseOrder;
    const invoice = await this.invoices.create({
      companyId: params.companyId,
      invoiceNumber: invoiceNumber(grn.grnNumber),
      supplierInvoiceNumber: params.supplierInvoiceNumber,
      supplierId: order.supplierId,
      purchaseOrderId: order.id,
      invoiceDate: params.invoiceDate,
      currencyId: order.currencyId,
      branchId: order.branchId,
      farmId: order.farmId,
      departmentId: order.departmentId,
      costCentreId: order.costCentreId,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      lines: billable.map((line) => ({
        goodsReceiptNoteLineId: line.goodsReceiptNoteLineId,
        quantity: line.quantity,
        unitPriceKobo: BigInt(line.unitPriceKobo),
      })),
      actor: params.actor,
    });

    const submitted = await this.invoices.submit({ invoiceId: invoice.id, actor: params.actor });

    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
      grossAmountKobo: invoice.grossAmountKobo.toString(),
      matchStatus: submitted.match.status,
      awaitingApproval: submitted.transactionId,
    };
  }

  /** Supplier invoices, newest first, with what is still owed on each. */
  async listInvoices(companyId: string) {
    const rows = await this.prisma.supplierInvoice.findMany({
      where: { companyId },
      orderBy: { invoiceDate: 'desc' },
      take: 60,
      include: { supplier: { select: { id: true, name: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      supplierInvoiceNumber: row.supplierInvoiceNumber,
      supplierId: row.supplier.id,
      supplier: row.supplier.name,
      invoiceDate: row.invoiceDate,
      dueDate: row.dueDate,
      status: row.status,
      matchStatus: row.matchStatus,
      grossAmountKobo: row.grossAmountKobo.toString(),
      paidAmountKobo: row.settledAmountKobo.toString(),
      outstandingKobo: (row.grossAmountKobo - row.settledAmountKobo).toString(),
    }));
  }

  /**
   * Invoices with an outstanding balance, for the pay-the-vendor screen.
   *
   * POSTED and PART_PAID, not APPROVED — a supplier invoice posts itself the
   * moment it clears approval (§5, autoPostOnApproval), so it never sits at
   * APPROVED at all. This is the same pair `SupplierPaymentService.create()`
   * itself checks before it will let a payment touch the invoice.
   */
  async payableInvoices(companyId: string) {
    const invoices = await this.listInvoices(companyId);
    return invoices.filter(
      (invoice) =>
        (invoice.status === 'POSTED' || invoice.status === 'PART_PAID') &&
        BigInt(invoice.outstandingKobo) > 0n,
    );
  }

  /**
   * Pay one or more of a supplier's approved invoices.
   *
   * Same shape again: the bank account, the method and the amount per
   * invoice are what a treasury officer actually decides; company, currency
   * and the financial period come from context.
   */
  async recordSupplierPayment(params: {
    companyId: string;
    actor: WorkflowActor;
    supplierId: string;
    paymentDate: Date;
    method: 'BANK_TRANSFER' | 'CASH' | 'CHEQUE';
    bankGlAccountId: string;
    reference?: string | null;
    allocations: Array<{ invoiceId: string; amountKobo: string }>;
  }) {
    const funded = params.allocations.filter((line) => Number(line.amountKobo) > 0);
    if (funded.length === 0) {
      throw new BadRequestException('Enter how much is being paid against at least one invoice.');
    }

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: params.supplierId, companyId: params.companyId },
      select: { id: true },
    });
    if (!supplier) throw new NotFoundException('No such supplier.');

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
        startDate: { lte: params.paymentDate },
        endDate: { gte: params.paymentDate },
      },
      select: { id: true, financialYearId: true, status: true, name: true },
    });
    if (!period) {
      throw new BadRequestException(
        `No financial period covers ${params.paymentDate.toISOString().slice(0, 10)}.`,
      );
    }
    if (period.status !== 'OPEN') {
      throw new BadRequestException(
        `${period.name} is ${period.status.toLowerCase()}. A payment cannot be entered into a closed period.`,
      );
    }

    const payment = await this.payments.create({
      companyId: params.companyId,
      paymentNumber: paymentNumber(supplier.id, params.paymentDate),
      supplierId: params.supplierId,
      paymentDate: params.paymentDate,
      method: params.method,
      bankGlAccountId: params.bankGlAccountId,
      reference: params.reference ?? null,
      branchId: branch.id,
      currencyId: context.baseCurrencyId,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      allocations: funded.map((line) => ({
        invoiceId: line.invoiceId,
        amountKobo: BigInt(line.amountKobo),
      })),
      actor: params.actor,
    });

    const submitted = await this.payments.submit({ paymentId: payment.id, actor: params.actor });

    return {
      paymentId: payment.id,
      paymentNumber: payment.paymentNumber,
      totalAmountKobo: payment.amountKobo.toString(),
      awaitingApproval: submitted.transactionId,
    };
  }

  /* --- Requisitions --------------------------------------------------- */

  /** Requisitions, newest first, and whether each is ready to become an order. */
  async listRequisitions(companyId: string) {
    await this.reconcileStrandedRequisitions(companyId);

    const requisitions = await this.prisma.purchaseRequisition.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: { item: { select: { code: true, description: true } } },
        },
      },
    });

    const transactions = await this.prisma.workflowTransaction.findMany({
      where: {
        companyId,
        documentId: { in: requisitions.map((requisition) => requisition.id) },
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
      },
      select: { id: true, documentId: true },
    });
    const pending = new Map(transactions.map((transaction) => [transaction.documentId, transaction.id]));

    return requisitions.map((requisition) => ({
      id: requisition.id,
      requisitionNumber: requisition.requisitionNumber,
      requestDate: requisition.requestDate,
      status: requisition.status,
      estimatedCostKobo: requisition.estimatedCostKobo.toString(),
      lineCount: requisition.lines.length,
      pendingTransactionId: pending.get(requisition.id) ?? null,
      canConvert: requisition.status === 'APPROVED',
      lines: requisition.lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        itemCode: line.item.code,
        description: line.item.description,
        quantity: line.quantity.toString(),
        orderedQuantity: line.orderedQuantity.toString(),
        outstandingQuantity: line.quantity.minus(line.orderedQuantity).toString(),
        estimatedUnitCostKobo: line.estimatedUnitCostKobo.toString(),
      })),
    }));
  }

  /**
   * Move on any requisition whose workflow has been decided without it.
   *
   * Same reason as `reconcileStrandedOrders` above: approving a requisition
   * posts nothing, so no handler runs, so nothing writes the outcome back
   * onto the row unless something reads it and asks.
   */
  private async reconcileStrandedRequisitions(companyId: string): Promise<void> {
    const submitted = await this.prisma.purchaseRequisition.findMany({
      where: { companyId, status: 'SUBMITTED', workflowTransactionId: { not: null } },
      select: { id: true, workflowTransactionId: true },
      take: 100,
    });
    if (submitted.length === 0) return;

    const decided = await this.prisma.workflowTransaction.findMany({
      where: {
        id: { in: submitted.map((requisition) => requisition.workflowTransactionId!) },
        status: { in: ['APPROVED', 'POSTED', 'REJECTED', 'CANCELLED'] },
      },
      select: { id: true },
    });
    if (decided.length === 0) return;

    const decidedIds = new Set(decided.map((transaction) => transaction.id));
    for (const requisition of submitted) {
      if (decidedIds.has(requisition.workflowTransactionId!)) {
        await this.orders.syncRequisitionStatus(requisition.id);
      }
    }
  }

  async requisitionDetail(companyId: string, id: string) {
    const requisitions = await this.listRequisitions(companyId);
    const requisition = requisitions.find((entry) => entry.id === id);
    if (!requisition) throw new NotFoundException('No such requisition.');
    return requisition;
  }

  /**
   * What a new procurement document needs beyond what the person raising it
   * decided — the same reasoning as `TradeService.tradingContext`: a branch,
   * warehouse and currency are the company's own dimensions, not something
   * to ask a requisition or an order to name for itself.
   */
  private async procurementContext(companyId: string) {
    const [company, branch, warehouse, farm] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
      this.prisma.branch.findFirst({ where: { companyId, active: true }, orderBy: { code: 'asc' } }),
      this.prisma.warehouse.findFirst({ where: { companyId, active: true }, orderBy: { code: 'asc' } }),
      this.prisma.farm.findFirst({ where: { companyId, active: true }, orderBy: { code: 'asc' } }),
    ]);
    if (!branch) throw new BadRequestException('This company has no active branch.');
    return {
      currencyId: company.baseCurrencyId,
      branchId: branch.id,
      warehouseId: warehouse?.id ?? null,
      farmId: farm?.id ?? null,
    };
  }

  /**
   * Raise a purchase requisition and send it for approval.
   *
   * §5's Procurement Officer (ROL-005) makes this — sourcing and raising a
   * PR/PO is that role's whole job. Recording is not approving: the same
   * "record then submit" convention as everything else in this chain.
   */
  async raiseRequisition(params: {
    companyId: string;
    actor: WorkflowActor;
    requestDate: Date;
    requiredDate?: Date | null;
    justification?: string | null;
    lines: Array<{ itemId: string; quantity: string }>;
  }) {
    const context = await this.procurementContext(params.companyId);

    const requisition = await this.orders.createRequisition({
      companyId: params.companyId,
      requisitionNumber: requisitionNumber(params.requestDate),
      requestDate: params.requestDate,
      requiredDate: params.requiredDate ?? null,
      branchId: context.branchId,
      farmId: context.farmId,
      currencyId: context.currencyId,
      justification: params.justification ?? null,
      lines: params.lines,
      actor: params.actor,
    });

    const submitted = await this.orders.submitRequisition({
      requisitionId: requisition.id,
      actor: params.actor,
    });

    return {
      requisitionId: requisition.id,
      requisitionNumber: requisition.requisitionNumber,
      estimatedCostKobo: requisition.estimatedCostKobo.toString(),
      awaitingApproval: submitted.transactionId,
    };
  }

  /**
   * Convert an approved requisition into a purchase order.
   *
   * Only a requisition the workflow has actually approved can be drawn down
   * — the same "control before the money" rule that already gates receiving
   * against an order applies one step earlier here.
   */
  async convertRequisitionToOrder(params: {
    companyId: string;
    actor: WorkflowActor;
    requisitionId: string;
    supplierId: string;
    orderDate: Date;
    expectedDeliveryDate?: Date | null;
    lines: Array<{
      requisitionLineId: string;
      itemId: string;
      quantity: string;
      unitPriceKobo: string;
    }>;
  }) {
    const requisition = await this.prisma.purchaseRequisition.findFirst({
      where: { id: params.requisitionId, companyId: params.companyId },
    });
    if (!requisition) throw new NotFoundException('No such requisition.');

    await this.orders.syncRequisitionStatus(requisition.id);
    const current = await this.prisma.purchaseRequisition.findUniqueOrThrow({
      where: { id: requisition.id },
    });
    if (current.status !== 'APPROVED') {
      throw new BadRequestException(
        `${current.requisitionNumber} is ${current.status.toLowerCase()}; only an approved ` +
          `requisition can become an order.`,
      );
    }

    const context = await this.procurementContext(params.companyId);
    if (!context.warehouseId) {
      throw new BadRequestException('This company has no active warehouse.');
    }

    const order = await this.orders.createOrder({
      companyId: params.companyId,
      orderNumber: orderNumberFrom(current.requisitionNumber, params.orderDate),
      supplierId: params.supplierId,
      requisitionId: current.id,
      orderDate: params.orderDate,
      expectedDeliveryDate: params.expectedDeliveryDate ?? null,
      currencyId: context.currencyId,
      branchId: context.branchId,
      warehouseId: context.warehouseId,
      farmId: context.farmId,
      costCentreId: current.costCentreId,
      departmentId: current.departmentId,
      lines: params.lines.map((line) => ({
        itemId: line.itemId,
        requisitionLineId: line.requisitionLineId,
        quantity: line.quantity,
        unitPriceKobo: BigInt(line.unitPriceKobo),
      })),
      actor: params.actor,
    });

    const submitted = await this.orders.submitOrder({
      purchaseOrderId: order.id,
      actor: params.actor,
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      grossAmountKobo: order.grossAmountKobo.toString(),
      awaitingApproval: submitted.transactionId,
    };
  }
}

/** An invoice number derived from the receipt it clears — readable, stable. */
function invoiceNumber(grnNumber: string): string {
  return `SIV-${grnNumber.replace(/^GRN-/, '')}`;
}

/** A payment number from the supplier and the day, so paying the same
 * supplier twice in one day is visibly two different numbers, not a guess. */
function paymentNumber(supplierId: string, date: Date): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `PAY-${supplierId.slice(0, 8).toUpperCase()}-${day}-${Date.now().toString().slice(-4)}`;
}

/**
 * A receipt number derived from the order and the day.
 *
 * Readable, and stable enough that receiving the same order twice on one day
 * collides rather than quietly creating a second note — which is the failure
 * worth catching, since a duplicated receipt doubles the stock and the GRNI.
 */
function receiptNumber(orderNumber: string, date: Date): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `GRN-${orderNumber.replace(/^PO-/, '')}-${day}`;
}

/** A requisition number from the day and a short random suffix. */
function requisitionNumber(date: Date): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `PR-${day}-${Date.now().toString().slice(-5)}`;
}

/** An order number that keeps the requisition it came from visible. */
function orderNumberFrom(fromRequisitionNumber: string, date: Date): string {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `PO-${fromRequisitionNumber.replace(/^PR-/, '')}-${day}`;
}
