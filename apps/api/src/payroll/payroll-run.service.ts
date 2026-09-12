import { Injectable, Logger } from '@nestjs/common';
import {
  AccountType,
  AuditAction,
  EmploymentStatus,
  NormalBalance,
  PayrollRunStatus,
  Prisma,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { EmployeeService } from '../masters/employee.service';
import { PayeEngineService } from './paye-engine.service';
import { StatutoryEngineService } from './statutory-engine.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

export interface PayrollValidationResult {
  ready: boolean;
  eligible: number;
  blocked: Array<{ employeeNumber: string; blockers: string[] }>;
}

/**
 * Payroll processing (§7).
 *
 * The §7 flow is: Preparation → Validation → Approval → Posting → Payslips →
 * Bank Schedule → GL Posting → Statutory Reports. This owns preparation through
 * GL posting; approval is the shared workflow engine (Rule 5) and payslips are
 * a rendering concern over the stored calculation snapshots.
 *
 * A run holds the whole month for one company. Recalculating replaces the
 * DRAFT lines; once posted, §7.1 forbids overwriting a calculation, so a
 * correction is an adjusting journal rather than a re-run.
 */
@Injectable()
export class PayrollRunService {
  private readonly logger = new Logger(PayrollRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
    private readonly employees: EmployeeService,
    private readonly paye: PayeEngineService,
    private readonly statutory: StatutoryEngineService,
  ) {}

  // -------------------------------------------------------------------------

  async createRun(input: {
    companyId: string;
    year: number;
    month: number;
    branchId: string;
    financialYearId: string;
    financialPeriodId: string;
    currencyId: string;
    actorId: string;
  }) {
    // The payroll date is the last day of the month: the point at which the
    // month's pay is earned, and the date every rate resolves as at.
    const payrollDate = new Date(Date.UTC(input.year, input.month, 0));

    const existing = await this.prisma.payrollRun.findUnique({
      where: {
        companyId_year_month: {
          companyId: input.companyId,
          year: input.year,
          month: input.month,
        },
      },
    });
    if (existing) {
      /*
       * DRAFT means calculate() never got past its own validation for this
       * run — "no employees eligible" being the case that sent someone here
       * in the first place. Without this, that run sits forever as an
       * empty, permanent placeholder: the web app's "Create and calculate"
       * is one action, so a company that adds its first employee AFTER
       * that first attempt could never retry the same period — every
       * subsequent attempt hits this same uniqueness check and refuses,
       * with no screen anywhere to recalculate an existing run instead of
       * creating one. Once calculate() has actually run (CALCULATED or
       * later), reusing it would be wrong — that is a real run with real
       * numbers — so the refusal still stands for every other status.
       */
      if (existing.status === PayrollRunStatus.DRAFT) {
        return existing;
      }
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll processing',
        `A payroll run already exists for ${input.year}-${String(input.month).padStart(2, '0')} ` +
          `(${existing.reference}, ${existing.status}). One run per company per month.`,
        { reference: existing.reference, status: existing.status },
      );
    }

    return this.prisma.payrollRun.create({
      data: {
        companyId: input.companyId,
        year: input.year,
        month: input.month,
        reference: `PAY-${input.year}-${String(input.month).padStart(2, '0')}`,
        payrollDate,
        branchId: input.branchId,
        financialYearId: input.financialYearId,
        financialPeriodId: input.financialPeriodId,
        currencyId: input.currencyId,
        createdById: input.actorId,
      },
    });
  }

  /** Every run this company has, newest first — what the web app's own list needs. */
  async listRuns(companyId: string) {
    const runs = await this.prisma.payrollRun.findMany({
      where: { companyId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 100,
    });

    const pending = await this.prisma.workflowTransaction.findMany({
      where: {
        companyId,
        documentType: 'PayrollRun',
        documentId: { in: runs.map((r) => r.id) },
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
      },
      select: { id: true, documentId: true },
    });
    const pendingByRun = new Map(pending.map((t) => [t.documentId, t.id]));

    return runs.map((run) => ({
      id: run.id,
      reference: run.reference,
      year: run.year,
      month: run.month,
      status: run.status,
      employeeCount: run.employeeCount,
      totalGrossKobo: run.totalGrossKobo.toString(),
      totalNetPayKobo: run.totalNetPayKobo.toString(),
      calculatedAt: run.calculatedAt,
      postedAt: run.postedAt,
      pendingTransactionId: pendingByRun.get(run.id) ?? null,
    }));
  }

  /**
   * §7 "Payroll Validation checks", run across the whole company before any
   * calculation. Reports every blocked employee rather than stopping at the
   * first, so payroll administration is one pass rather than a queue.
   */
  async validate(payrollRunId: string): Promise<PayrollValidationResult> {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({
      where: { id: payrollRunId },
    });

    const candidates = await this.prisma.employee.findMany({
      where: {
        companyId: run.companyId,
        payrollActive: true,
        employmentStatus: {
          notIn: [
            EmploymentStatus.TERMINATED,
            EmploymentStatus.RESIGNED,
            EmploymentStatus.RETIRED,
          ],
        },
        employmentDate: { lte: run.payrollDate },
      },
      select: { id: true, employeeNumber: true },
    });

    const blocked: PayrollValidationResult['blocked'] = [];
    for (const candidate of candidates) {
      const readiness = await this.employees.payrollReadiness(
        candidate.id,
        run.payrollDate,
      );
      if (!readiness.ready) {
        blocked.push({
          employeeNumber: candidate.employeeNumber,
          blockers: readiness.blockers,
        });
      }
    }

    return {
      ready: blocked.length === 0 && candidates.length > 0,
      eligible: candidates.length - blocked.length,
      blocked,
    };
  }

  /**
   * Calculate the whole run.
   *
   * The headcount is taken ONCE and applied to every employee, because the
   * pension and ITF applicability tests are company-level facts. Deriving it
   * per employee would be both slower and wrong at the boundary — an employee
   * added mid-calculation would change the answer for those calculated after.
   */
  async calculate(params: { payrollRunId: string; actorId: string }) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({
      where: { id: params.payrollRunId },
      include: { lines: true },
    });

    if (run.status !== PayrollRunStatus.DRAFT && run.status !== PayrollRunStatus.CALCULATED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll processing',
        `Payroll run ${run.reference} is ${run.status} and cannot be recalculated.`,
        { reference: run.reference, status: run.status },
      );
    }

    const validation = await this.validate(params.payrollRunId);
    if (validation.blocked.length > 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll validation',
        `${validation.blocked.length} employee(s) fail validation and the run cannot be ` +
          `calculated: ` +
          validation.blocked
            .map((b) => `${b.employeeNumber} (${b.blockers.join('; ')})`)
            .join(' | '),
        { blocked: validation.blocked },
      );
    }

    const employees = await this.prisma.employee.findMany({
      where: {
        companyId: run.companyId,
        payrollActive: true,
        employmentStatus: {
          notIn: [
            EmploymentStatus.TERMINATED,
            EmploymentStatus.RESIGNED,
            EmploymentStatus.RETIRED,
          ],
        },
        employmentDate: { lte: run.payrollDate },
      },
      orderBy: { employeeNumber: 'asc' },
    });

    if (employees.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll processing',
        `No employees are eligible for payroll run ${run.reference}.`,
        { reference: run.reference },
      );
    }

    const headcount = employees.length;
    const totals = {
      gross: 0n,
      paye: 0n,
      employeePension: 0n,
      employerPension: 0n,
      nhf: 0n,
      nsitf: 0n,
      itf: 0n,
      other: 0n,
      net: 0n,
    };

    const lines: Prisma.PayrollRunLineCreateManyInput[] = [];
    let ruleVersion: string | null = null;

    for (const employee of employees) {
      const salary = await this.employees.salarySnapshot(employee.id, run.payrollDate);
      const relief = await this.prisma.employeeTaxRelief.findUnique({
        where: { employeeId_taxYear: { employeeId: employee.id, taxYear: run.year } },
      });

      const grossKobo = BigInt(salary.grossPayKobo);
      const taxableKobo = BigInt(salary.taxableGrossKobo);
      const pensionableKobo = BigInt(salary.pensionableEmolumentsKobo);
      const nhfBaseKobo = BigInt(salary.nhfBaseKobo);

      const payeResult = await this.paye.calculate({
        companyId: run.companyId,
        monthlyTaxableGrossKobo: taxableKobo,
        pensionableEmolumentsKobo: pensionableKobo,
        pensionEnrolled: employee.pensionEnrolled,
        annualBonusKobo: relief?.annualBonusKobo ?? 0n,
        annualRentKobo: relief?.annualRentKobo ?? 0n,
        nhfAnnualKobo: relief?.nhfAnnualKobo ?? 0n,
        nhisAnnualKobo: relief?.nhisAnnualKobo ?? 0n,
        lifeAssuranceAnnualKobo: relief?.lifeAssuranceAnnualKobo ?? 0n,
        mortgageInterestAnnualKobo: relief?.mortgageInterestAnnualKobo ?? 0n,
        documentsComplete: relief?.documentsComplete ?? true,
        on: run.payrollDate,
      });
      ruleVersion ??= payeResult.ruleVersion;

      const statutoryResult = await this.statutory.calculate({
        companyId: run.companyId,
        grossPayKobo: grossKobo,
        pensionableEmolumentsKobo: pensionableKobo,
        nhfBaseKobo,
        pensionEnrolled: employee.pensionEnrolled,
        nhfEnrolled: employee.nhfEnrolled,
        employeeCount: headcount,
        on: run.payrollDate,
      });

      const monthlyPaye = BigInt(payeResult.monthlyPayeKobo);
      const employeePension = BigInt(statutoryResult.employeePensionKobo);
      const nhf = BigInt(statutoryResult.nhfKobo);

      // Net pay is gross less the EMPLOYEE-side deductions only. Employer
      // contributions are a company cost and never reduce take-home pay.
      const net = grossKobo - monthlyPaye - employeePension - nhf;

      if (net < 0n) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §7 — Payroll processing',
          `Employee ${employee.employeeNumber} computes to a negative net pay ` +
            `(${net} kobo). Deductions exceed gross pay; review their salary components ` +
            `and reliefs before posting.`,
          { employeeNumber: employee.employeeNumber, netPayKobo: net.toString() },
        );
      }

      totals.gross += grossKobo;
      totals.paye += monthlyPaye;
      totals.employeePension += employeePension;
      totals.employerPension += BigInt(statutoryResult.employerPensionKobo);
      totals.nhf += nhf;
      totals.nsitf += BigInt(statutoryResult.nsitfKobo);
      totals.itf += BigInt(statutoryResult.itfKobo);
      totals.net += net;

      lines.push({
        payrollRunId: run.id,
        employeeId: employee.id,
        departmentId: employee.departmentId,
        costCentreId: employee.costCentreId,
        branchId: employee.branchId,
        taxState: employee.taxState,
        monthlyGrossKobo: grossKobo,
        taxableGrossKobo: taxableKobo,
        pensionableEmolumentsKobo: pensionableKobo,
        annualGrossKobo: BigInt(payeResult.annualGrossKobo),
        annualPensionReliefKobo: BigInt(payeResult.annualPensionReliefKobo),
        annualNhfReliefKobo: BigInt(payeResult.annualNhfReliefKobo),
        annualNhisReliefKobo: BigInt(payeResult.annualNhisReliefKobo),
        annualLifeAssuranceKobo: BigInt(payeResult.annualLifeAssuranceKobo),
        annualMortgageInterestKobo: BigInt(payeResult.annualMortgageInterestKobo),
        rentReliefKobo: BigInt(payeResult.rentReliefKobo),
        totalReliefsKobo: BigInt(payeResult.totalReliefsKobo),
        chargeableIncomeKobo: BigInt(payeResult.chargeableIncomeKobo),
        annualPayeKobo: BigInt(payeResult.annualPayeKobo),
        monthlyPayeKobo: monthlyPaye,
        minimumWageExempt: payeResult.minimumWageExempt,
        employeePensionKobo: employeePension,
        employerPensionKobo: BigInt(statutoryResult.employerPensionKobo),
        nhfKobo: nhf,
        nsitfKobo: BigInt(statutoryResult.nsitfKobo),
        itfKobo: BigInt(statutoryResult.itfKobo),
        netPayKobo: net,
        // §7.1: store the full calculation, not just its answer.
        calculationSnapshot: {
          paye: payeResult,
          statutory: statutoryResult,
          salary: salary.components,
          headcount,
        } as unknown as Prisma.InputJsonValue,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.payrollRunLine.deleteMany({ where: { payrollRunId: run.id } });
      await tx.payrollRunLine.createMany({ data: lines });

      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          status: PayrollRunStatus.CALCULATED,
          employeeCount: headcount,
          calculatedAt: new Date(),
          payeRuleVersion: ruleVersion,
          totalGrossKobo: totals.gross,
          totalPayeKobo: totals.paye,
          totalEmployeePensionKobo: totals.employeePension,
          totalEmployerPensionKobo: totals.employerPension,
          totalNhfKobo: totals.nhf,
          totalNsitfKobo: totals.nsitf,
          totalItfKobo: totals.itf,
          totalOtherDeductionsKobo: totals.other,
          totalNetPayKobo: totals.net,
        },
      });

      await this.audit.write(
        {
          transactionId: run.id,
          module: 'payroll',
          entityType: 'PayrollRun',
          entityId: run.id,
          status: PayrollRunStatus.CALCULATED,
          action: AuditAction.UPDATE,
          userId: params.actorId,
          comments: `Calculated ${run.reference} for ${headcount} employees.`,
          metadata: {
            reference: run.reference,
            headcount,
            totalGrossKobo: totals.gross.toString(),
            totalPayeKobo: totals.paye.toString(),
            ruleVersion,
          },
        },
        tx,
      );

      return updated;
    });
  }

  // -------------------------------------------------------------------------

  async submit(params: { payrollRunId: string; actor: WorkflowActor }) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({
      where: { id: params.payrollRunId },
    });

    if (run.status !== PayrollRunStatus.CALCULATED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll processing',
        `Payroll run ${run.reference} is ${run.status}; calculate it before submitting.`,
        { reference: run.reference, status: run.status },
      );
    }

    const result = await this.workflow.submit({
      companyId: run.companyId,
      transactionType: 'PAYROLL_RUN',
      module: 'payroll',
      documentType: 'PayrollRun',
      documentId: run.id,
      documentReference: run.reference,
      // Routed on total gross: the figure an approval ladder for payroll should
      // be calibrated against.
      amount: kobo(run.totalGrossKobo),
      currencyId: run.currencyId,
      branchId: run.branchId,
      actor: params.actor,
    });

    await this.prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        status: PayrollRunStatus.SUBMITTED,
        workflowTransactionId: result.transactionId,
      },
    });

    return result;
  }

  /**
   * The §7 payroll accrual, posted on final approval.
   *
   *   Dr Salary Expense, Employer Pension, NSITF, ITF
   *   Cr Salary Payable, PAYE Payable, Pension Payable, NHF, NSITF, ITF Payable
   *
   * Pension Payable carries BOTH sides of the contribution, which is why its
   * credit exceeds the employer expense debit — the employee's share arrives
   * from salary rather than from a company expense.
   *
   * Expense lines are posted PER COST CENTRE, not as one company total. §7.2
   * requires every employer-expense line to carry its dimensions, and a single
   * lumped line would make departmental cost reporting impossible after the
   * fact.
   */
  async postApproved(params: {
    payrollRunId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const run = await params.tx.payrollRun.findUniqueOrThrow({
      where: { id: params.payrollRunId },
      include: { lines: true },
    });

    if (run.status === PayrollRunStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `Payroll run ${run.reference} is already posted.`,
        { reference: run.reference },
      );
    }

    const accounts = await this.resolveAccounts(run.companyId, params.tx);

    const dimensions = {
      companyId: run.companyId,
      branchId: run.branchId,
      financialYearId: run.financialYearId,
      financialPeriodId: run.financialPeriodId,
      currencyId: run.currencyId,
      exchangeRate: '1.00000000',
    };

    type Line = {
      glAccountId: string;
      description: string;
      debit?: bigint;
      credit?: bigint;
      costCentreId?: string | null;
      departmentId?: string | null;
      employeeId?: string | null;
    };
    const lines: Line[] = [];

    // --- Expense side, grouped by cost centre ---------------------------
    const byCostCentre = new Map<
      string,
      { costCentreId: string | null; departmentId: string | null; gross: bigint; pension: bigint; nsitf: bigint; itf: bigint }
    >();

    for (const line of run.lines) {
      const key = line.costCentreId ?? 'none';
      const bucket = byCostCentre.get(key) ?? {
        costCentreId: line.costCentreId,
        departmentId: line.departmentId,
        gross: 0n,
        pension: 0n,
        nsitf: 0n,
        itf: 0n,
      };
      bucket.gross += line.monthlyGrossKobo;
      bucket.pension += line.employerPensionKobo;
      bucket.nsitf += line.nsitfKobo;
      bucket.itf += line.itfKobo;
      byCostCentre.set(key, bucket);
    }

    for (const bucket of byCostCentre.values()) {
      const common = {
        costCentreId: bucket.costCentreId,
        departmentId: bucket.departmentId,
      };
      if (bucket.gross > 0n) {
        lines.push({
          glAccountId: accounts.salaryExpense,
          description: 'Salaries and wages',
          debit: bucket.gross,
          ...common,
        });
      }
      if (bucket.pension > 0n) {
        lines.push({
          glAccountId: accounts.employerPensionExpense,
          description: 'Employer pension contribution',
          debit: bucket.pension,
          ...common,
        });
      }
      if (bucket.nsitf > 0n) {
        lines.push({
          glAccountId: accounts.nsitfExpense,
          description: 'NSITF employer contribution',
          debit: bucket.nsitf,
          ...common,
        });
      }
      if (bucket.itf > 0n) {
        lines.push({
          glAccountId: accounts.itfExpense,
          description: 'ITF monthly accrual',
          debit: bucket.itf,
          ...common,
        });
      }
    }

    // --- Liability side, company-level -----------------------------------
    const payables: Array<[string, string, bigint]> = [
      [accounts.salaryPayable, 'Net salary payable', run.totalNetPayKobo],
      [accounts.payePayable, 'PAYE payable', run.totalPayeKobo],
      [
        accounts.pensionPayable,
        'Pension payable (employee and employer)',
        run.totalEmployeePensionKobo + run.totalEmployerPensionKobo,
      ],
      [accounts.nhfPayable, 'NHF payable', run.totalNhfKobo],
      [accounts.nsitfPayable, 'NSITF payable', run.totalNsitfKobo],
      [accounts.itfPayable, 'ITF payable', run.totalItfKobo],
    ];

    for (const [glAccountId, description, amount] of payables) {
      if (amount > 0n) lines.push({ glAccountId, description, credit: amount });
    }

    const result = await this.posting.post(
      {
        sourceModule: 'payroll',
        sourceDocumentType: 'PayrollRun',
        sourceDocumentId: run.id,
        journalNumber: run.reference,
        journalDate: run.payrollDate,
        narration: `Payroll accrual for ${run.reference}`,
        ...dimensions,
        idempotencyKey: `payroll-run:${run.id}`,
        actor: params.actor,
        lines: lines.map((line) => ({
          glAccountId: line.glAccountId,
          description: line.description,
          debit: line.debit !== undefined ? kobo(line.debit) : undefined,
          credit: line.credit !== undefined ? kobo(line.credit) : undefined,
          dimensions: {
            ...dimensions,
            costCentreId: line.costCentreId ?? null,
            departmentId: line.departmentId ?? null,
            employeeId: line.employeeId ?? null,
          },
        })),
      },
      params.tx,
    );

    await params.tx.payrollRun.update({
      where: { id: run.id },
      data: {
        status: PayrollRunStatus.POSTED,
        journalEntryId: result.journalEntryId,
        postedAt: new Date(),
      },
    });

    this.logger.log(`Posted payroll run ${run.reference} -> ${result.journalNumber}`);
    return { journalEntryId: result.journalEntryId };
  }

  // -------------------------------------------------------------------------

  /** §7.1: PAYE is remitted per employee state of residence. */
  async payeByState(payrollRunId: string) {
    const grouped = await this.prisma.payrollRunLine.groupBy({
      by: ['taxState'],
      where: { payrollRunId },
      _count: { _all: true },
      _sum: { monthlyPayeKobo: true, annualPayeKobo: true },
    });

    return grouped.map((row) => ({
      taxState: row.taxState ?? 'UNASSIGNED',
      employeeCount: row._count._all,
      monthlyPayeKobo: (row._sum.monthlyPayeKobo ?? 0n).toString(),
      annualPayeKobo: (row._sum.annualPayeKobo ?? 0n).toString(),
    }));
  }

  /** §7 bank schedule: what each employee is actually paid. */
  async bankSchedule(payrollRunId: string) {
    const lines = await this.prisma.payrollRunLine.findMany({
      where: { payrollRunId },
      include: {
        employee: {
          select: {
            employeeNumber: true,
            firstName: true,
            surname: true,
            bankName: true,
            accountNumber: true,
            accountName: true,
          },
        },
      },
      orderBy: { employee: { employeeNumber: 'asc' } },
    });

    return lines.map((line) => ({
      employeeNumber: line.employee.employeeNumber,
      name: `${line.employee.firstName} ${line.employee.surname}`,
      bankName: line.employee.bankName,
      accountNumber: line.employee.accountNumber,
      accountName: line.employee.accountName,
      netPayKobo: line.netPayKobo.toString(),
    }));
  }

  /** One employee's payslip, from the stored snapshot. */
  async payslip(payrollRunId: string, employeeId: string) {
    const line = await this.prisma.payrollRunLine.findUniqueOrThrow({
      where: { payrollRunId_employeeId: { payrollRunId, employeeId } },
      include: {
        employee: { select: { employeeNumber: true, firstName: true, surname: true } },
        payrollRun: { select: { reference: true, payrollDate: true, payeRuleVersion: true } },
      },
    });

    return {
      run: line.payrollRun.reference,
      payrollDate: line.payrollRun.payrollDate,
      ruleVersion: line.payrollRun.payeRuleVersion,
      employeeNumber: line.employee.employeeNumber,
      name: `${line.employee.firstName} ${line.employee.surname}`,
      grossKobo: line.monthlyGrossKobo.toString(),
      payeKobo: line.monthlyPayeKobo.toString(),
      employeePensionKobo: line.employeePensionKobo.toString(),
      nhfKobo: line.nhfKobo.toString(),
      netPayKobo: line.netPayKobo.toString(),
      employerPensionKobo: line.employerPensionKobo.toString(),
      nsitfKobo: line.nsitfKobo.toString(),
      itfKobo: line.itfKobo.toString(),
      minimumWageExempt: line.minimumWageExempt,
      calculation: line.calculationSnapshot,
    };
  }

  /**
   * The GL accounts payroll posts to.
   *
   * Resolved from salary component configuration where set, falling back to the
   * conventional account numbers. Refuses when an account cannot be found
   * rather than posting to a suspense account nobody watches.
   */
  /** Not private: PayrollPaymentService needs the same payable accounts to know what it is clearing. */
  async resolveAccounts(companyId: string, tx: Prisma.TransactionClient) {
    const required = {
      salaryExpense: '5101',
      employerPensionExpense: '5102',
      nsitfExpense: '5103',
      itfExpense: '5104',
      salaryPayable: '2101',
      pensionPayable: '2102',
      nhfPayable: '2103',
      nsitfPayable: '2104',
      itfPayable: '2105',
      payePayable: '2110',
    } as const;

    let accounts = await tx.gLAccount.findMany({
      where: { companyId, accountNumber: { in: Object.values(required) } },
      select: { id: true, accountNumber: true, active: true, isPostingAccount: true },
    });

    /*
     * Four of these ten (2102-2105, 5102-5104 below) were missing entirely
     * from `ProvisioningService`'s chart for every company registered
     * before that gap was closed — a company could calculate a payroll run
     * but never approve one. Created here, lazily, the same shape as the
     * sales/procurement self-heals elsewhere, and ONLY for a number that is
     * completely absent: an account that exists but is inactive or not a
     * posting account is a real, deliberate configuration problem and still
     * refuses below rather than being silently overridden.
     */
    const found = new Set(accounts.map((a) => a.accountNumber));
    const missing = Object.values(required).filter((number) => !found.has(number));
    if (missing.length > 0) {
      const definitions: Record<string, { name: string; type: AccountType; normal: NormalBalance }> = {
        '2102': { name: 'Pension Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
        '2103': { name: 'NHF Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
        '2104': { name: 'NSITF Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
        '2105': { name: 'ITF Payable', type: AccountType.LIABILITY, normal: NormalBalance.CREDIT },
        '5102': { name: 'Employer Pension Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT },
        '5103': { name: 'NSITF Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT },
        '5104': { name: 'ITF Expense', type: AccountType.EXPENSE, normal: NormalBalance.DEBIT },
      };
      const toCreate = missing.filter((number) => definitions[number]);
      if (toCreate.length > 0) {
        await tx.gLAccount.createMany({
          data: toCreate.map((number) => ({
            companyId,
            accountNumber: number,
            name: definitions[number]!.name,
            accountType: definitions[number]!.type,
            normalBalance: definitions[number]!.normal,
          })),
        });
        accounts = await tx.gLAccount.findMany({
          where: { companyId, accountNumber: { in: Object.values(required) } },
          select: { id: true, accountNumber: true, active: true, isPostingAccount: true },
        });
      }
    }

    const byNumber = new Map(accounts.map((a) => [a.accountNumber, a]));
    const resolved: Record<string, string> = {};

    for (const [key, number] of Object.entries(required)) {
      const account = byNumber.get(number);
      if (!account || !account.active || !account.isPostingAccount) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §7 — Payroll accounting',
          `Payroll needs GL account ${number} (${key}) and it is missing, inactive or not ` +
            `a posting account. Payroll will not post to a substitute.`,
          { accountNumber: number, purpose: key },
        );
      }
      resolved[key] = account.id;
    }

    return resolved as Record<keyof typeof required, string>;
  }
}
