import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PayrollRunService } from './payroll-run.service';
import { PayeEngineService } from './paye-engine.service';
import { StatutoryEngineService } from './statutory-engine.service';
import { WorkflowActor } from '../workflow/workflow.types';

/** §7 API surface. */
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly runs: PayrollRunService,
    private readonly paye: PayeEngineService,
    private readonly statutory: StatutoryEngineService,
  ) {}

  @Post('runs')
  async createRun(
    @Body()
    body: {
      companyId: string;
      year: number;
      month: number;
      branchId: string;
      financialYearId: string;
      financialPeriodId: string;
      currencyId: string;
      actorId: string;
    },
  ) {
    const run = await this.runs.createRun(body);
    return { id: run.id, reference: run.reference, status: run.status };
  }

  @Get('runs/:id/validate')
  async validate(@Param('id') id: string) {
    return this.runs.validate(id);
  }

  @Post('runs/:id/calculate')
  async calculate(@Param('id') id: string, @Body() body: { actorId: string }) {
    const run = await this.runs.calculate({ payrollRunId: id, actorId: body.actorId });
    return {
      reference: run.reference,
      status: run.status,
      employeeCount: run.employeeCount,
      totalGrossKobo: run.totalGrossKobo.toString(),
      totalPayeKobo: run.totalPayeKobo.toString(),
      totalNetPayKobo: run.totalNetPayKobo.toString(),
      totalEmployerPensionKobo: run.totalEmployerPensionKobo.toString(),
      totalNsitfKobo: run.totalNsitfKobo.toString(),
      totalItfKobo: run.totalItfKobo.toString(),
      ruleVersion: run.payeRuleVersion,
    };
  }

  @Post('runs/:id/submit')
  async submit(@Param('id') id: string, @Body() body: { actor: WorkflowActor }) {
    return this.runs.submit({ payrollRunId: id, actor: body.actor });
  }

  @Get('runs/:id/paye-by-state')
  async payeByState(@Param('id') id: string) {
    return this.runs.payeByState(id);
  }

  @Get('runs/:id/bank-schedule')
  async bankSchedule(@Param('id') id: string) {
    return this.runs.bankSchedule(id);
  }

  @Get('runs/:id/payslip/:employeeId')
  async payslip(@Param('id') id: string, @Param('employeeId') employeeId: string) {
    return this.runs.payslip(id, employeeId);
  }

  /**
   * Compute PAYE without a run. For "what would this salary cost" questions and
   * for showing an employee the working behind their own deduction.
   */
  @Post('paye/calculate')
  async calculatePaye(
    @Body()
    body: {
      companyId: string;
      monthlyTaxableGrossKobo: string | number;
      pensionableEmolumentsKobo: string | number;
      pensionEnrolled?: boolean;
      annualBonusKobo?: string | number;
      annualRentKobo?: string | number;
      nhfAnnualKobo?: string | number;
      nhisAnnualKobo?: string | number;
      lifeAssuranceAnnualKobo?: string | number;
      mortgageInterestAnnualKobo?: string | number;
      documentsComplete?: boolean;
      on?: string;
    },
  ) {
    return this.paye.calculate({
      companyId: body.companyId,
      monthlyTaxableGrossKobo: BigInt(body.monthlyTaxableGrossKobo),
      pensionableEmolumentsKobo: BigInt(body.pensionableEmolumentsKobo),
      pensionEnrolled: body.pensionEnrolled ?? false,
      annualBonusKobo: body.annualBonusKobo ? BigInt(body.annualBonusKobo) : 0n,
      annualRentKobo: body.annualRentKobo ? BigInt(body.annualRentKobo) : 0n,
      nhfAnnualKobo: body.nhfAnnualKobo ? BigInt(body.nhfAnnualKobo) : 0n,
      nhisAnnualKobo: body.nhisAnnualKobo ? BigInt(body.nhisAnnualKobo) : 0n,
      lifeAssuranceAnnualKobo: body.lifeAssuranceAnnualKobo
        ? BigInt(body.lifeAssuranceAnnualKobo)
        : 0n,
      mortgageInterestAnnualKobo: body.mortgageInterestAnnualKobo
        ? BigInt(body.mortgageInterestAnnualKobo)
        : 0n,
      documentsComplete: body.documentsComplete ?? true,
      on: body.on ? new Date(body.on) : new Date(),
    });
  }

  @Post('statutory/calculate')
  async calculateStatutory(
    @Body()
    body: {
      companyId: string;
      grossPayKobo: string | number;
      pensionableEmolumentsKobo: string | number;
      pensionEnrolled?: boolean;
      nhfEnrolled?: boolean;
      employeeCount: number;
      on?: string;
    },
  ) {
    return this.statutory.calculate({
      companyId: body.companyId,
      grossPayKobo: BigInt(body.grossPayKobo),
      pensionableEmolumentsKobo: BigInt(body.pensionableEmolumentsKobo),
      pensionEnrolled: body.pensionEnrolled ?? false,
      nhfEnrolled: body.nhfEnrolled ?? false,
      employeeCount: body.employeeCount,
      on: body.on ? new Date(body.on) : new Date(),
    });
  }

  @Get('paye/bands')
  async bands(@Query('companyId') companyId: string, @Query('on') on?: string) {
    const bands = await this.paye.bands(companyId, on ? new Date(on) : new Date());
    return bands.map((b) => ({
      bandOrder: b.bandOrder,
      lowerLimitKobo: b.lowerLimitKobo.toString(),
      upperLimitKobo: b.upperLimitKobo?.toString() ?? null,
      rate: b.rate.toString(),
      effectiveFrom: b.effectiveFrom,
      sourceReference: b.sourceReference,
    }));
  }
}
