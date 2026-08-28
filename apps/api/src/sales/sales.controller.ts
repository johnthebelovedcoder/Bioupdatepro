import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SalesFlowService } from './sales-flow.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { OwnedRecord } from '../auth/owned-record.guard';
import { AnyRole, Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Order-to-Cash over HTTP.
 *
 * Same split as `ProcurementController`: reading is open to anyone signed
 * in, acting is not — approving an order or a delivery moves stock and,
 * eventually, the ledger.
 */
@Controller('sales')
export class SalesController {
  constructor(private readonly flow: SalesFlowService) {}

  @AnyRole('Seeing what has been sold is how anyone knows what is owed.')
  @Get('orders')
  async orders(@CurrentCompany() companyId: string) {
    return this.flow.listOrders(companyId);
  }

  @OwnedRecord('salesOrder', 'id')
  @AnyRole('Seeing what has been sold is how anyone knows what is owed.')
  @Get('orders/:id')
  async order(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.flow.order(companyId, id);
  }

  /**
   * Approve a sales order.
   *
   * The engine still checks the amount against the credit-control ladder
   * §6 routed this to at submission — this list only keeps the request from
   * reaching an engine that would refuse it anyway.
   */
  @OwnedRecord('salesOrder', 'id')
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'SALES_OFFICER', 'CFO')
  @Post('orders/:id/approve')
  async approveOrder(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
  ) {
    return this.flow.approveOrder({ companyId, id, actor });
  }

  @AnyRole('What has shipped, and what it did to the ledger.')
  @Get('deliveries')
  async deliveries(@CurrentCompany() companyId: string) {
    return this.flow.listDeliveries(companyId);
  }

  /**
   * Ship goods against an approved order.
   *
   * Recording is not posting: this creates the note and sends it for
   * confirmation, the same as a goods receipt in procurement.
   */
  @Roles(
    'PRODUCTION_SUPERVISOR',
    'STOREKEEPER',
    'SALES_OFFICER',
    'FARM_MANAGER',
    'FINANCE_MANAGER',
    'FINANCE_CONTROLLER',
    'CFO',
  )
  @Post('deliveries')
  async deliver(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      salesOrderId: string;
      deliveryDate?: string;
      driverName?: string | null;
      vehicleNumber?: string | null;
      receivedBy?: string | null;
      lines: Array<{ salesOrderLineId: string; quantity: string; batchReference?: string | null }>;
    },
  ) {
    return this.flow.deliver({
      companyId,
      actor,
      salesOrderId: body.salesOrderId,
      deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : new Date(),
      driverName: body.driverName ?? null,
      vehicleNumber: body.vehicleNumber ?? null,
      receivedBy: body.receivedBy ?? null,
      lines: body.lines ?? [],
    });
  }

  @AnyRole('What has been billed, and what is still owed.')
  @Get('invoices')
  async invoices(@CurrentCompany() companyId: string) {
    return this.flow.listInvoices(companyId);
  }

  @AnyRole('Posted invoices with a balance are what the receive-payment screen needs to offer.')
  @Get('invoices/receivable')
  async receivableInvoices(@CurrentCompany() companyId: string) {
    return this.flow.receivableInvoices(companyId);
  }

  /**
   * Raise an invoice for whatever an order has delivered but not yet billed.
   *
   * §6's Sales Officer (ROL-...) makes this — billing what shipped is that
   * role's job, distinct from the storekeeper who shipped it.
   */
  @Roles('SALES_OFFICER', 'AR_OFFICER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('invoices')
  async raiseInvoice(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { salesOrderId: string; invoiceDate?: string },
  ) {
    return this.flow.raiseInvoice({
      companyId,
      actor,
      salesOrderId: body.salesOrderId,
      invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : new Date(),
    });
  }

  /**
   * Receive a customer's payment against one or more posted invoices.
   *
   * §6's AR/Treasury Officer makes this — the same tier as recording a
   * supplier payment, since taking in the farm's cash is a finance decision.
   */
  @Roles('AR_OFFICER', 'TREASURY_OFFICER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('receipts')
  async recordReceipt(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      customerId: string;
      receiptDate?: string;
      method: 'BANK_TRANSFER' | 'CASH' | 'CHEQUE';
      bankGlAccountId: string;
      reference?: string | null;
      allocations: Array<{ invoiceId: string; amountKobo: string }>;
    },
  ) {
    return this.flow.recordReceipt({
      companyId,
      actor,
      customerId: body.customerId,
      receiptDate: body.receiptDate ? new Date(body.receiptDate) : new Date(),
      method: body.method,
      bankGlAccountId: body.bankGlAccountId,
      reference: body.reference ?? null,
      allocations: body.allocations ?? [],
    });
  }
}
