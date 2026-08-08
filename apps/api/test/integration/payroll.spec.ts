import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PayrollRunStatus, PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { EmployeeService } from '../../src/masters/employee.service';
import { PayeEngineService } from '../../src/payroll/paye-engine.service';
import { StatutoryEngineService } from '../../src/payroll/statutory-engine.service';
import { PayrollRunService } from '../../src/payroll/payroll-run.service';
import { PayrollPostingHandler } from '../../src/payroll/payroll.handler';
import { WorkflowActor } from '../../src/workflow/workflow.types';
import { kobo } from '../../src/common/money';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Phase 9 — HR & Payroll (§7, §7.1, §7.2).
 *
 * Every figure asserted here comes from the client's own workbooks. These are
 * legally sensitive calculations, so the test is not "does the code agree with
 * itself" but "does the code agree with Nigeria_PAYE_2026 and
 * Nigeria_Statutory_Payroll". If the two ever diverge, this suite says which
 * employee and by how much.
 *
 * Workbook figures used (naira; kobo in the assertions):
 *   EMP001 Amina Yusuf — gross 327,000, annual PAYE 394,940.40, monthly 32,911.70
 *   EMP002 Chinedu Okafor — gross 398,000, annual PAYE 532,161.60
 *   EMP005 David Eze — gross 588,000, rent relief CAPPED at 500,000
 *   EMP011 Low Wage — gross 65,000, exempt under the minimum wage rule
 */
