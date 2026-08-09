import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { GoodsReceiptService } from './goods-receipt.service';
import { SupplierInvoiceService } from './supplier-invoice.service';
import { SupplierPaymentService } from './supplier-payment.service';
import { WorkflowActor, WorkflowPostingHandler } from '../workflow/workflow.types';

/** P2P posting handlers (§5). */

interface HandlerInput {
  transactionId: string;
  documentReference: string;
  payload: Prisma.JsonValue;
  actor: WorkflowActor;
  tx: Prisma.TransactionClient;
}

async function documentId(input: HandlerInput): Promise<string> {
  const transaction = await input.tx.workflowTransaction.findUniqueOrThrow({
    where: { id: input.transactionId },
    select: { documentId: true },
  });
  return transaction.documentId;
}

@Injectable()
export class GoodsReceiptPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'GOODS_RECEIPT';

  constructor(
    @Inject(forwardRef(() => GoodsReceiptService))
    private readonly receipts: GoodsReceiptService,
  ) {}

  async post(input: HandlerInput): Promise<{ journalEntryId: string | null }> {
    return this.receipts.postApproved({
      grnId: await documentId(input),
      actor: input.actor,
      tx: input.tx,
    });
  }
}

@Injectable()
export class SupplierInvoicePostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'SUPPLIER_INVOICE';

  constructor(
    @Inject(forwardRef(() => SupplierInvoiceService))
    private readonly invoices: SupplierInvoiceService,
  ) {}

  async post(input: HandlerInput): Promise<{ journalEntryId: string }> {
    return this.invoices.postApproved({
      invoiceId: await documentId(input),
      actor: input.actor,
      tx: input.tx,
    });
  }
}

/**
 * The same posting behaviour under the match-exception route. §5 sends
 * exceptions to a different approval ladder, not to a different posting — once
 * approved, an exception invoice posts exactly like a clean one.
 */
@Injectable()
export class SupplierInvoiceExceptionPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'SUPPLIER_INVOICE_EXCEPTION';

  constructor(
    @Inject(forwardRef(() => SupplierInvoiceService))
    private readonly invoices: SupplierInvoiceService,
  ) {}

  async post(input: HandlerInput): Promise<{ journalEntryId: string }> {
    return this.invoices.postApproved({
      invoiceId: await documentId(input),
      actor: input.actor,
      tx: input.tx,
    });
  }
}

@Injectable()
export class SupplierPaymentPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'SUPPLIER_PAYMENT';

  constructor(
    @Inject(forwardRef(() => SupplierPaymentService))
    private readonly payments: SupplierPaymentService,
  ) {}

  async post(input: HandlerInput): Promise<{ journalEntryId: string }> {
    return this.payments.postApproved({
      paymentId: await documentId(input),
      actor: input.actor,
      tx: input.tx,
    });
  }
}
