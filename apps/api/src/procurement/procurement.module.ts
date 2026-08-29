import { Module, OnModuleInit } from '@nestjs/common';
import { ProcurementConfigService } from './procurement-config.service';
import { PurchaseOrderService } from './purchase-order.service';
import { GoodsReceiptService } from './goods-receipt.service';
import { SupplierInvoiceService } from './supplier-invoice.service';
import { SupplierPaymentService } from './supplier-payment.service';
import { ProcurementFlowService } from './procurement-flow.service';
import {
  GoodsReceiptExceptionPostingHandler,
  GoodsReceiptPostingHandler,
  SupplierInvoiceExceptionPostingHandler,
  SupplierInvoicePostingHandler,
  SupplierPaymentPostingHandler,
} from './procurement.handlers';
import { WorkflowService } from '../workflow/workflow.service';

/** Procure-to-Pay (§5). */
@Module({
  providers: [
    ProcurementConfigService,
    PurchaseOrderService,
    GoodsReceiptService,
    SupplierInvoiceService,
    SupplierPaymentService,
    ProcurementFlowService,
    GoodsReceiptPostingHandler,
    GoodsReceiptExceptionPostingHandler,
    SupplierInvoicePostingHandler,
    SupplierInvoiceExceptionPostingHandler,
    SupplierPaymentPostingHandler,
  ],
  exports: [
    ProcurementConfigService,
    PurchaseOrderService,
    GoodsReceiptService,
    SupplierInvoiceService,
    SupplierPaymentService,
    // Exported because ProcurementController is registered in AppModule.
    ProcurementFlowService,
  ],
})
export class ProcurementModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly grn: GoodsReceiptPostingHandler,
    private readonly grnException: GoodsReceiptExceptionPostingHandler,
    private readonly invoice: SupplierInvoicePostingHandler,
    private readonly exception: SupplierInvoiceExceptionPostingHandler,
    private readonly payment: SupplierPaymentPostingHandler,
  ) {}

  onModuleInit(): void {
    this.workflow.register(this.grn);
    this.workflow.register(this.grnException);
    this.workflow.register(this.invoice);
    this.workflow.register(this.exception);
    this.workflow.register(this.payment);
  }
}
