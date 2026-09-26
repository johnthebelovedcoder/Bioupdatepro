import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import {
  AuditAction,
  EmploymentStatus,
  Prisma,
  SalaryComponentBasis,
  SalaryComponentType,
} from '@bioassetpro/database';
import { chartVersionOf, numberFor, type AccountRole } from '../chart/chart';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { Kobo } from '../common/money';
import { documentPackGaps } from './employee-onboarding';

export interface PayrollReadiness {
  ready: boolean;
  employeeNumber: string;
  blockers: string[];
  warnings: string[];
}

export interface SalarySnapshot {
  employeeId: string;
  employeeNumber: string;
  on: string;
  components: Array<{
    code: string;
    name: string;
    type: SalaryComponentType;
    amountKobo: string;
    isTaxable: boolean;
    isPensionable: boolean;
    isNhfBase: boolean;
  }>;
  /** MONEY, all integer kobo. The bases Phase 9's engines read. */
  grossPayKobo: string;
  taxableGrossKobo: string;
  pensionableEmolumentsKobo: string;
  /** MONEY. Basic salary alone — the NHF base, not gross. */
  nhfBaseKobo: string;
}

/** The earning components a company gets on first use of payroll. */
const DEFAULT_EARNINGS = [
  { code: 'BASIC', name: 'Basic salary', taxable: true, pensionable: true, nhfBase: true },
  { code: 'HOUSING', name: 'Housing allowance', taxable: true, pensionable: true, nhfBase: false },
  { code: 'TRANSPORT', name: 'Transport', taxable: true, pensionable: true, nhfBase: false },
  { code: 'UTILITY', name: 'Utility', taxable: true, pensionable: false, nhfBase: false },
  { code: 'MEAL', name: 'Meal', taxable: true, pensionable: false, nhfBase: false },
  { code: 'RESPONSIBILITY', name: 'Responsibility', taxable: true, pensionable: false, nhfBase: false },
  { code: 'LEAVE', name: 'Leave allowance', taxable: true, pensionable: false, nhfBase: false },
  { code: 'BONUS', name: 'Bonus', taxable: true, pensionable: false, nhfBase: false },
  { code: 'OVERTIME', name: 'Overtime', taxable: true, pensionable: false, nhfBase: false },
  { code: 'COMMISSION', name: 'Commission', taxable: true, pensionable: false, nhfBase: false },
] as const;

/**
 * Employee master (§7).
 *
 * The parts that matter downstream are the statutory flags and the
 * effective-dated salary components. Phase 9 computes PAYE and the statutory
 * deductions from exactly these; nothing here computes tax.
 */
