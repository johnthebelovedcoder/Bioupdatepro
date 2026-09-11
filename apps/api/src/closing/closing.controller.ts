import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ChecklistItemStatus } from '@bioassetpro/database';
import { PeriodCloseService } from './period-close.service';
import { YearEndService } from './year-end.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { OwnedRecord } from '../auth/owned-record.guard';
import { Roles } from '../auth/roles.guard';

/** §8 API surface. */
@Controller()
@Roles('FINANCE_CONTROLLER', 'CFO')
export class ClosingController {
  constructor(
    private readonly periods: PeriodCloseService,
    private readonly yearEnd: YearEndService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Reopen requests for one period — what a "reopen" screen needs to show
   * who asked, why, and whether it has been approved yet. No endpoint listed
   * these; `approveReopenRequest`/`reopen` only ever took a known id.
   */
  @OwnedRecord('financialPeriod', 'periodId')
  @Get('period/:periodId/reopen-requests')
  async reopenRequestsFor(@Param('periodId') periodId: string) {
    const requests = await this.prisma.periodReopenRequest.findMany({
      where: { financialPeriodId: periodId },
      orderBy: { requestedAt: 'desc' },
      include: {
        requestedBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
    });
    return requests.map((r) => ({
      id: r.id,
      reason: r.reason,
      requestedById: r.requestedBy.id,
      requestedByName: r.requestedBy.fullName,
      requestedAt: r.requestedAt,
      approvedByName: r.approvedBy?.fullName ?? null,
      approvedAt: r.approvedAt,
      reopenedAt: r.reopenedAt,
    }));
  }

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
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { status: ChecklistItemStatus; comments?: string },
  ) {
    return this.periods.settleChecklistItem({ checklistId, ...body, actorId: actor.userId });
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
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { reason?: string },
  ) {
    return this.periods.softClose({ financialPeriodId: id, actor, ...body });
  }

  @OwnedRecord('financialPeriod', 'id')
  @Post('period/:id/close')
  async close(
    @Param('id') id: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { reason?: string },
  ) {
    return this.periods.close({ financialPeriodId: id, actor, ...body });
  }

  @OwnedRecord('financialPeriod', 'id')
  @Post('period/:id/request-reopen')
  async requestReopen(
    @Param('id') id: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { reason: string },
  ) {
    return this.periods.requestReopen({ financialPeriodId: id, actor, ...body });
  }

  @OwnedRecord('periodReopenRequest', 'requestId')
  @Post('period/reopen-requests/:requestId/approve')
  async approveReopen(@Param('requestId') requestId: string, @CurrentUser() actor: WorkflowActor) {
    return this.periods.approveReopenRequest({ reopenRequestId: requestId, actor });
  }

  @OwnedRecord('periodReopenRequest', 'requestId')
  @Post('period/reopen-requests/:requestId/reopen')
  async reopen(@Param('requestId') requestId: string, @CurrentUser() actor: WorkflowActor) {
    return this.periods.reopen({ reopenRequestId: requestId, actor });
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
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      financialYearId: string;
      retainedEarningsGlAccountId?: string;
      rollForward?: boolean;
      nextYearCode?: string;
    },
  ) {
    return this.yearEnd.close({ ...body, actor });
  }

  @OwnedRecord('financialYear', 'id')
  @Get('year-end/:id/balances')
  async balances(@Param('id') id: string, @Query('opening') opening?: string) {
    return this.yearEnd.balances(id, opening === 'true');
  }
}
