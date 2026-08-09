import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { DeliveryService } from './delivery.service';
import { SalesInvoiceService } from './sales-invoice.service';
import { CustomerReceiptService } from './customer-receipt.service';
import { CreditNoteService } from './credit-note.service';
import { WorkflowActor, WorkflowPostingHandler } from '../workflow/workflow.types';

/**
 * O2C posting handlers (§6).
 *
 * Four documents, four handlers, one engine. Each reads its own document from
 * the database inside the approval transaction rather than trusting a payload
 * captured at submit time.
 */

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
export class DeliveryPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'GOODS_ISSUE';

  constructor(
    @Inject(forwardRef(() => DeliveryService))
    private readonly deliveries: DeliveryService,
  ) {}

  async post(input: HandlerInput): Promise<{ journalEntryId: string | null }> {
    return this.deliveries.postApproved({
      deliveryNoteId: await documentId(input),
      actor: input.actor,
      tx: input.tx,
    });
  }
}

@Injectable()
export class SalesInvoicePostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'SALES_INVOICE';

  constructor(
    @Inject(forwardRef(() => SalesInvoiceService))
    private readonly invoices: SalesInvoiceService,
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
export class CustomerReceiptPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'CUSTOMER_RECEIPT';

  constructor(
    @Inject(forwardRef(() => CustomerReceiptService))
    private readonly receipts: CustomerReceiptService,
  ) {}

  async post(input: HandlerInput): Promise<{ journalEntryId: string }> {
    return this.receipts.postApproved({
      receiptId: await documentId(input),
      actor: input.actor,
      tx: input.tx,
    });
  }
}

@Injectable()
export class CreditNotePostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'CREDIT_NOTE';

  constructor(
    @Inject(forwardRef(() => CreditNoteService))
    private readonly creditNotes: CreditNoteService,
  ) {}

  async post(input: HandlerInput): Promise<{ journalEntryId: string }> {
    return this.creditNotes.postApproved({
      creditNoteId: await documentId(input),
      actor: input.actor,
      tx: input.tx,
    });
  }
}
