import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { AnyRole, Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';
import { FeedPlanService } from './feed-plan.service';
import { FeedQualityService } from './feed-quality.service';

const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** The feed mill's plan and quality plan (handbook §26, §40). */
@Controller('feed-mill')
export class FeedMillController {
  constructor(
    private readonly plans: FeedPlanService,
    private readonly quality: FeedQualityService,
  ) {}

  /** Feed the live batches need over the horizon, against stock and open orders. */
  @AnyRole('What the flocks will eat is farm information everyone plans around.')
  @Get('plan')
  async plan(@CurrentCompany() companyId: string, @Query('horizon') horizon?: string) {
    const days = horizon ? Number(horizon) : 14;
    if (!Number.isInteger(days) || days < 1 || days > 120) throw new BadRequestException('horizon is a number of days, 1 to 120.');
    return this.plans.plan(companyId, days);
  }

  @AnyRole('Quality limits are shared production information.')
  @Get('quality/specs')
  async specs(@CurrentCompany() companyId: string) {
    return this.quality.specs(companyId);
  }

  @Roles('QA_OFFICER', 'PRODUCTION_LEAD', 'FARM_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('quality/specs')
  async setSpec(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { itemId: string; minProteinPercent?: string; maxMoisturePercent?: string; maxAflatoxinPpb?: string; samplingNote?: string },
  ) {
    return this.quality.setSpec({ companyId, ...body, actor });
  }

  @AnyRole('A batch’s quality results are shared production information.')
  @Get('orders/:id/quality')
  async tests(@CurrentCompany() companyId: string, @Param('id') id: string) {
    return this.quality.testsFor(companyId, id);
  }

  @Roles('QA_OFFICER', 'PRODUCTION_LEAD', 'FARM_ACCOUNTANT', 'FARM_MANAGER')
  @Post('orders/:id/quality')
  async recordTest(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('id') id: string,
    @Body() body: { sampledOn: string; proteinPercent?: string; moisturePercent?: string; aflatoxinPpb?: string; contaminationNote?: string },
  ) {
    if (!DATE.test(body?.sampledOn ?? '')) throw new BadRequestException('sampledOn must be a date, YYYY-MM-DD.');
    return this.quality.recordTest({
      companyId,
      productionOrderId: id,
      sampledOn: new Date(`${body.sampledOn}T00:00:00.000Z`),
      proteinPercent: body.proteinPercent,
      moisturePercent: body.moisturePercent,
      aflatoxinPpb: body.aflatoxinPpb,
      contaminationNote: body.contaminationNote ?? null,
      actor,
    });
  }

  @Roles('QA_OFFICER', 'PRODUCTION_LEAD', 'FARM_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('quality/:testId/decide')
  async decide(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('testId') testId: string,
    @Body() body: { decision: 'RELEASE' | 'REJECT'; note?: string },
  ) {
    if (body?.decision !== 'RELEASE' && body?.decision !== 'REJECT') throw new BadRequestException('decision is RELEASE or REJECT.');
    return this.quality.decide({ companyId, testId, decision: body.decision, note: body.note ?? null, actor });
  }
}
