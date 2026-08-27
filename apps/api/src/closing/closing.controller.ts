import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ChecklistItemStatus } from '@bioassetpro/database';
import { PeriodCloseService } from './period-close.service';
import { YearEndService } from './year-end.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { CurrentCompany } from '../auth/current-user.decorator';
import { OwnedRecord } from '../auth/owned-record.guard';
import { Roles } from '../auth/roles.guard';

/** §8 API surface. */
@Controller()
@Roles('FINANCE_CONTROLLER', 'CFO')
export class ClosingController {
  constructor(
    private readonly periods: PeriodCloseService,
    private readonly yearEnd: YearEndService,
  ) {}

  // --- Period ---------------------------------------------------------------

  @OwnedRecord('financialPeriod', 'id')
  @Post('period/:id/checklist/prepare')
  async prepareChecklist(@Param('id') id: string) {
    return this.periods.prepareChecklist(id);
  }

  @OwnedRecord('financialPeriod', 'id')
  @Get('period/:id/checklist')
  async checklist(@Param('id') id: string) {
    const items = await this.periods.checklist(id);
    return items.map((item) => ({
      id: item.id,
      code: item.template.code,
      name: item.template.name,
      blocking: item.template.blocking,
      status: item.status,
      comments: item.comments,
      completedBy: item.completedBy?.fullName ?? null,
      completedAt: item.completedAt,
    }));
  }

  @OwnedRecord('periodCloseChecklist', 'checklistId')
  @Post('period/checklist/:checklistId')
  async settleChecklistItem(
    @Param('checklistId') checklistId: string,
    @Body() body: { status: ChecklistItemStatus; comments?: string; actorId: string },
  ) {
    return this.periods.settleChecklistItem({ checklistId, ...body });
  }

  @OwnedRecord('financialPeriod', 'id')
  @Get('period/:id/validate')
  async validatePeriod(@Param('id') id: string) {
    return this.periods.validate(id);
  }

  @OwnedRecord('financialPeriod', 'id')
  @Post('period/:id/soft-close')
  async softClose(
    @Param('id') id: string,
    @Body() body: { actor: WorkflowActor; reason?: string },
  ) {
    return this.periods.softClose({ financialPeriodId: id, ...body });
  }

  @OwnedRecord('financialPeriod', 'id')
  @Post('period/:id/close')
  async close(
    @Param('id') id: string,
    @Body() body: { actor: WorkflowActor; reason?: string },
  ) {
    return this.periods.close({ financialPeriodId: id, ...body });
  }

  @OwnedRecord('financialPeriod', 'id')
  @Post('period/:id/request-reopen')
  async requestReopen(
    @Param('id') id: string,
    @Body() body: { actor: WorkflowActor; reason: string },
  ) {
    return this.periods.requestReopen({ financialPeriodId: id, ...body });
  }

  @OwnedRecord('periodReopenRequest', 'requestId')
  @Post('period/reopen-requests/:requestId/approve')
  async approveReopen(
    @Param('requestId') requestId: string,
    @Body() body: { actor: WorkflowActor },
  ) {
    return this.periods.approveReopenRequest({
      reopenRequestId: requestId,
      actor: body.actor,
    });
  }

  @OwnedRecord('periodReopenRequest', 'requestId')
  @Post('period/reopen-requests/:requestId/reopen')
  async reopen(
    @Param('requestId') requestId: string,
    @Body() body: { actor: WorkflowActor },
  ) {
    return this.periods.reopen({ reopenRequestId: requestId, actor: body.actor });
  }

  @Get('period-close-log')
  async closeLog(
    @CurrentCompany() companyId: string,
    @Query('financialYearId') financialYearId?: string,
  ) {
    const log = await this.periods.closeLog(companyId, financialYearId);
    return log.map((entry) => ({
      occurredAt: entry.occurredAt,
      action: entry.action,
      year: entry.financialYear.code,
      period: entry.financialPeriod?.name ?? null,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      totalDebitKobo: entry.totalDebitKobo.toString(),
      totalCreditKobo: entry.totalCreditKobo.toString(),
      performedBy: entry.performedBy.fullName,
      reason: entry.reason,
    }));
  }

  // --- Year end -------------------------------------------------------------

  @Post('year-end/validate')
  async validateYear(@Body() body: { financialYearId: string }) {
    return this.yearEnd.validate(body.financialYearId);
  }

  @Post('year-end/close')
  async closeYear(
    @Body()
    body: {
      financialYearId: string;
      actor: WorkflowActor;
      retainedEarningsGlAccountId?: string;
      rollForward?: boolean;
      nextYearCode?: string;
    },
  ) {
    return this.yearEnd.close(body);
  }

  @OwnedRecord('financialYear', 'id')
  @Get('year-end/:id/balances')
  async balances(@Param('id') id: string, @Query('opening') opening?: string) {
    return this.yearEnd.balances(id, opening === 'true');
  }
}
