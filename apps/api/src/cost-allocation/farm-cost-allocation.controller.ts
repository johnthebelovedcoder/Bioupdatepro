import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';
import { FarmCostAllocationService } from './farm-cost-allocation.service';

/** Whole kobo from the wire, where money travels as a string. */
function koboOf(value: string | number | undefined, what: string): bigint {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) throw new BadRequestException(`${what} must be a whole number of kobo.`);
  return BigInt(text);
}

/** PCR-028 / PCR-043 / PCR-064 — farm labour and overhead by animal-days. */
@Controller('cost-allocation')
@Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
export class FarmCostAllocationController {
  constructor(private readonly allocations: FarmCostAllocationService) {}

  @Get()
  list(@CurrentCompany() companyId: string) {
    return this.allocations.list(companyId);
  }

  @Get('sources')
  sources(@CurrentCompany() companyId: string, @Query('periodId') periodId: string) {
    if (!periodId) throw new BadRequestException('periodId is required.');
    return this.allocations.sources(companyId, periodId);
  }

  @Get('preview')
  preview(@CurrentCompany() companyId: string, @Query('periodId') periodId: string, @Query('totalKobo') totalKobo: string) {
    if (!periodId) throw new BadRequestException('periodId is required.');
    return this.allocations.preview(companyId, periodId, koboOf(totalKobo ?? '0', 'totalKobo'));
  }

  /** Moves cost between accounts, so only the roles that can reverse a journal may post one. */
  @Roles('FINANCE_CONTROLLER', 'CFO')
  @Post()
  post(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { financialPeriodId: string; sources: Array<{ glAccountId: string; costCentreId?: string | null; amountKobo: string }> },
  ) {
    if (!body?.financialPeriodId || !Array.isArray(body.sources)) {
      throw new BadRequestException('financialPeriodId and sources are required.');
    }
    return this.allocations.post({
      companyId,
      financialPeriodId: body.financialPeriodId,
      sources: body.sources.map((s) => ({
        glAccountId: s.glAccountId,
        costCentreId: s.costCentreId ?? null,
        amountKobo: koboOf(s.amountKobo, 'amountKobo'),
      })),
      actor,
    });
  }
}
