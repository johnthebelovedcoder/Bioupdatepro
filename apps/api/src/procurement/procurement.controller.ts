import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ProcurementFlowService } from './procurement-flow.service';
import { PurchaseOrderService } from './purchase-order.service';
import { SupplierReturnService } from './supplier-return.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { OwnedRecord } from '../auth/owned-record.guard';
import { AnyRole, Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * The buying chain over HTTP.
 *
 * Reading is open to anyone signed in — a storekeeper needs to see what is on
 * order to know what to expect off a truck. Acting is not: approving an order
 * commits the farm's money, and receiving goods writes to the ledger.
 */
@Controller('procurement')
export class ProcurementController {
  constructor(
    private readonly flow: ProcurementFlowService,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly returns: SupplierReturnService,
  ) {}

  // --- Returns to suppliers and debit notes (handbook §35) -----------------

  @AnyRole('What went back to a supplier is part of the buying record.')
  @Get('returns')
  async listReturns(@CurrentCompany() companyId: string) {
    return this.returns.list(companyId);
  }

  @OwnedRecord('goodsReceiptNote', 'id')
  @AnyRole('What can still go back on a receipt is part of the buying record.')
  @Get('receipts/:id/returnable')
  async returnable(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.returns.returnable(companyId, id);
  }

  @Roles('STOREKEEPER', 'PROCUREMENT_OFFICER', 'FARM_MANAGER', 'FARM_ACCOUNTANT', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('returns')
  async requestReturn(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { grnId: string; returnDate: string; reason: string; lines: Array<{ grnLineId: string; quantity: string }> },
  ) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(body?.returnDate ?? '')) throw new BadRequestException('returnDate must be a date, YYYY-MM-DD.');
    if (!Array.isArray(body.lines)) throw new BadRequestException('lines is a list of receipt lines and quantities.');
    return this.returns.request({
      companyId,
      grnId: String(body.grnId ?? ''),
      returnDate: new Date(`${body.returnDate}T00:00:00.000Z`),
      reason: String(body.reason ?? ''),
      lines: body.lines.map((l) => ({ grnLineId: String(l.grnLineId), quantity: String(l.quantity ?? '') })),
      actor,
    });
  }

  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('returns/:id/decide')
  async decideReturn(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { decision: 'APPROVE' | 'REJECT'; note?: string },
  ) {
    if (body?.decision !== 'APPROVE' && body?.decision !== 'REJECT') throw new BadRequestException('decision is APPROVE or REJECT.');
    return this.returns.decide({ companyId, returnId: id, decision: body.decision, note: body.note ?? null, actor });
  }

  // --- Purchase budgets (INT-002) ------------------------------------------

  @AnyRole('A budget is what an order is checked against; anyone raising one needs to see it.')
  @Get('budgets')
  async budgets(@CurrentCompany() companyId: string, @Query('financialYearId') financialYearId: string) {
    return this.purchaseOrders.budgets(companyId, String(financialYearId ?? ''));
  }

  @Roles('FINANCE_CONTROLLER', 'CFO', 'ADMINISTRATOR')
  @Post('budgets')
  async setBudget(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { financialYearId: string; costCentreId: string; amountKobo: string; note?: string },
  ) {
    const budget = await this.purchaseOrders.setBudget({
      companyId,
      financialYearId: String(body?.financialYearId ?? ''),
      costCentreId: String(body?.costCentreId ?? ''),
      amountKobo: BigInt(String(body?.amountKobo ?? '0')),
      note: body?.note,
      actor,
    });
    return { id: budget.id, amountKobo: budget.amountKobo.toString() };
  }

  @AnyRole('Seeing what is on order is how anyone knows what to expect.')
  @Get('orders')
  async orders(@CurrentCompany() companyId: string) {
    return this.flow.listOrders(companyId);
  }

  @OwnedRecord('purchaseOrder', 'id')
  @AnyRole('Seeing what is on order is how anyone knows what to expect.')
  @Get('orders/:id')
  async order(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.flow.order(companyId, id);
  }

  /**
   * Approve an order.
   *
   * The roles are the §2 approval ladder — the engine still checks the rung
   * against the amount, so a farm manager approving a ₦4m order is refused
   * there rather than here. This list only keeps the request from reaching an
   * engine that would refuse it anyway.
   */
  @OwnedRecord('purchaseOrder', 'id')
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('orders/:id/approve')
  async approveOrder(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
  ) {
    return this.flow.approveOrder({ companyId, id, actor });
  }

  /**
   * Amend a draft order's lines — a price or quantity correction. Refused
   * once the order has left DRAFT (submitted, approved, received against):
   * a correction to a commitment already in flight is a new document, not
   * an edit to this one.
   */
  @OwnedRecord('purchaseOrder', 'id')
  @Roles('PROCUREMENT_OFFICER', 'FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('orders/:id/amend')
  async amendOrder(
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body()
    body: {
      lines: Array<{
        itemId: string;
        description?: string;
        requisitionLineId?: string | null;
        quantity: string;
        unitPriceKobo: string;
        taxCode?: string | null;
      }>;
    },
  ) {
    return this.flow.amendOrder({ id, actor, lines: body.lines });
  }

  /**
   * (Re)submit a draft order for approval — a new order's first submission
   * happens automatically on conversion, so the case this route exists for
   * is an amended order going back for approval after a return.
   */
  @OwnedRecord('purchaseOrder', 'id')
  @Roles('PROCUREMENT_OFFICER', 'FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('orders/:id/submit')
  async submitOrder(@CurrentUser() actor: WorkflowActor, @Param('id') id: string) {
    return this.flow.submitOrder({ id, actor });
  }

  @AnyRole('What has been received, and what it did to the ledger.')
  @Get('receipts')
  async receipts(@CurrentCompany() companyId: string) {
    return this.flow.listReceipts(companyId);
  }

  /**
   * Record goods arriving.
   *
   * The supervisor on the ground receives stock, so the role list is wider
   * than the approval ladder — but recording is not posting. This creates the
   * note and sends it for confirmation; the ledger moves when somebody else
   * approves it.
   *
   * STOREKEEPER (ROL-006) is the RACI sheet's actual maker of a goods receipt
   * — "Receive, issue, transfer and count inventory" is their whole job — and
   * had no route to this endpoint at all until now, which is exactly the gap
   * the comment above already named for PRODUCTION_SUPERVISOR.
   */
  @Roles(
    'PRODUCTION_SUPERVISOR',
    'STOREKEEPER',
    'FARM_MANAGER',
    'FINANCE_MANAGER',
    'FINANCE_CONTROLLER',
    'CFO',
  )
  @Post('receipts')
  async receive(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      purchaseOrderId: string;
      receiptDate?: string;
      deliveryNoteReference?: string | null;
      quarantine?: boolean;
      lines: Array<{
        purchaseOrderLineId: string;
        receivedQuantity: string;
        rejectedQuantity?: string;
        batchReference?: string | null;
        /** YYYY-MM-DD, from the pack. */
        expiryDate?: string | null;
        warehouseId?: string | null;
      }>;
    },
  ) {
    for (const line of body.lines ?? []) {
      if (line.expiryDate && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(line.expiryDate)) throw new BadRequestException('expiryDate must be a date, YYYY-MM-DD.');
    }
    return this.flow.receive({
      companyId,
      actor,
      purchaseOrderId: body.purchaseOrderId,
      receiptDate: body.receiptDate ? new Date(body.receiptDate) : new Date(),
      deliveryNoteReference: body.deliveryNoteReference ?? null,
      quarantine: body.quarantine === true,
      lines: (body.lines ?? []).map((line) => ({
        ...line,
        expiryDate: line.expiryDate ? new Date(`${line.expiryDate}T00:00:00.000Z`) : null,
      })),
    });
  }

  @OwnedRecord('goodsReceiptNote', 'id')
  @AnyRole('What can still be billed against a receipt is what anyone entering an invoice needs.')
  @Get('receipts/:id')
  async receipt(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.flow.receiptDetail(companyId, id);
  }

  @AnyRole('What has been billed, and what is still owed.')
  @Get('invoices')
  async invoices(@CurrentCompany() companyId: string) {
    return this.flow.listInvoices(companyId);
  }

  @AnyRole('Approved invoices are what the payment screen needs to offer.')
  @Get('invoices/payable')
  async payableInvoices(@CurrentCompany() companyId: string) {
    return this.flow.payableInvoices(companyId);
  }

  /**
   * Enter a supplier's invoice against a goods receipt.
   *
   * §5's AP Officer (ROL-009) makes this; a Storekeeper or supervisor who can
   * receive goods cannot also bill for them — that split is the point of a
   * three-way match. Recording is not posting: this submits for approval the
   * same way `receive()` does above.
   */
  @Roles('AP_OFFICER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('invoices')
  async recordInvoice(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      goodsReceiptNoteId: string;
      supplierInvoiceNumber: string;
      invoiceDate?: string;
      lines: Array<{ goodsReceiptNoteLineId: string; quantity: string; unitPriceKobo: string }>;
    },
  ) {
    return this.flow.recordSupplierInvoice({
      companyId,
      actor,
      goodsReceiptNoteId: body.goodsReceiptNoteId,
      supplierInvoiceNumber: body.supplierInvoiceNumber,
      invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : new Date(),
      lines: body.lines ?? [],
    });
  }

  /**
   * Pay a supplier against one or more of their approved invoices.
   *
   * §5's Treasury Officer (ROL-014) makes this. Same tier as approving the
   * order itself — releasing the farm's cash is a finance decision, not an
   * operational one.
   */
  @Roles('TREASURY_OFFICER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('payments')
  async recordPayment(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      supplierId: string;
      paymentDate?: string;
      method: 'BANK_TRANSFER' | 'CASH' | 'CHEQUE';
      bankGlAccountId: string;
      reference?: string | null;
      allocations: Array<{ invoiceId: string; amountKobo: string }>;
    },
  ) {
    return this.flow.recordSupplierPayment({
      companyId,
      actor,
      supplierId: body.supplierId,
      paymentDate: body.paymentDate ? new Date(body.paymentDate) : new Date(),
      method: body.method,
      bankGlAccountId: body.bankGlAccountId,
      reference: body.reference ?? null,
      allocations: body.allocations ?? [],
    });
  }

  @AnyRole('What has been requested, and what is ready to become an order.')
  @Get('requisitions')
  async requisitions(@CurrentCompany() companyId: string) {
    return this.flow.listRequisitions(companyId);
  }

  @OwnedRecord('purchaseRequisition', 'id')
  @AnyRole('Its own lines are what a conversion to an order needs.')
  @Get('requisitions/:id')
  async requisition(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.flow.requisitionDetail(companyId, id);
  }

  /**
   * Raise a purchase requisition.
   *
   * §5's Procurement Officer (ROL-005) makes this — sourcing and raising a
   * PR/PO is that role's whole job.
   */
  @Roles('PROCUREMENT_OFFICER', 'FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('requisitions')
  async raiseRequisition(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      requestDate?: string;
      requiredDate?: string | null;
      justification?: string | null;
      lines: Array<{ itemId: string; quantity: string }>;
    },
  ) {
    return this.flow.raiseRequisition({
      companyId,
      actor,
      requestDate: body.requestDate ? new Date(body.requestDate) : new Date(),
      requiredDate: body.requiredDate ? new Date(body.requiredDate) : null,
      justification: body.justification ?? null,
      lines: body.lines ?? [],
    });
  }

  /** Convert an approved requisition into a purchase order. */
  @OwnedRecord('purchaseRequisition', 'requisitionId')
  @Roles('PROCUREMENT_OFFICER', 'FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('requisitions/:requisitionId/convert')
  async convertRequisition(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('requisitionId') requisitionId: string,
    @Body()
    body: {
      supplierId: string;
      orderDate?: string;
      expectedDeliveryDate?: string | null;
      lines: Array<{
        requisitionLineId: string;
        itemId: string;
        quantity: string;
        unitPriceKobo: string;
      }>;
    },
  ) {
    return this.flow.convertRequisitionToOrder({
      companyId,
      actor,
      requisitionId,
      supplierId: body.supplierId,
      orderDate: body.orderDate ? new Date(body.orderDate) : new Date(),
      expectedDeliveryDate: body.expectedDeliveryDate ? new Date(body.expectedDeliveryDate) : null,
      lines: body.lines ?? [],
    });
  }
}