describe('HR & Payroll (§7, §7.1, §7.2)', () => {
  let prisma: PrismaService;
  let paye: PayeEngineService;
  let statutory: StatutoryEngineService;
  let payroll: PayrollRunService;
  let employees: EmployeeService;
  let workflow: WorkflowService;
  let trialBalance: TrialBalanceService;
  let fixture: TestFixture;

  let maker: WorkflowActor;
  let approver: WorkflowActor;

  const PAYROLL_DATE = new Date('2026-01-31');

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const audit = new AuditService(prisma);
    const idempotency = new IdempotencyService(prisma);
    const periodService = new PeriodService(prisma);
    const dimensions = new DimensionValidatorService(prisma);
    const posting = new PostingService(prisma, audit, idempotency, periodService, dimensions);
    trialBalance = new TrialBalanceService(prisma);

    const routing = new WorkflowRoutingService(prisma);
    const delegations = new DelegationService(prisma, audit);
    const notifications = new NotificationService(prisma);
    workflow = new WorkflowService(prisma, routing, delegations, notifications, audit);

    employees = new EmployeeService(prisma, audit);
    paye = new PayeEngineService(prisma);
    statutory = new StatutoryEngineService(prisma);
    payroll = new PayrollRunService(
      prisma, audit, posting, workflow, employees, paye, statutory,
    );

    workflow.register(new PayrollPostingHandler(payroll));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);

    maker = { userId: fixture.makerId, roles: ['HR_OFFICER'] };
    const approverUser = await prisma.user.create({
      data: {
        email: 'payroll-approver@test',
        fullName: 'Payroll Approver',
        passwordHash: 'x',
        roles: ['FINANCE_MANAGER'],
      },
    });
    approver = { userId: approverUser.id, roles: approverUser.roles };

    await seedPayeBands();
    await seedPayeConfiguration();
    await seedStatutoryConfiguration();
    await seedSalaryComponents();
    await seedPayrollAccounts();
  });

  // -- fixtures -------------------------------------------------------------

  async function seedPayeBands() {
    const bands = [
      { order: 1, lower: 0n, upper: 800_000_00n, rate: '0.00000000' },
      { order: 2, lower: 800_000_00n, upper: 3_000_000_00n, rate: '0.15000000' },
      { order: 3, lower: 3_000_000_00n, upper: 12_000_000_00n, rate: '0.18000000' },
      { order: 4, lower: 12_000_000_00n, upper: 25_000_000_00n, rate: '0.21000000' },
      { order: 5, lower: 25_000_000_00n, upper: 50_000_000_00n, rate: '0.23000000' },
      { order: 6, lower: 50_000_000_00n, upper: null, rate: '0.25000000' },
    ];
    for (const band of bands) {
      await prisma.payeBand.create({
        data: {
          companyId: fixture.companyId,
          bandOrder: band.order,
          lowerLimitKobo: band.lower,
          upperLimitKobo: band.upper,
          rate: band.rate,
          effectiveFrom: new Date('2026-01-01'),
          sourceReference: 'NTA 2025',
        },
      });
    }
  }

  async function seedPayeConfiguration() {
    await prisma.payeConfiguration.create({
      data: {
        companyId: fixture.companyId,
        minimumWageMonthlyKobo: 70_000_00n,
        rentReliefRate: '0.20000000',
        rentReliefCapKobo: 500_000_00n,
        pensionReliefRate: '0.08000000',
        rounding: 'HALF_UP',
        ruleVersion: 'NTA-2025-2026.01',
        effectiveFrom: new Date('2026-01-01'),
      },
    });
  }

  async function seedStatutoryConfiguration(overrides: Record<string, unknown> = {}) {
    await prisma.statutoryConfiguration.deleteMany({
      where: { companyId: fixture.companyId },
    });
    await prisma.statutoryConfiguration.create({
      data: {
        companyId: fixture.companyId,
        pensionFunding: 'SPLIT_8_10',
        pensionEmployeeRate: '0.08000000',
        pensionEmployerRate: '0.10000000',
        pensionCombinedRate: '0.18000000',
        pensionMinEmployees: 3,
        nhfRate: '0.02500000',
        nhfCompanyParticipation: true,
        nsitfRate: '0.01000000',
        itfRate: '0.01000000',
        itfMinEmployees: 25,
        minimumWageMonthlyKobo: 70_000_00n,
        effectiveFrom: new Date('2026-01-01'),
        ...overrides,
      },
    });
  }

  async function seedSalaryComponents() {
    const specs = [
      { code: 'BASIC', pensionable: true },
      { code: 'HOUSING', pensionable: true },
      { code: 'TRANSPORT', pensionable: true },
      { code: 'OTHER', pensionable: false },
    ];
    for (const spec of specs) {
      await prisma.salaryComponent.create({
        data: {
          companyId: fixture.companyId,
          code: spec.code,
          name: spec.code,
          type: 'EARNING',
          isTaxable: true,
          isPensionable: spec.pensionable,
          isGrossPayComponent: true,
        },
      });
    }
  }

  /** The §7 payroll accounts. The fixture's chart lacks the payroll ones. */
  async function seedPayrollAccounts() {
    const specs = [
      { number: '5101', name: 'Salaries and Wages', type: 'EXPENSE', normal: 'DEBIT' },
      { number: '5102', name: 'Employer Pension Expense', type: 'EXPENSE', normal: 'DEBIT' },
      { number: '5103', name: 'NSITF Expense', type: 'EXPENSE', normal: 'DEBIT' },
      { number: '5104', name: 'ITF Expense', type: 'EXPENSE', normal: 'DEBIT' },
      { number: '2101', name: 'Salary Payable', type: 'LIABILITY', normal: 'CREDIT' },
      { number: '2102', name: 'Pension Payable', type: 'LIABILITY', normal: 'CREDIT' },
      { number: '2103', name: 'NHF Payable', type: 'LIABILITY', normal: 'CREDIT' },
      { number: '2104', name: 'NSITF Payable', type: 'LIABILITY', normal: 'CREDIT' },
      { number: '2105', name: 'ITF Payable', type: 'LIABILITY', normal: 'CREDIT' },
      { number: '2110', name: 'PAYE Payable', type: 'LIABILITY', normal: 'CREDIT' },
    ] as const;

    for (const spec of specs) {
      const account = await prisma.gLAccount.create({
        data: {
          companyId: fixture.companyId,
          accountNumber: spec.number,
          name: spec.name,
          accountType: spec.type,
          normalBalance: spec.normal,
        },
      });
      fixture.accounts[spec.number] = account.id;
    }
  }

  /** One workbook employee, with their salary components and reliefs. */
  async function makeEmployee(spec: {
    number: string;
    firstName: string;
    surname: string;
    basic: bigint;
    housing: bigint;
    transport: bigint;
    other: bigint;
    pensionEnrolled?: boolean;
    nhfEnrolled?: boolean;
    taxState?: string;
    reliefs?: {
      annualRent?: bigint;
      nhf?: bigint;
      nhis?: bigint;
      life?: bigint;
      mortgage?: bigint;
      bonus?: bigint;
    };
  }) {
    const employee = await employees.create({
      companyId: fixture.companyId,
      employeeNumber: spec.number,
      firstName: spec.firstName,
      surname: spec.surname,
      employmentDate: new Date('2025-06-01'),
      departmentId: fixture.departmentId,
      branchId: fixture.branchId,
      costCentreId: fixture.costCentreId,
      bankName: 'Test Bank',
      accountNumber: `01234${spec.number.slice(-5)}`,
      taxState: spec.taxState ?? 'Lagos',
      pensionEnrolled: spec.pensionEnrolled ?? true,
      nhfEnrolled: spec.nhfEnrolled ?? true,
      pensionRsaNumber: 'PEN-' + spec.number,
      nhfNumber: (spec.nhfEnrolled ?? true) ? 'NHF-' + spec.number : null,
      actorId: fixture.makerId,
    });

    for (const [code, amount] of [
      ['BASIC', spec.basic],
      ['HOUSING', spec.housing],
      ['TRANSPORT', spec.transport],
      ['OTHER', spec.other],
    ] as const) {
      if (amount > 0n) {
        await employees.setSalaryComponent({
          employeeId: employee.id,
          componentCode: code,
          amount: kobo(amount),
          effectiveFrom: new Date('2026-01-01'),
          actorId: fixture.makerId,
        });
      }
    }

    if (spec.reliefs) {
      await prisma.employeeTaxRelief.create({
        data: {
          employeeId: employee.id,
          taxYear: 2026,
          annualRentKobo: spec.reliefs.annualRent ?? 0n,
          nhfAnnualKobo: spec.reliefs.nhf ?? 0n,
          nhisAnnualKobo: spec.reliefs.nhis ?? 0n,
          lifeAssuranceAnnualKobo: spec.reliefs.life ?? 0n,
          mortgageInterestAnnualKobo: spec.reliefs.mortgage ?? 0n,
          annualBonusKobo: spec.reliefs.bonus ?? 0n,
          documentsComplete: true,
        },
      });
    }

    await employees.activateForPayroll({
      employeeId: employee.id,
      on: PAYROLL_DATE,
      actorId: fixture.makerId,
    });

    return employee;
  }

  // =========================================================================
  // §7.1 PAYE — against the workbook
  // =========================================================================

  describe('PAYE engine reproduces the Nigeria_PAYE_2026 workbook', () => {
    it('EMP001 Amina Yusuf: annual 394,940.40 / monthly 32,911.70', async () => {
      const result = await paye.calculate({
        companyId: fixture.companyId,
        // 180,000 + 72,000 + 45,000 + 30,000
        monthlyTaxableGrossKobo: 327_000_00n,
        // basic + housing + transport only
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: true,
        annualBonusKobo: 120_000_00n,
        annualRentKobo: 1_200_000_00n,
        nhfAnnualKobo: 98_100_00n,
        lifeAssuranceAnnualKobo: 60_000_00n,
        on: PAYROLL_DATE,
      });

      expect(result.annualGrossKobo).toBe('404400000');       // 4,044,000
      expect(result.annualPensionReliefKobo).toBe('28512000'); //   285,120
      expect(result.rentReliefKobo).toBe('24000000');          //   240,000
      expect(result.totalReliefsKobo).toBe('68322000');        //   683,220
      expect(result.chargeableIncomeKobo).toBe('336078000');   // 3,360,780
      expect(result.annualPayeKobo).toBe('39494040');          //   394,940.40
      expect(result.monthlyPayeKobo).toBe('3291170');          //    32,911.70
    });

    it('EMP002 Chinedu Okafor: annual 532,161.60', async () => {
      const result = await paye.calculate({
        companyId: fixture.companyId,
        monthlyTaxableGrossKobo: 398_000_00n,
        pensionableEmolumentsKobo: 363_000_00n,
        pensionEnrolled: true,
        annualBonusKobo: 250_000_00n,
        annualRentKobo: 1_800_000_00n,
        nhfAnnualKobo: 119_400_00n,
        lifeAssuranceAnnualKobo: 75_000_00n,
        on: PAYROLL_DATE,
      });

      expect(result.totalReliefsKobo).toBe('90288000');      //   902,880
      expect(result.chargeableIncomeKobo).toBe('412312000'); // 4,123,120
      expect(result.annualPayeKobo).toBe('53216160');        //   532,161.60
      expect(result.monthlyPayeKobo).toBe('4434680');        //    44,346.80
    });

    it('EMP005 David Eze: rent relief capped at 500,000', async () => {
      const result = await paye.calculate({
        companyId: fixture.companyId,
        monthlyTaxableGrossKobo: 588_000_00n,
        pensionableEmolumentsKobo: 528_000_00n,
        pensionEnrolled: true,
        annualBonusKobo: 500_000_00n,
        // 20% of 3,000,000 is 600,000, above the 500,000 cap.
        annualRentKobo: 3_000_000_00n,
        nhisAnnualKobo: 180_000_00n,
        lifeAssuranceAnnualKobo: 150_000_00n,
        mortgageInterestAnnualKobo: 400_000_00n,
        on: PAYROLL_DATE,
      });

      expect(result.rentReliefCapApplied).toBe(true);
      expect(result.rentReliefKobo).toBe('50000000');         //   500,000, not 600,000
      expect(result.totalReliefsKobo).toBe('173688000');      // 1,736,880
      expect(result.chargeableIncomeKobo).toBe('581912000');  // 5,819,120
      expect(result.annualPayeKobo).toBe('83744160');         //   837,441.60
    });

    it('EMP011 Low Wage: exempt under the minimum wage rule', async () => {
      const result = await paye.calculate({
        companyId: fixture.companyId,
        monthlyTaxableGrossKobo: 65_000_00n,
        pensionableEmolumentsKobo: 60_000_00n,
        pensionEnrolled: false,
        annualRentKobo: 360_000_00n,
        on: PAYROLL_DATE,
      });

      expect(result.minimumWageExempt).toBe(true);
      expect(result.annualPayeKobo).toBe('0');
      expect(result.monthlyPayeKobo).toBe('0');
      // The exemption applies at exactly the threshold, not just below it.
      const atThreshold = await paye.calculate({
        companyId: fixture.companyId,
        monthlyTaxableGrossKobo: 70_000_00n,
        pensionableEmolumentsKobo: 70_000_00n,
        pensionEnrolled: false,
        on: PAYROLL_DATE,
      });
      expect(atThreshold.minimumWageExempt).toBe(true);
    });
  });

  describe('the rules the source documents state explicitly', () => {
    it('taxes band by band, never the top rate on the whole income', async () => {
      const result = await paye.calculate({
        companyId: fixture.companyId,
        // Annual 60,000,000 — into the top 25% band.
        monthlyTaxableGrossKobo: 5_000_000_00n,
        pensionableEmolumentsKobo: 0n,
        pensionEnrolled: false,
        on: PAYROLL_DATE,
      });

      const chargeable = 6_000_000_000n; // 60,000,000 naira in kobo
      expect(result.chargeableIncomeKobo).toBe(chargeable.toString());

      // Band by band: 0 + 330,000 + 1,620,000 + 2,730,000 + 5,750,000 + 2,500,000
      const expected = 0n + 33_000_000n + 162_000_000n + 273_000_000n + 575_000_000n + 250_000_000n;
      expect(result.annualPayeKobo).toBe(expected.toString());

      // The flat-top-rate error would give 25% of everything.
      const flatTopRate = (chargeable * 25n) / 100n;
      expect(BigInt(result.annualPayeKobo)).toBeLessThan(flatTopRate);

      expect(result.bands).toHaveLength(6);
      expect(result.bands[0]!.taxKobo).toBe('0');
      expect(result.bands[5]!.sliceKobo).toBe('1000000000'); // 10,000,000 over 50m
    });

    it('grants no Consolidated Relief Allowance', async () => {
      // With no reliefs at all, chargeable income equals gross exactly. A CRA
      // would silently reduce it.
      const result = await paye.calculate({
        companyId: fixture.companyId,
        monthlyTaxableGrossKobo: 500_000_00n,
        pensionableEmolumentsKobo: 0n,
        pensionEnrolled: false,
        on: PAYROLL_DATE,
      });
      expect(result.chargeableIncomeKobo).toBe(result.annualGrossKobo);
      expect(result.totalReliefsKobo).toBe('0');
    });

    it('withholds evidence-based reliefs when documents are incomplete', async () => {
      const withEvidence = await paye.calculate({
        companyId: fixture.companyId,
        monthlyTaxableGrossKobo: 327_000_00n,
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: true,
        annualRentKobo: 1_200_000_00n,
        nhfAnnualKobo: 98_100_00n,
        documentsComplete: true,
        on: PAYROLL_DATE,
      });
      const without = await paye.calculate({
        companyId: fixture.companyId,
        monthlyTaxableGrossKobo: 327_000_00n,
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: true,
        annualRentKobo: 1_200_000_00n,
        nhfAnnualKobo: 98_100_00n,
        documentsComplete: false,
        on: PAYROLL_DATE,
      });

      expect(without.reliefsWithheldForEvidence).toBe(true);
      expect(without.rentReliefKobo).toBe('0');
      expect(without.annualNhfReliefKobo).toBe('0');
      // Pension is a payroll fact rather than a declared relief, so it stands.
      expect(without.annualPensionReliefKobo).toBe(
        withEvidence.annualPensionReliefKobo,
      );
      expect(BigInt(without.annualPayeKobo)).toBeGreaterThan(
        BigInt(withEvidence.annualPayeKobo),
      );
    });

    it('refuses to compute against an empty band table', async () => {
      await prisma.payeBand.deleteMany({ where: { companyId: fixture.companyId } });
      await expect(
        paye.calculate({
          companyId: fixture.companyId,
          monthlyTaxableGrossKobo: 327_000_00n,
          pensionableEmolumentsKobo: 297_000_00n,
          pensionEnrolled: true,
          on: PAYROLL_DATE,
        }),
      ).rejects.toThrow(/No PAYE bands are effective/i);
    });

    it('refuses a band table with a gap, at the database', async () => {
      await expect(
        prisma.payeBand.create({
          data: {
            companyId: fixture.companyId,
            bandOrder: 7,
            // Band 6 is unbounded; a band above it leaves the schedule incoherent.
            lowerLimitKobo: 90_000_000_00n,
            upperLimitKobo: null,
            rate: '0.30000000',
            effectiveFrom: new Date('2026-01-01'),
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a band that does not start where the previous ends', async () => {
      await prisma.payeBand.deleteMany({ where: { companyId: fixture.companyId } });
      await prisma.payeBand.create({
        data: {
          companyId: fixture.companyId,
          bandOrder: 1,
          lowerLimitKobo: 0n,
          upperLimitKobo: 800_000_00n,
          rate: '0.00000000',
          effectiveFrom: new Date('2026-01-01'),
        },
      });

      await expect(
        prisma.payeBand.create({
          data: {
            companyId: fixture.companyId,
            bandOrder: 2,
            // Leaves 800,000-900,000 untaxed by omission.
            lowerLimitKobo: 900_000_00n,
            upperLimitKobo: 3_000_000_00n,
            rate: '0.15000000',
            effectiveFrom: new Date('2026-01-01'),
          },
        }),
      ).rejects.toThrow(/must start where band/i);
    });
  });

  describe('YTD true-up (§7.1)', () => {
    it('computes the catch-up for a mid-year starter', async () => {
      const result = paye.trueUp({
        annualPayeKobo: 39_494_040n,
        monthsWorked: 6,
        priorYtdDeductedKobo: 0n,
      });
      expect(result.expectedYtdKobo).toBe('19747020');
      expect(result.currentMonthKobo).toBe('19747020');
      expect(result.isRefund).toBe(false);
    });

    it('surfaces an over-deduction as a refund rather than hiding it', async () => {
      const result = paye.trueUp({
        annualPayeKobo: 39_494_040n,
        monthsWorked: 6,
        priorYtdDeductedKobo: 25_000_000n,
      });
      expect(result.isRefund).toBe(true);
      expect(BigInt(result.currentMonthKobo)).toBeLessThan(0n);
    });
  });

  // =========================================================================
  // §7.2 Statutory
  // =========================================================================

  describe('statutory engine reproduces the Nigeria_Statutory_Payroll workbook', () => {
    it('EMP001: pension 23,760 / 29,700, NHF 8,175, NSITF 3,270, ITF 3,270', async () => {
      const result = await statutory.calculate({
        companyId: fixture.companyId,
        grossPayKobo: 327_000_00n,
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: true,
        nhfEnrolled: true,
        // Company_Setup B7 in the workbook.
        employeeCount: 30,
        on: PAYROLL_DATE,
      });

      expect(result.employeePensionKobo).toBe('2376000'); // 23,760
      expect(result.employerPensionKobo).toBe('2970000'); // 29,700
      expect(result.nhfKobo).toBe('817500');              //  8,175
      expect(result.nsitfKobo).toBe('327000');            //  3,270
      expect(result.itfKobo).toBe('327000');              //  3,270
      expect(result.totalEmployerCostKobo).toBe('3624000'); // 36,240
    });

    it('uses basic+housing+transport for pension, NOT gross', async () => {
      const result = await statutory.calculate({
        companyId: fixture.companyId,
        grossPayKobo: 327_000_00n,
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: true,
        nhfEnrolled: true,
        employeeCount: 30,
        on: PAYROLL_DATE,
      });

      // 8% of 297,000 is 23,760. 8% of gross 327,000 would be 26,160.
      expect(result.employeePensionKobo).toBe('2376000');
      expect(result.employeePensionKobo).not.toBe('2616000');
      // NHF genuinely does use gross: 2.5% of 327,000 = 8,175.
      expect(result.nhfKobo).toBe('817500');
    });

    it('zeroes the employee deduction when the employer funds all 18%', async () => {
      await seedStatutoryConfiguration({ pensionFunding: 'EMPLOYER_PAYS_ALL_18' });

      const result = await statutory.calculate({
        companyId: fixture.companyId,
        grossPayKobo: 327_000_00n,
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: true,
        nhfEnrolled: true,
        employeeCount: 30,
        on: PAYROLL_DATE,
      });

      expect(result.employeePensionKobo).toBe('0');
      // 18% of 297,000 = 53,460.
      expect(result.employerPensionKobo).toBe('5346000');
    });

    it('applies no pension below the headcount threshold', async () => {
      const result = await statutory.calculate({
        companyId: fixture.companyId,
        grossPayKobo: 327_000_00n,
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: true,
        nhfEnrolled: true,
        employeeCount: 2,
        on: PAYROLL_DATE,
      });
      expect(result.employeePensionKobo).toBe('0');
      expect(result.applicability.pensionApplicable).toBe(false);
      expect(result.applicability.pensionReason).toMatch(/below the threshold/i);
    });

    it('does not deduct NHF without opt-in at both levels', async () => {
      const notEnrolled = await statutory.calculate({
        companyId: fixture.companyId,
        grossPayKobo: 327_000_00n,
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: true,
        nhfEnrolled: false,
        employeeCount: 30,
        on: PAYROLL_DATE,
      });
      expect(notEnrolled.nhfKobo).toBe('0');

      await seedStatutoryConfiguration({ nhfCompanyParticipation: false });
      const companyOff = await statutory.calculate({
        companyId: fixture.companyId,
        grossPayKobo: 327_000_00n,
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: true,
        nhfEnrolled: true,
        employeeCount: 30,
        on: PAYROLL_DATE,
      });
      expect(companyOff.nhfKobo).toBe('0');
      expect(companyOff.applicability.nhfReason).toMatch(/has not enabled NHF/i);
    });

    it('does not deduct NHF below the minimum wage', async () => {
      const result = await statutory.calculate({
        companyId: fixture.companyId,
        grossPayKobo: 65_000_00n,
        pensionableEmolumentsKobo: 60_000_00n,
        pensionEnrolled: true,
        nhfEnrolled: true,
        employeeCount: 30,
        on: PAYROLL_DATE,
      });
      expect(result.nhfKobo).toBe('0');
      expect(result.applicability.nhfReason).toMatch(/below the minimum wage/i);
    });

    it('charges NSITF regardless of applicability tests, employer only', async () => {
      const result = await statutory.calculate({
        companyId: fixture.companyId,
        grossPayKobo: 327_000_00n,
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: false,
        nhfEnrolled: false,
        employeeCount: 1,
        on: PAYROLL_DATE,
      });
      // 1% of gross, even with pension and NHF both off.
      expect(result.nsitfKobo).toBe('327000');
    });

    it('does not charge ITF below the headcount threshold or in a free trade zone', async () => {
      const belowThreshold = await statutory.calculate({
        companyId: fixture.companyId,
        grossPayKobo: 327_000_00n,
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: true,
        nhfEnrolled: true,
        employeeCount: 10,
        on: PAYROLL_DATE,
      });
      expect(belowThreshold.itfKobo).toBe('0');

      await prisma.company.update({
        where: { id: fixture.companyId },
        data: { freeTradeZone: true },
      });
      const inFtz = await statutory.calculate({
        companyId: fixture.companyId,
        grossPayKobo: 327_000_00n,
        pensionableEmolumentsKobo: 297_000_00n,
        pensionEnrolled: true,
        nhfEnrolled: true,
        employeeCount: 30,
        on: PAYROLL_DATE,
      });
      expect(inFtz.itfKobo).toBe('0');
      expect(inFtz.applicability.itfReason).toMatch(/free trade zone/i);
    });

    it('refuses to calculate with no statutory configuration', async () => {
      await prisma.statutoryConfiguration.deleteMany({
        where: { companyId: fixture.companyId },
      });
      await expect(
        statutory.calculate({
          companyId: fixture.companyId,
          grossPayKobo: 327_000_00n,
          pensionableEmolumentsKobo: 297_000_00n,
          pensionEnrolled: true,
          nhfEnrolled: true,
          employeeCount: 30,
          on: PAYROLL_DATE,
        }),
      ).rejects.toThrow(/No statutory payroll configuration/i);
    });
  });

  // =========================================================================
  // §7 The run, end to end
  // =========================================================================

  describe('payroll run: calculate, approve, post', () => {
    async function seedWorkflowRoute() {
      await prisma.workflowDefinition.create({
        data: {
          companyId: fixture.companyId,
          transactionType: 'PAYROLL_RUN',
          name: 'Payroll route',
          autoPostOnApproval: true,
          effectiveFrom: new Date('2026-01-01'),
          steps: {
            create: [
              {
                level: 1,
                roleCode: 'FINANCE_MANAGER',
                name: 'Finance Manager',
                maxAmountKobo: null,
              },
            ],
          },
        },
      });
    }

    async function newRun() {
      return payroll.createRun({
        companyId: fixture.companyId,
        year: 2026,
        month: 1,
        branchId: fixture.branchId,
        financialYearId: fixture.financialYearId,
        financialPeriodId: fixture.periodIds[0]!,
        currencyId: fixture.currencyId,
        actorId: fixture.makerId,
      });
    }

    it('calculates EMP001 exactly as both workbooks do', async () => {
      await makeEmployee({
        number: 'EMP001',
        firstName: 'Amina',
        surname: 'Yusuf',
        basic: 180_000_00n,
        housing: 72_000_00n,
        transport: 45_000_00n,
        other: 30_000_00n,
        reliefs: {
          annualRent: 1_200_000_00n,
          nhf: 98_100_00n,
          life: 60_000_00n,
          bonus: 120_000_00n,
        },
      });
      // Two more so the pension headcount test passes.
      await makeEmployee({
        number: 'EMP002', firstName: 'Chinedu', surname: 'Okafor',
        basic: 220_000_00n, housing: 88_000_00n, transport: 55_000_00n, other: 35_000_00n,
      });
      await makeEmployee({
        number: 'EMP003', firstName: 'Bola', surname: 'Adeyemi',
        basic: 250_000_00n, housing: 100_000_00n, transport: 62_500_00n, other: 40_000_00n,
        nhfEnrolled: false,
      });

      const run = await newRun();
      const calculated = await payroll.calculate({
        payrollRunId: run.id,
        actorId: fixture.makerId,
      });

      expect(calculated.status).toBe(PayrollRunStatus.CALCULATED);
      expect(calculated.employeeCount).toBe(3);

      const line = await prisma.payrollRunLine.findFirstOrThrow({
        where: { payrollRunId: run.id, employee: { employeeNumber: 'EMP001' } },
      });

      expect(line.monthlyGrossKobo).toBe(32_700_000n);
      expect(line.pensionableEmolumentsKobo).toBe(29_700_000n);
      expect(line.monthlyPayeKobo).toBe(3_291_170n);      // 32,911.70
      expect(line.employeePensionKobo).toBe(2_376_000n);  // 23,760
      expect(line.employerPensionKobo).toBe(2_970_000n);  // 29,700
      expect(line.nhfKobo).toBe(817_500n);                //  8,175
      expect(line.nsitfKobo).toBe(327_000n);              //  3,270
      // Only three employees, so ITF (25+) does not apply.
      expect(line.itfKobo).toBe(0n);

      // PAYE workbook column AC: net before other deductions = 262,153.30
      expect(line.netPayKobo).toBe(26_215_330n);
    });

    it('posts the §7 accrual and leaves the trial balance balanced', async () => {
      await seedWorkflowRoute();
      await makeEmployee({
        number: 'EMP001', firstName: 'Amina', surname: 'Yusuf',
        basic: 180_000_00n, housing: 72_000_00n, transport: 45_000_00n, other: 30_000_00n,
        reliefs: { annualRent: 1_200_000_00n, nhf: 98_100_00n, life: 60_000_00n, bonus: 120_000_00n },
      });
      await makeEmployee({
        number: 'EMP002', firstName: 'Chinedu', surname: 'Okafor',
        basic: 220_000_00n, housing: 88_000_00n, transport: 55_000_00n, other: 35_000_00n,
      });
      await makeEmployee({
        number: 'EMP003', firstName: 'Bola', surname: 'Adeyemi',
        basic: 250_000_00n, housing: 100_000_00n, transport: 62_500_00n, other: 40_000_00n,
        nhfEnrolled: false,
      });

      const run = await newRun();
      const calculated = await payroll.calculate({
        payrollRunId: run.id,
        actorId: fixture.makerId,
      });

      const submitted = await payroll.submit({ payrollRunId: run.id, actor: maker });
      const approved = await workflow.approve({
        transactionId: submitted.transactionId,
        actor: approver,
      });

      expect(approved.status).toBe('POSTED');
      expect(approved.journalEntryId).toBeTruthy();

      const tb = await trialBalance.build({ companyId: fixture.companyId });
      expect(tb.balanced).toBe(true);

      const entry = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: approved.journalEntryId! },
        include: { lines: { include: { glAccount: true } } },
      });

      const byAccount = new Map<string, bigint>();
      for (const line of entry.lines) {
        const key = line.glAccount.accountNumber;
        byAccount.set(
          key,
          (byAccount.get(key) ?? 0n) + line.debitKobo - line.creditKobo,
        );
      }

      // Salary expense is the full gross.
      expect(byAccount.get('5101')).toBe(calculated.totalGrossKobo);
      // Employer pension expense.
      expect(byAccount.get('5102')).toBe(calculated.totalEmployerPensionKobo);
      // Pension payable carries BOTH sides of the contribution.
      expect(byAccount.get('2102')).toBe(
        -(calculated.totalEmployeePensionKobo + calculated.totalEmployerPensionKobo),
      );
      expect(byAccount.get('2110')).toBe(-calculated.totalPayeKobo);
      expect(byAccount.get('2103')).toBe(-calculated.totalNhfKobo);
      expect(byAccount.get('2101')).toBe(-calculated.totalNetPayKobo);
    });

    it('splits the expense by cost centre, not one lumped line', async () => {
      await seedWorkflowRoute();
      const second = await prisma.costCentre.create({
        data: {
          companyId: fixture.companyId,
          code: 'SN-QC',
          name: 'SN QC',
          branchId: fixture.branchId,
          effectiveDate: new Date('2026-01-01'),
        },
      });

      await makeEmployee({
        number: 'EMP001', firstName: 'A', surname: 'One',
        basic: 180_000_00n, housing: 72_000_00n, transport: 45_000_00n, other: 0n,
      });
      await makeEmployee({
        number: 'EMP002', firstName: 'B', surname: 'Two',
        basic: 200_000_00n, housing: 80_000_00n, transport: 50_000_00n, other: 0n,
      });
      const third = await makeEmployee({
        number: 'EMP003', firstName: 'C', surname: 'Three',
        basic: 150_000_00n, housing: 60_000_00n, transport: 37_500_00n, other: 0n,
      });
      await prisma.employee.update({
        where: { id: third.id },
        data: { costCentreId: second.id },
      });

      const run = await newRun();
      await payroll.calculate({ payrollRunId: run.id, actorId: fixture.makerId });
      const submitted = await payroll.submit({ payrollRunId: run.id, actor: maker });
      const approved = await workflow.approve({
        transactionId: submitted.transactionId,
        actor: approver,
      });

      const salaryLines = await prisma.journalLine.findMany({
        where: {
          journalEntryId: approved.journalEntryId!,
          glAccount: { accountNumber: '5101' },
        },
      });
      expect(salaryLines).toHaveLength(2);
      expect(new Set(salaryLines.map((l) => l.costCentreId)).size).toBe(2);
    });

    it('refuses to calculate while an employee fails validation', async () => {
      const employee = await makeEmployee({
        number: 'EMP001', firstName: 'A', surname: 'One',
        basic: 180_000_00n, housing: 72_000_00n, transport: 45_000_00n, other: 0n,
      });
      await prisma.employee.update({
        where: { id: employee.id },
        data: { costCentreId: null },
      });

      const run = await newRun();
      await expect(
        payroll.calculate({ payrollRunId: run.id, actorId: fixture.makerId }),
      ).rejects.toThrow(/fail validation/i);
    });

    it('refuses a second run for the same month', async () => {
      await newRun();
      await expect(newRun()).rejects.toThrow(/already exists/i);
    });

    it('stores a reproducible calculation snapshot (§7.1)', async () => {
      await makeEmployee({
        number: 'EMP001', firstName: 'A', surname: 'One',
        basic: 180_000_00n, housing: 72_000_00n, transport: 45_000_00n, other: 30_000_00n,
        reliefs: { annualRent: 1_200_000_00n, nhf: 98_100_00n, life: 60_000_00n, bonus: 120_000_00n },
      });
      await makeEmployee({
        number: 'EMP002', firstName: 'B', surname: 'Two',
        basic: 200_000_00n, housing: 80_000_00n, transport: 50_000_00n, other: 0n,
      });
      await makeEmployee({
        number: 'EMP003', firstName: 'C', surname: 'Three',
        basic: 150_000_00n, housing: 60_000_00n, transport: 37_500_00n, other: 0n,
      });

      const run = await newRun();
      await payroll.calculate({ payrollRunId: run.id, actorId: fixture.makerId });

      const line = await prisma.payrollRunLine.findFirstOrThrow({
        where: { payrollRunId: run.id, employee: { employeeNumber: 'EMP001' } },
      });
      const snapshot = line.calculationSnapshot as Record<string, unknown>;
      const payeSnapshot = snapshot.paye as Record<string, unknown>;

      expect(payeSnapshot.ruleVersion).toBe('NTA-2025-2026.01');
      expect(Array.isArray(payeSnapshot.bands)).toBe(true);
      expect((payeSnapshot.bands as unknown[]).length).toBe(6);
      expect(snapshot.headcount).toBe(3);
    });

    it('refuses to change a posted run, at the database', async () => {
      await seedWorkflowRoute();
      await makeEmployee({
        number: 'EMP001', firstName: 'A', surname: 'One',
        basic: 180_000_00n, housing: 72_000_00n, transport: 45_000_00n, other: 0n,
      });
      await makeEmployee({
        number: 'EMP002', firstName: 'B', surname: 'Two',
        basic: 200_000_00n, housing: 80_000_00n, transport: 50_000_00n, other: 0n,
      });
      await makeEmployee({
        number: 'EMP003', firstName: 'C', surname: 'Three',
        basic: 150_000_00n, housing: 60_000_00n, transport: 37_500_00n, other: 0n,
      });

      const run = await newRun();
      await payroll.calculate({ payrollRunId: run.id, actorId: fixture.makerId });
      const submitted = await payroll.submit({ payrollRunId: run.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE payroll_runs SET status = 'DRAFT' WHERE id = $1::uuid`,
          run.id,
        ),
      ).rejects.toThrow(/is posted/i);

      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM payroll_run_lines WHERE payroll_run_id = $1::uuid`,
          run.id,
        ),
      ).rejects.toThrow(/is posted/i);
    });

    it('groups PAYE by tax state for remittance (§7.1)', async () => {
      await makeEmployee({
        number: 'EMP001', firstName: 'A', surname: 'One', taxState: 'Lagos',
        basic: 180_000_00n, housing: 72_000_00n, transport: 45_000_00n, other: 30_000_00n,
      });
      await makeEmployee({
        number: 'EMP002', firstName: 'B', surname: 'Two', taxState: 'Ogun',
        basic: 200_000_00n, housing: 80_000_00n, transport: 50_000_00n, other: 0n,
      });
      await makeEmployee({
        number: 'EMP003', firstName: 'C', surname: 'Three', taxState: 'Lagos',
        basic: 150_000_00n, housing: 60_000_00n, transport: 37_500_00n, other: 0n,
      });

      const run = await newRun();
      await payroll.calculate({ payrollRunId: run.id, actorId: fixture.makerId });

      const byState = await payroll.payeByState(run.id);
      expect(byState).toHaveLength(2);
      const lagos = byState.find((s) => s.taxState === 'Lagos')!;
      expect(lagos.employeeCount).toBe(2);
    });

    it('produces a bank schedule of net pay', async () => {
      await makeEmployee({
        number: 'EMP001', firstName: 'A', surname: 'One',
        basic: 180_000_00n, housing: 72_000_00n, transport: 45_000_00n, other: 0n,
      });
      await makeEmployee({
        number: 'EMP002', firstName: 'B', surname: 'Two',
        basic: 200_000_00n, housing: 80_000_00n, transport: 50_000_00n, other: 0n,
      });
      await makeEmployee({
        number: 'EMP003', firstName: 'C', surname: 'Three',
        basic: 150_000_00n, housing: 60_000_00n, transport: 37_500_00n, other: 0n,
      });

      const run = await newRun();
      const calculated = await payroll.calculate({
        payrollRunId: run.id,
        actorId: fixture.makerId,
      });

      const schedule = await payroll.bankSchedule(run.id);
      expect(schedule).toHaveLength(3);
      const total = schedule.reduce((s, r) => s + BigInt(r.netPayKobo), 0n);
      expect(total).toBe(calculated.totalNetPayKobo);
    });
  });
});