@Injectable()
export class EmployeeService {
  /**
   * The earning components pay can be set against.
   *
   * A company that has never set anybody's pay has no rows yet —
   * `setSalaryComponent` creates the default set on first use — so the
   * defaults are listed in that case rather than an empty picker that makes
   * it look as though pay cannot be set at all. Reading never writes.
   */
  async listEarningComponents(companyId: string) {
    const rows = await this.prisma.salaryComponent.findMany({
      where: { companyId, type: SalaryComponentType.EARNING },
      orderBy: { code: 'asc' },
      select: {
        code: true,
        name: true,
        basis: true,
        isTaxable: true,
        isPensionable: true,
        isNhfBase: true,
      },
    });
    if (rows.length > 0) return rows;

    return DEFAULT_EARNINGS.map((spec) => ({
      code: spec.code,
      name: spec.name,
      basis: SalaryComponentBasis.FIXED,
      isTaxable: spec.taxable,
      isPensionable: spec.pensionable,
      isNhfBase: spec.nhfBase,
    }));
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: {
    companyId: string;
    employeeNumber: string;
    firstName: string;
    surname: string;
    employmentDate: Date;
    departmentId?: string | null;
    branchId?: string | null;
    costCentreId?: string | null;
    reportingManagerId?: string | null;
    taxState?: string | null;
    actorId: string;
    [key: string]: unknown;
  }) {
    if (input.reportingManagerId) {
      await this.assertNoManagementCycle(input.reportingManagerId, null);
    }
    await this.assertUniqueIdentity(input.companyId, null, {
      accountNumber: (input.accountNumber as string) ?? null,
      bankName: (input.bankName as string) ?? null,
      tin: (input.tin as string) ?? null,
    });

    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: {
          companyId: input.companyId,
          employeeNumber: input.employeeNumber,
          title: (input.title as string) ?? null,
          firstName: input.firstName,
          middleName: (input.middleName as string) ?? null,
          surname: input.surname,
          gender: (input.gender as string) ?? null,
          dateOfBirth: (input.dateOfBirth as Date) ?? null,
          nationality: (input.nationality as string) ?? null,
          stateOfOrigin: (input.stateOfOrigin as string) ?? null,
          address: (input.address as string) ?? null,
          email: (input.email as string) ?? null,
          phone: (input.phone as string) ?? null,
          employmentDate: input.employmentDate,
          departmentId: input.departmentId ?? null,
          branchId: input.branchId ?? null,
          costCentreId: input.costCentreId ?? null,
          designation: (input.designation as string) ?? null,
          grade: (input.grade as string) ?? null,
          jobCategory: (input.jobCategory as string) ?? null,
          reportingManagerId: input.reportingManagerId ?? null,
          bankName: (input.bankName as string) ?? null,
          accountNumber: (input.accountNumber as string) ?? null,
          accountName: (input.accountName as string) ?? null,
          tin: (input.tin as string) ?? null,
          nhfNumber: (input.nhfNumber as string) ?? null,
          pensionRsaNumber: (input.pensionRsaNumber as string) ?? null,
          pensionAdministrator: (input.pensionAdministrator as string) ?? null,
          taxState: input.taxState ?? null,
          pensionEnrolled: (input.pensionEnrolled as boolean) ?? false,
          nhfEnrolled: (input.nhfEnrolled as boolean) ?? false,
          nextOfKinName: (input.nextOfKinName as string) ?? null,
          nextOfKinRelationship: (input.nextOfKinRelationship as string) ?? null,
          nextOfKinPhone: (input.nextOfKinPhone as string) ?? null,
          nextOfKinAddress: (input.nextOfKinAddress as string) ?? null,
        },
      });

      // Employee_Employment: the job they start in is the first entry of
      // their history.
      await tx.employeeAssignment.create({
        data: {
          companyId: employee.companyId,
          employeeId: employee.id,
          effectiveFrom: employee.employmentDate,
          employmentStatus: employee.employmentStatus,
          employmentType: employee.employmentType,
          departmentId: employee.departmentId,
          costCentreId: employee.costCentreId,
          branchId: employee.branchId,
          designation: employee.designation,
          grade: employee.grade,
          reportingManagerId: employee.reportingManagerId,
          reason: 'Joined',
          recordedById: input.actorId,
        },
      });

      await this.audit.write(
        {
          transactionId: employee.id,
          module: 'masters',
          entityType: 'Employee',
          entityId: employee.id,
          status: employee.employmentStatus,
          action: AuditAction.CREATE,
          userId: input.actorId,
          comments: `Created employee ${employee.employeeNumber} — ${employee.firstName} ${employee.surname}.`,
        },
        tx,
      );

      return employee;
    });
  }

  /**
   * Propose a salary component, or a change to one.
   *
   * Employee_Compensation: pay is prepared by one person and approved by
   * another, and only an approved amount reaches payroll. So this records the
   * change as PENDING; `decideSalaryComponent` approves it, and only then is
   * the current row CLOSED and the new one opened — it never edits an amount
   * in place. §7.1 requires a payroll run to store "the exact rules and
   * source values used", and that is only reproducible if the salary history is
   * intact. The database enforces non-overlap; this method is what makes the
   * common case do the right thing without the caller thinking about it.
   */
  async setSalaryComponent(params: {
    employeeId: string;
    componentCode: string;
    amount?: Kobo | null;
    rate?: Decimal.Value | null;
    effectiveFrom: Date;
    actorId: string;
  }) {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: params.employeeId },
      select: { id: true, companyId: true, employeeNumber: true },
    });

    let component = await this.prisma.salaryComponent.findUnique({
      where: {
        companyId_code: { companyId: employee.companyId, code: params.componentCode },
      },
    });
    if (!component) {
      component = await this.ensureDefaultSalaryComponents(employee.companyId, params.componentCode);
    }
    if (!component) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll setup',
        `Salary component "${params.componentCode}" is not configured for this company.`,
        { componentCode: params.componentCode },
      );
    }

    if (component.basis === SalaryComponentBasis.FIXED && (params.amount === undefined || params.amount === null)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll setup',
        `Component "${component.code}" is a fixed amount and requires one.`,
        { componentCode: component.code },
      );
    }
    if (
      component.basis === SalaryComponentBasis.PERCENTAGE_OF_BASE &&
      (params.rate === undefined || params.rate === null)
    ) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll setup',
        `Component "${component.code}" is percentage-based and requires a rate.`,
        { componentCode: component.code },
      );
    }

    const day = startOfDay(params.effectiveFrom);

    const waiting = await this.prisma.employeeSalaryComponent.findFirst({
      where: { employeeId: params.employeeId, salaryComponentId: component.id, status: 'PENDING', employee: { companyId: employee.companyId } },
      select: { effectiveFrom: true },
    });
    if (waiting) {
      throw new AccountingRuleViolation(
        'Employee_Compensation — one change at a time',
        `A change to ${component.code} from ${waiting.effectiveFrom.toISOString().slice(0, 10)} is already waiting for approval. Approve or reject it first.`,
        { componentCode: component.code },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeSalaryComponent.create({
        data: {
          employeeId: params.employeeId,
          salaryComponentId: component.id,
          status: 'PENDING',
          preparedById: params.actorId,
          amountKobo: params.amount ?? null,
          rate:
            params.rate !== undefined && params.rate !== null
              ? new Prisma.Decimal(params.rate.toString())
              : null,
          effectiveFrom: day,
        },
      });

      await this.audit.write(
        {
          transactionId: employee.id,
          module: 'masters',
          entityType: 'EmployeeSalaryComponent',
          entityId: created.id,
          status: 'PENDING',
          action: AuditAction.UPDATE,
          userId: params.actorId,
          comments:
            `Proposed ${component.code} for ${employee.employeeNumber} from ` +
            `${day.toISOString().slice(0, 10)}.`,
          metadata: {
            componentCode: component.code,
            amountKobo: params.amount?.toString() ?? null,
            rate: params.rate?.toString() ?? null,
          },
        },
        tx,
      );

      return created;
    });
  }

  /**
   * Approve or reject a proposed salary change (Employee_Compensation: maker
   * and checker are different people unless the company allows otherwise).
   * Approval closes the row it replaces the day before the new one starts.
   */
  async decideSalaryComponent(params: {
    companyId: string;
    rowId: string;
    approve: boolean;
    reason?: string;
    actorId: string;
  }) {
    const row = await this.prisma.employeeSalaryComponent.findFirst({
      where: { id: params.rowId, employee: { companyId: params.companyId } },
      include: { salaryComponent: { select: { code: true } }, employee: { select: { employeeNumber: true } } },
    });
    if (!row) throw new NotFoundException('No such pay change.');
    if (row.status !== 'PENDING') throw new BadRequestException(`That pay change was already ${row.status.toLowerCase()}.`);
    if (params.approve && row.preparedById === params.actorId) {
      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { allowSelfApproval: true } });
      if (!company.allowSelfApproval) throw new ForbiddenException('You prepared this pay change, so someone else must approve it.');
    }
    if (!params.approve && !params.reason?.trim()) throw new BadRequestException('Say why the pay change is rejected.');

    return this.prisma.$transaction(async (tx) => {
      if (params.approve) {
        const previousDay = new Date(row.effectiveFrom);
        previousDay.setUTCDate(previousDay.getUTCDate() - 1);
        const later = await tx.employeeSalaryComponent.findFirst({
          where: { employeeId: row.employeeId, salaryComponentId: row.salaryComponentId, status: 'APPROVED', effectiveFrom: { gte: row.effectiveFrom } },
          select: { effectiveFrom: true },
        });
        if (later) {
          throw new AccountingRuleViolation(
            'Employee_Compensation — history is not rewritten',
            `${row.salaryComponent.code} already has an approved amount from ${later.effectiveFrom.toISOString().slice(0, 10)}; a change must start after it.`,
            { componentCode: row.salaryComponent.code },
          );
        }
        await tx.employeeSalaryComponent.updateMany({
          where: {
            employeeId: row.employeeId,
            salaryComponentId: row.salaryComponentId,
            status: 'APPROVED',
            effectiveTo: null,
            effectiveFrom: { lt: row.effectiveFrom },
          },
          data: { effectiveTo: previousDay },
        });
      }
      const decided = await tx.employeeSalaryComponent.update({
        where: { id: row.id },
        data: { status: params.approve ? 'APPROVED' : 'REJECTED', approvedById: params.actorId, approvedAt: new Date() },
      });
      await this.audit.write(
        {
          transactionId: row.employeeId,
          module: 'masters',
          entityType: 'EmployeeSalaryComponent',
          entityId: row.id,
          status: decided.status,
          action: params.approve ? AuditAction.APPROVE : AuditAction.REJECT,
          userId: params.actorId,
          comments: params.approve
            ? `Approved ${row.salaryComponent.code} for ${row.employee.employeeNumber} from ${row.effectiveFrom.toISOString().slice(0, 10)}.`
            : params.reason!.trim(),
        },
        tx,
      );
      return decided;
    });
  }

  /**
   * The same default salary components `ProvisioningService.provisionCompany()`
   * now gives a new signup, applied lazily for a company that predates that
   * fix — same shape as `ensureDefaultUnits`/`ensureDefaultTemplates`
   * elsewhere in this codebase. Only runs when the company has literally
   * none yet, so it can never overwrite a company's own, deliberately
   * different component set. Returns the row matching `wantCode` if the
   * default set includes it, else `null` — a code outside the known
   * defaults is a real "not configured" case, not something to guess at.
   */
  private async ensureDefaultSalaryComponents(companyId: string, wantCode: string) {
    const existing = await this.prisma.salaryComponent.count({ where: { companyId } });
    if (existing > 0) return null;

    // Each purpose resolved on the company's own chart (chart.ts).
    const version = await chartVersionOf(this.prisma, companyId);
    const n = (role: AccountRole) => numberFor(version, role);
    const accounts = await this.prisma.gLAccount.findMany({
      where: {
        companyId,
        accountNumber: {
          in: [
            n('salaryExpense'), n('salaryPayable'), n('pensionPayable'), n('nhfPayable'), n('nsitfPayable'),
            n('itfPayable'), n('payePayable'), n('employerPensionExpense'), n('nsitfExpense'), n('itfExpense'),
          ],
        },
      },
      select: { id: true, accountNumber: true },
    });
    const byNumber = new Map(accounts.map((a) => [a.accountNumber, a.id]));

    const earnings = DEFAULT_EARNINGS;

    const rows: Prisma.SalaryComponentCreateManyInput[] = earnings.map((spec) => ({
      companyId,
      code: spec.code,
      name: spec.name,
      type: SalaryComponentType.EARNING,
      isTaxable: spec.taxable,
      isPensionable: spec.pensionable,
      isNhfBase: spec.nhfBase,
      isGrossPayComponent: true,
      expenseGlAccountId: byNumber.get(n('salaryExpense')) ?? null,
      payableGlAccountId: byNumber.get(n('salaryPayable')) ?? null,
    }));

    const statutory: Array<{
      code: string;
      name: string;
      type: SalaryComponentType;
      payable: string;
      expense?: string;
    }> = [
      { code: 'PAYE', name: 'PAYE', type: SalaryComponentType.DEDUCTION, payable: n('payePayable') },
      { code: 'PENSION-EE', name: 'Employee pension', type: SalaryComponentType.DEDUCTION, payable: n('pensionPayable') },
      { code: 'NHF', name: 'NHF', type: SalaryComponentType.DEDUCTION, payable: n('nhfPayable') },
      {
        code: 'PENSION-ER',
        name: 'Employer pension',
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        payable: n('pensionPayable'),
        expense: n('employerPensionExpense'),
      },
      {
        code: 'NSITF',
        name: 'NSITF',
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        payable: n('nsitfPayable'),
        expense: n('nsitfExpense'),
      },
      {
        code: 'ITF',
        name: 'ITF',
        type: SalaryComponentType.EMPLOYER_CONTRIBUTION,
        payable: n('itfPayable'),
        expense: n('itfExpense'),
      },
    ];
    for (const spec of statutory) {
      rows.push({
        companyId,
        code: spec.code,
        name: spec.name,
        type: spec.type,
        isTaxable: false,
        isPensionable: false,
        isGrossPayComponent: false,
        payableGlAccountId: byNumber.get(spec.payable) ?? null,
        expenseGlAccountId: spec.expense ? (byNumber.get(spec.expense) ?? null) : null,
      });
    }

    await this.prisma.salaryComponent.createMany({ data: rows });

    const wanted = rows.find((r) => r.code === wantCode);
    if (!wanted) return null;
    return this.prisma.salaryComponent.findUnique({
      where: { companyId_code: { companyId, code: wantCode } },
    });
  }

  /**
   * The salary in force on a date, with the three bases Phase 9 needs.
   *
   * The pensionable base is NOT gross. The statutory workbook is explicit that
   * it is Basic + Housing + Transport, and its Developer_Logic sheet says in
   * terms "do not calculate pension on gross pay by default". That is why the
   * base is summed from components flagged pensionable rather than from gross.
   */
  async salarySnapshot(employeeId: string, on: Date): Promise<SalarySnapshot> {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
      select: { id: true, employeeNumber: true },
    });

    const day = startOfDay(on);

    const assignments = await this.prisma.employeeSalaryComponent.findMany({
      where: {
        employeeId,
        status: 'APPROVED',
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      include: { salaryComponent: true },
      orderBy: { salaryComponent: { code: 'asc' } },
    });

    let gross = 0n;
    let taxable = 0n;
    let pensionable = 0n;
    let nhfBase = 0n;

    const components = assignments
      .filter((a) => a.salaryComponent.type === SalaryComponentType.EARNING)
      .map((a) => {
        const amount = a.amountKobo ?? 0n;
        if (a.salaryComponent.isGrossPayComponent) gross += amount;
        if (a.salaryComponent.isTaxable) taxable += amount;
        if (a.salaryComponent.isPensionable) pensionable += amount;
        if (a.salaryComponent.isNhfBase) nhfBase += amount;

        return {
          code: a.salaryComponent.code,
          name: a.salaryComponent.name,
          type: a.salaryComponent.type,
          amountKobo: amount.toString(),
          isTaxable: a.salaryComponent.isTaxable,
          isPensionable: a.salaryComponent.isPensionable,
          isNhfBase: a.salaryComponent.isNhfBase,
        };
      });

    return {
      employeeId: employee.id,
      employeeNumber: employee.employeeNumber,
      on: day.toISOString().slice(0, 10),
      components,
      grossPayKobo: gross.toString(),
      taxableGrossKobo: taxable.toString(),
      pensionableEmolumentsKobo: pensionable.toString(),
      nhfBaseKobo: nhfBase.toString(),
    };
  }

  /**
   * §7 "Payroll Validation checks": Employee Active, Salary Exists, Bank
   * Details Complete, Cost Centre / Department / Branch Assigned, Pension Info
   * Available, NHF Info Available.
   *
   * Blockers stop a payroll run; warnings do not. The split matters: a missing
   * cost centre makes the GL posting impossible (§7.2 says reject it), while a
   * missing NHF number only matters if the employee is actually enrolled.
   */
  async payrollReadiness(employeeId: string, on: Date): Promise<PayrollReadiness> {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
    });

    const blockers: string[] = [];
    const warnings: string[] = [];

    // PROBATION is deliberately NOT a blocker: a probationer is on the payroll
    // and is paid. What blocks payroll is a status under which no salary is due
    // — suspension or an ended employment. Treating "not yet confirmed" as
    // unpayable would also make §7's onboarding flow circular, since payroll
    // activation is the step that precedes confirmation.
    const nonPayingStatuses: EmploymentStatus[] = [
      EmploymentStatus.SUSPENDED,
      EmploymentStatus.TERMINATED,
      EmploymentStatus.RESIGNED,
      EmploymentStatus.RETIRED,
    ];
    if (nonPayingStatuses.includes(employee.employmentStatus)) {
      blockers.push(
        `Employment status is ${employee.employmentStatus}; no salary is due under it.`,
      );
    }
    if (!employee.payrollActive) {
      blockers.push('Employee has not been activated for payroll (§7 onboarding).');
    }
    if (!employee.costCentreId) {
      // §7.2 Developer_Logic: "Reject posting where required cost centre is missing."
      blockers.push('No cost centre assigned; the payroll GL posting would be rejected.');
    }
    if (!employee.departmentId) warnings.push('No department assigned.');
    if (!employee.branchId) blockers.push('No branch assigned; branch is a mandatory dimension (§1.1).');

    if (!employee.bankName || !employee.accountNumber) {
      blockers.push('Bank details incomplete; the employee cannot be paid.');
    }

    const snapshot = await this.salarySnapshot(employeeId, on);
    if (snapshot.components.length === 0) {
      blockers.push(`No salary components in force on ${snapshot.on}.`);
    }

    if (employee.pensionEnrolled && !employee.pensionRsaNumber) {
      blockers.push('Enrolled in pension but has no RSA number; remittance would fail.');
    }
    if (employee.pensionEnrolled && !employee.pensionAdministrator) {
      warnings.push('Enrolled in pension but no PFA recorded.');
    }
    if (employee.nhfEnrolled && !employee.nhfNumber) {
      blockers.push('Enrolled in NHF but has no NHF number; remittance would fail.');
    }
    if (!employee.taxState) {
      // PAYE is remitted per state of residence, so a missing state means the
      // liability cannot be assigned to an authority.
      blockers.push('No tax state recorded; PAYE could not be remitted (§7.1).');
    }
    if (!employee.tin) warnings.push('No TIN recorded.');

    const pendingPay = await this.prisma.employeeSalaryComponent.count({
      where: { employeeId, status: 'PENDING', employee: { companyId: employee.companyId } },
    });
    if (pendingPay > 0) {
      warnings.push(`${pendingPay} pay change${pendingPay === 1 ? ' is' : 's are'} waiting for approval and will not be paid until approved.`);
    }

    // Employee_Master_Checks: the document pack must be complete before
    // payroll accepts the employee. For someone already on payroll before the
    // checks existed, a gap is a warning to clear rather than a stopped run.
    const verifications = await this.prisma.employeeVerification.findMany({
      where: { companyId: employee.companyId, employeeId },
      select: { checkType: true, status: true },
    });
    const gaps = documentPackGaps(employee, verifications);
    if (gaps.length > 0) {
      const message = `Document pack incomplete: ${gaps.join('; ')}.`;
      if (employee.payrollActive) warnings.push(message);
      else blockers.push(message);
    }

    return {
      ready: blockers.length === 0,
      employeeNumber: employee.employeeNumber,
      blockers,
      warnings,
    };
  }

  /**
   * Activate an employee for payroll. Refuses while any blocker stands, so the
   * validation cannot be skipped by setting the flag directly through the API.
   */
  /**
   * INT-001/INT-012, AC-HR-001: one person, one record — a bank account or a
   * TIN already on another employee is refused, the usual shape of a ghost
   * employee.
   */
  async assertUniqueIdentity(
    companyId: string,
    employeeId: string | null,
    identity: { accountNumber?: string | null; bankName?: string | null; tin?: string | null },
  ) {
    const others = { ...(employeeId ? { id: { not: employeeId } } : {}) };
    const account = identity.accountNumber?.trim();
    if (account) {
      const clash = await this.prisma.employee.findFirst({
        where: { companyId, ...others, accountNumber: account, ...(identity.bankName?.trim() ? { bankName: identity.bankName.trim() } : {}) },
        select: { employeeNumber: true },
      });
      if (clash) {
        throw new AccountingRuleViolation(
          'INT-012 — One employee, one bank account',
          `Account ${account} is already ${clash.employeeNumber}'s. Two employees cannot be paid into one account.`,
          { employeeNumber: clash.employeeNumber },
        );
      }
    }
    const tin = identity.tin?.trim();
    if (tin) {
      const clash = await this.prisma.employee.findFirst({ where: { companyId, ...others, tin }, select: { employeeNumber: true } });
      if (clash) {
        throw new AccountingRuleViolation(
          'INT-012 — One employee, one identity',
          `TIN ${tin} is already ${clash.employeeNumber}'s.`,
          { employeeNumber: clash.employeeNumber },
        );
      }
    }
  }

  async activateForPayroll(params: { employeeId: string; on: Date; actorId: string }) {
    const readiness = await this.payrollReadiness(params.employeeId, params.on);

    // INT-012: "HR Officer ≠ HR Manager" — whoever set the employee up does not
    // also put them on payroll, unless the company allows self-approval.
    const subject = await this.prisma.employee.findUniqueOrThrow({ where: { id: params.employeeId }, select: { companyId: true, employeeNumber: true } });
    const created = await this.prisma.auditRecord.findFirst({
      where: { companyId: subject.companyId, entityType: 'Employee', entityId: params.employeeId, action: AuditAction.CREATE },
      select: { userId: true },
    });
    if (created?.userId === params.actorId) {
      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: subject.companyId }, select: { allowSelfApproval: true } });
      if (!company.allowSelfApproval) {
        throw new AccountingRuleViolation(
          'INT-012 — Maker ≠ approver',
          `You set up ${subject.employeeNumber}, so someone else activates them for payroll.`,
          { employeeNumber: subject.employeeNumber },
        );
      }
    }

    // The activation flag itself is a blocker before activation; ignore that one.
    const realBlockers = readiness.blockers.filter(
      (b) => !b.includes('not been activated for payroll'),
    );

    if (realBlockers.length > 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §7 — Payroll validation',
        `Employee ${readiness.employeeNumber} cannot be activated for payroll: ` +
          realBlockers.join(' '),
        { blockers: realBlockers },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Only the payroll flag. Employment status is a separate concern (§7
      // Employee Movement — confirmation, suspension, exit), and silently
      // confirming someone off probation because payroll was switched on would
      // change an employment fact as a side effect of a finance action.
      const employee = await tx.employee.update({
        where: { id: params.employeeId },
        data: { payrollActive: true },
      });

      await this.audit.write(
        {
          transactionId: employee.id,
          module: 'masters',
          entityType: 'Employee',
          entityId: employee.id,
          status: 'PAYROLL_ACTIVE',
          action: AuditAction.APPROVE,
          userId: params.actorId,
          comments: `Activated ${employee.employeeNumber} for payroll.`,
        },
        tx,
      );

      return employee;
    });
  }

  /**
   * A reporting line must not loop. The database rejects self-reference; this
   * catches the longer cycles it cannot see from one row.
   */
  async assertNoManagementCycle(
    managerId: string,
    employeeId: string | null,
  ): Promise<void> {
    const seen = new Set<string>(employeeId ? [employeeId] : []);
    let current: string | null = managerId;

    while (current) {
      if (seen.has(current)) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §7 — Employee master',
          `This reporting line would form a cycle.`,
          { managerId },
        );
      }
      seen.add(current);

      const next: { reportingManagerId: string | null } | null =
        await this.prisma.employee.findUnique({
          where: { id: current },
          select: { reportingManagerId: true },
        });
      current = next?.reportingManagerId ?? null;
    }
  }

  async list(companyId: string, status?: EmploymentStatus) {
    return this.prisma.employee.findMany({
      where: { companyId, ...(status ? { employmentStatus: status } : {}) },
      orderBy: { employeeNumber: 'asc' },
      include: {
        department: { select: { code: true, name: true } },
        costCentre: { select: { code: true } },
      },
    });
  }
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
