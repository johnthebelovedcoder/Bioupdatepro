import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ChecklistItemStatus } from '@bioassetpro/database';
import { PeriodCloseService } from './period-close.service';
import { YearEndService } from './year-end.service';
import { IncomeTaxService } from './income-tax.service';
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
    private readonly incomeTax: IncomeTaxService,
  ) {}

  /** What providing for income tax through this period would post (PCR-084). */
  @Get('period/:id/income-tax')
  async incomeTaxPreview(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.incomeTax.preview(companyId, id);
  }

  /** Provide for income tax on the year's profit to the end of this period. */
  @Roles('CFO')
  @Post('period/:id/income-tax')
  async provideIncomeTax(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Param('id') id: string) {
    return this.incomeTax.provide({ companyId, financialPeriodId: id, actor });
  }

  @Roles('CFO')
  @Post('income-tax-rate')
  async setIncomeTaxRate(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Body() body: { ratePercent: number }) {
    return this.incomeTax.setRate({ companyId, ratePercent: Number(body?.ratePercent), actor });
  }

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
  async validateYear(
    @CurrentCompany() companyId: string,
    @Body() body: { financialYearId: string },
  ) {
    await this.assertOwnYear(companyId, body.financialYearId);
    return this.yearEnd.validate(body.financialYearId);
  }

  @Post('year-end/close')
  async closeYear(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      financialYearId: string;
      retainedEarningsGlAccountId?: string;
      rollForward?: boolean;
      nextYearCode?: string;
    },
  ) {
    await this.assertOwnYear(companyId, body.financialYearId);
    if (body.retainedEarningsGlAccountId) {
      const account = await this.prisma.gLAccount.findFirst({
        where: { id: body.retainedEarningsGlAccountId, companyId },
        select: { id: true },
      });
      if (!account) throw new NotFoundException('No such account.');
    }
    return this.yearEnd.close({ ...body, actor });
  }

  /**
   * The year id arrives in the body, where `@OwnedRecord` cannot see it.
   * Without this, any finance user could validate — or close — another
   * company's financial year by naming its id. 404 rather than 403, for the
   * same reason the ownership guard uses it: a 403 confirms the id exists.
   */
  private async assertOwnYear(companyId: string, financialYearId: string) {
    const year =
      typeof financialYearId === 'string' && financialYearId
        ? await this.prisma.financialYear
            .findFirst({ where: { id: financialYearId, companyId }, select: { id: true } })
            .catch(() => null)
        : null;
    if (!year) throw new NotFoundException('No such financial year.');
  }

  @OwnedRecord('financialYear', 'id')
  @Get('year-end/:id/balances')
  async balances(@Param('id') id: string, @Query('opening') opening?: string) {
    return this.yearEnd.balances(id, opening === 'true');
  }
}
