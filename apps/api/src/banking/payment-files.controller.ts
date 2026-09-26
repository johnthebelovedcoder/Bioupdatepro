import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PaymentFileKind } from '@bioassetpro/database';
import { PaymentFileService } from './payment-file.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

const kindOf = (value: string | undefined): PaymentFileKind => {
  if (value === 'SUPPLIER' || value === 'SALARY') return value as PaymentFileKind;
  throw new BadRequestException('kind is SUPPLIER or SALARY.');
};

/** Bank payment files for the bank's bulk-upload channel (SOP-P2P-05). */
@Controller('banking/payment-files')
@Roles('TREASURY_OFFICER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
export class PaymentFilesController {
  constructor(private readonly files: PaymentFileService) {}

  @Get()
  async list(@CurrentCompany() companyId: string) {
    return this.files.list(companyId);
  }

  @Get('pending')
  async pending(@CurrentCompany() companyId: string, @Query('kind') kind: string) {
    return this.files.pending(companyId, kindOf(kind));
  }

  @Post()
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { kind: string; paymentIds: string[] },
  ) {
    if (!Array.isArray(body?.paymentIds)) throw new BadRequestException('paymentIds is a list.');
    return this.files.create({ companyId, kind: kindOf(body.kind), paymentIds: body.paymentIds.map(String), actor });
  }

  @Get(':id/download')
  async download(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Param('id') id: string) {
    return this.files.download({ companyId, fileId: id, actor });
  }
}
