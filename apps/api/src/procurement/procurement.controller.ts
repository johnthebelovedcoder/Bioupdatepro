import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ProcurementFlowService } from './procurement-flow.service';
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
  constructor(private readonly flow: ProcurementFlowService) {}

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
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
  @Post('orders/:id/approve')
  async approveOrder(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
  ) {
    return this.flow.approveOrder({ companyId, id, actor });
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
   */
  @Roles(
    'PRODUCTION_SUPERVISOR',
    'FARM_MANAGER',
    'FINANCE_MANAGER',
    'FINANCIAL_CONTROLLER',
    'MANAGING_DIRECTOR',
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
      lines: Array<{
        purchaseOrderLineId: string;
        receivedQuantity: string;
        rejectedQuantity?: string;
        batchReference?: string | null;
      }>;
    },
  ) {
    return this.flow.receive({
      companyId,
      actor,
      purchaseOrderId: body.purchaseOrderId,
      receiptDate: body.receiptDate ? new Date(body.receiptDate) : new Date(),
      deliveryNoteReference: body.deliveryNoteReference ?? null,
      lines: body.lines ?? [],
    });
  }
}
