import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PayrollPayableBucket, PaymentMethod } from '@bioassetpro/database';
import { PayrollRunService } from './payroll-run.service';
import { PayeEngineService } from './paye-engine.service';
import { StatutoryEngineService } from './statutory-engine.service';
import { PayrollSetupService } from './payroll-setup.service';
import { PayrollPaymentService } from './payroll-payment.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { OwnedRecord } from '../auth/owned-record.guard';
import { Roles } from '../auth/roles.guard';

/** §7 API surface. */
@Controller('payroll')
@Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
export class PayrollController {
  constructor(
    private readonly runs: PayrollRunService,
    private readonly paye: PayeEngineService,
    private readonly statutory: StatutoryEngineService,
    private readonly setup: PayrollSetupService,
    private readonly payments: PayrollPaymentService,
  ) {}

  @Get('setup')
  async setupStatus(@CurrentCompany() companyId: string) {
    return this.setup.status(companyId);
  }

  /**
   * Turn payroll on for this company — see the service's own doc comment on
   * why this is one confirm, not a rates form.
   */
  @Post('setup')
  async activateSetup(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { nhfCompanyParticipation?: boolean },
  ) {
    return this.setup.activate({
      companyId,
      nhfCompanyParticipation: body.nhfCompanyParticipation ?? true,
      actorId: actor.userId,
    });
  }

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

  @OwnedRecord('payrollRun', 'id')
  @Get('runs/:id/validate')
  async validate(@Param('id') id: string) {
    return this.runs.validate(id);
  }

  @OwnedRecord('payrollRun', 'id')
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

  @OwnedRecord('payrollRun', 'id')
  @Post('runs/:id/submit')
  async submit(@Param('id') id: string, @Body() body: { actor: WorkflowActor }) {
    return this.runs.submit({ payrollRunId: id, actor: body.actor });
  }

  @OwnedRecord('payrollRun', 'id')
  @Get('runs/:id/paye-by-state')
  async payeByState(@Param('id') id: string) {
    return this.runs.payeByState(id);
  }

  @OwnedRecord('payrollRun', 'id')
  @Get('runs/:id/bank-schedule')
  async bankSchedule(@Param('id') id: string) {
    return this.runs.bankSchedule(id);
  }

  @OwnedRecord('payrollRun', 'id')
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
    @CurrentCompany() companyId: string,
    @Body()
    body: {
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
      companyId,
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
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      grossPayKobo: string | number;
      pensionableEmolumentsKobo: string | number;
      /** Basic salary alone — the NHF base. Falls back to gross if omitted,
       * which overstates NHF for anyone with non-basic earnings; callers
       * that know the real basic figure should always send it. */
      nhfBaseKobo?: string | number;
      pensionEnrolled?: boolean;
      nhfEnrolled?: boolean;
      employeeCount: number;
      on?: string;
    },
  ) {
    return this.statutory.calculate({
      companyId,
      grossPayKobo: BigInt(body.grossPayKobo),
      pensionableEmolumentsKobo: BigInt(body.pensionableEmolumentsKobo),
      nhfBaseKobo: BigInt(body.nhfBaseKobo ?? body.grossPayKobo),
      pensionEnrolled: body.pensionEnrolled ?? false,
      nhfEnrolled: body.nhfEnrolled ?? false,
      employeeCount: body.employeeCount,
      on: body.on ? new Date(body.on) : new Date(),
    });
  }

  /** US-897-024: each payable bucket's total, settled and outstanding. */
  @OwnedRecord('payrollRun', 'id')
  @Get('runs/:id/outstanding')
  async outstanding(@Param('id') id: string) {
    return this.payments.outstanding(id);
  }

  @Post('payments')
  async createPayment(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      payrollRunId: string;
      paymentNumber: string;
      bucket: PayrollPayableBucket;
      amountKobo: string;
      paymentDate: string;
      method: PaymentMethod;
      bankGlAccountId: string;
      reference?: string | null;
      narration?: string | null;
      branchId: string;
      currencyId: string;
      financialYearId: string;
      financialPeriodId: string;
    },
  ) {
    const payment = await this.payments.create({
      companyId,
      actor,
      ...body,
      amountKobo: BigInt(body.amountKobo),
      paymentDate: new Date(body.paymentDate),
    });
    return { id: payment.id, paymentNumber: payment.paymentNumber, status: payment.status };
  }

  @OwnedRecord('payrollPayment', 'id')
  @Post('payments/:id/submit')
  async submitPayment(@Param('id') id: string, @CurrentUser() actor: WorkflowActor) {
    return this.payments.submit({ paymentId: id, actor });
  }

  @Get('paye/bands')
  async bands(@CurrentCompany() companyId: string, @Query('on') on?: string) {
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
