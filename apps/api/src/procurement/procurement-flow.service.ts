import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PurchaseOrderStatus, QualityStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { GoodsReceiptService } from './goods-receipt.service';
import { PurchaseOrderService } from './purchase-order.service';
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
