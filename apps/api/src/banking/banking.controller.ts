import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BankingService } from './banking.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Banking. The same roles that pay suppliers and payroll — treasury and the
 * finance tier — reconcile what those payments did to the bank. Every id is
 * checked against the caller's company inside the service.
 */
@Controller('banking')
@Roles('TREASURY_OFFICER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'FARM_ACCOUNTANT', 'CFO')
export class BankingController {
  constructor(private readonly banking: BankingService) {}

  @Get('accounts')
  async accounts(@CurrentCompany() companyId: string) {
    return this.banking.listAccounts(companyId);
  }

  @Post('accounts')
  async createAccount(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { glAccountId: string; name: string; bankName: string; accountNumber: string },
  ) {
    return this.banking.createAccount({ companyId, actorId: actor.userId, ...body });
  }

  @Get('accounts/:id/reconciliation')
  async reconciliation(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.banking.reconciliation(companyId, id);
  }

  @Post('accounts/:id/statements')
  async importStatement(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { csv: string; openingBalance: string; closingBalance: string; fileName?: string | null },
  ) {
    return this.banking.importStatement({ companyId, actorId: actor.userId, bankAccountId: id, ...body });
  }

  @Post('accounts/:id/auto-match')
  async autoMatch(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
  ) {
    return this.banking.autoMatch(companyId, id, actor.userId);
  }

  @Post('lines/:id/match')
  async match(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { journalLineId: string },
  ) {
    return this.banking.match({ companyId, actorId: actor.userId, lineId: id, journalLineId: body.journalLineId });
  }

  @Post('lines/:id/ignore')
  async ignore(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.banking.ignore({ companyId, actorId: actor.userId, lineId: id, reason: body.reason });
  }

  @Post('lines/:id/unsettle')
  async unsettle(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.banking.unsettle({ companyId, lineId: id });
  }
}
