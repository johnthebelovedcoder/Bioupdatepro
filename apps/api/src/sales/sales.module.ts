import { Module, OnModuleInit } from '@nestjs/common';
import { SalesPricingService } from './sales-pricing.service';
import { SalesOrderService } from './sales-order.service';
import { DeliveryService } from './delivery.service';
import { SalesInvoiceService } from './sales-invoice.service';
import { CustomerReceiptService } from './customer-receipt.service';
import { CreditNoteService } from './credit-note.service';
import { SalesFlowService } from './sales-flow.service';
import {
  CreditNotePostingHandler,
  CustomerReceiptPostingHandler,
  DeliveryPostingHandler,
  SalesInvoicePostingHandler,
} from './sales.handlers';
import { WorkflowService } from '../workflow/workflow.service';

/** Order-to-Cash (§6). */
@Module({
  providers: [
    SalesPricingService,
    SalesOrderService,
    DeliveryService,
    SalesInvoiceService,
    CustomerReceiptService,
    CreditNoteService,
    SalesFlowService,
    DeliveryPostingHandler,
    SalesInvoicePostingHandler,
    CustomerReceiptPostingHandler,
    CreditNotePostingHandler,
  ],
  exports: [
    SalesPricingService,
    SalesOrderService,
    DeliveryService,
    SalesInvoiceService,
    CustomerReceiptService,
    CreditNoteService,
    // Exported because SalesController is registered in AppModule.
    SalesFlowService,
  ],
})
export class SalesModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly delivery: DeliveryPostingHandler,
    private readonly invoice: SalesInvoicePostingHandler,
    private readonly receipt: CustomerReceiptPostingHandler,
    private readonly creditNote: CreditNotePostingHandler,
  ) {}

  onModuleInit(): void {
    this.workflow.register(this.delivery);
    this.workflow.register(this.invoice);
    this.workflow.register(this.receipt);
    this.workflow.register(this.creditNote);
  }
}
