import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EmploymentStatus, PayrollRunStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import type { WorkflowActor } from '../workflow/workflow.types';
import {
  annualLedger,
  dayOf,
  monthsBetween,
  STATUTORY_LEAVE,
  workingDaysBetween,
  type LeavePolicyValues,
} from './leave-rules';

export const LEAVE_TYPES = ['ANNUAL', 'SICK', 'MATERNITY', 'UNPAID'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
/** SOP-038 "Line Manager + HR": whoever approves is not whoever asked. */
const APPROVERS = ['FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO', 'ADMINISTRATOR', 'HR_MANAGER'];
const POLICY_ROLES = ['CFO', 'ADMINISTRATOR', 'HR_MANAGER'];
const EXITED: EmploymentStatus[] = [EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED, EmploymentStatus.RETIRED];
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Leave (SOP-038, RPT-HR-007, AC-HR-003): requests checked against balance
 * and against other leave, approved by someone else; an annual balance that
 * rolls forward and lapses as the policy says; and a payroll effect for leave
 * paid below 100%.
 */
@Injectable()
export class LeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async policy(companyId: string): Promise<LeavePolicyValues & { statutory: boolean }> {
    const row = await this.prisma.leavePolicy.findFirst({ where: { companyId } });
    if (!row) return { ...STATUTORY_LEAVE, statutory: true };
    const values = Object.fromEntries(Object.keys(STATUTORY_LEAVE).map((k) => [k, row[k as keyof LeavePolicyValues]])) as LeavePolicyValues;
    return { ...values, statutory: Object.entries(STATUTORY_LEAVE).every(([k, v]) => values[k as keyof LeavePolicyValues] === v) };
  }

  /** Change the policy — never below the Labour Act minimums. */
  async setPolicy(params: { companyId: string; values: Partial<LeavePolicyValues>; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => POLICY_ROLES.includes(r))) throw new ForbiddenException('Only the CFO, an administrator or the HR manager changes the leave policy.');
    const current = await this.policy(params.companyId);
    const next = { ...current } as LeavePolicyValues & { statutory?: boolean };
    delete next.statutory;
    for (const key of Object.keys(STATUTORY_LEAVE) as Array<keyof LeavePolicyValues>) {
      if (params.values[key] === undefined) continue;
      const value = Number(params.values[key]);
      if (!Number.isInteger(value) || value < 0) throw new BadRequestException(`${key} must be a whole number of zero or more.`);
      next[key] = value;
    }
    const belowLaw: string[] = [];
    if (next.annualDays < STATUTORY_LEAVE.annualDays) belowLaw.push(`annual leave below ${STATUTORY_LEAVE.annualDays} days (s.18)`);
    if (next.annualServiceMonths > STATUTORY_LEAVE.annualServiceMonths) belowLaw.push(`annual leave only after more than ${STATUTORY_LEAVE.annualServiceMonths} months (s.18)`);
    if (next.sickDays < STATUTORY_LEAVE.sickDays) belowLaw.push(`sick leave below ${STATUTORY_LEAVE.sickDays} days (s.16)`);
    if (next.maternityWeeks < STATUTORY_LEAVE.maternityWeeks) belowLaw.push(`maternity leave below ${STATUTORY_LEAVE.maternityWeeks} weeks (s.54)`);
    if (next.maternityPayPercent < STATUTORY_LEAVE.maternityPayPercent || next.maternityPayPercent > 100) belowLaw.push(`maternity pay below ${STATUTORY_LEAVE.maternityPayPercent}% (s.54)`);
    if (next.maternityServiceMonths > STATUTORY_LEAVE.maternityServiceMonths) belowLaw.push(`maternity pay only after more than ${STATUTORY_LEAVE.maternityServiceMonths} months (s.54)`);
    if (belowLaw.length > 0) {
      throw new AccountingRuleViolation('Labour Act — statutory minimums', `The policy cannot give less than the law: ${belowLaw.join('; ')}.`, { belowLaw });
    }
    const saved = await this.prisma.leavePolicy.upsert({
      where: { companyId: params.companyId },
      create: { companyId: params.companyId, ...next, updatedById: params.actor.userId },
      update: { ...next, updatedById: params.actor.userId },
    });
    await this.audit.write({
      transactionId: saved.id,
      module: 'hr',
      entityType: 'LeavePolicy',
      entityId: saved.id,
      status: 'ACTIVE',
      action: AuditAction.CONFIG_CHANGE,
      userId: params.actor.userId,
      comments: `Leave policy: annual ${next.annualDays} days after ${next.annualServiceMonths} months, carry ${next.carryOverYears} year(s); sick ${next.sickDays} days; maternity ${next.maternityWeeks} weeks at ${next.maternityPayPercent}% after ${next.maternityServiceMonths} months.`,
    });
    return this.policy(params.companyId);
  }

  async request(params: {
    companyId: string;
    employeeId: string;
    type: string;
    startDate: Date;
    endDate: Date;
    reason: string;
    handover?: string | null;
    evidenceReference?: string | null;
    actor: WorkflowActor;
  }) {
    const type = params.type as LeaveType;
    if (!LEAVE_TYPES.includes(type)) throw new BadRequestException(`Unknown leave type ${params.type}.`);
    const start = dayOf(params.startDate);
    const end = dayOf(params.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new BadRequestException('Give a start date and an end date on or after it.');
    if (!params.reason?.trim()) throw new BadRequestException('Say what the leave is for.');
    const employee = await this.prisma.employee.findFirst({
      where: { id: params.employeeId, companyId: params.companyId },
      select: { id: true, employeeNumber: true, employmentDate: true, employmentStatus: true },
    });
    if (!employee) throw new NotFoundException('No such employee.');
    if (EXITED.includes(employee.employmentStatus)) throw new BadRequestException(`${employee.employeeNumber} has left; leave is not requested for them.`);
    if (start < employee.employmentDate) throw new BadRequestException('Leave cannot start before the employee joined.');
    if ((type === 'ANNUAL' || type === 'SICK') && start.getUTCFullYear() !== end.getUTCFullYear()) {
      throw new BadRequestException('Leave that crosses 31 December is two requests, one for each year.');
    }

    // SOP-038 "conflict": no two leaves at once.
    const clash = await this.prisma.leaveRequest.findFirst({
      where: { companyId: params.companyId, employeeId: employee.id, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: end }, endDate: { gte: start } },
      select: { type: true, startDate: true, endDate: true },
    });
    if (clash) {
      throw new AccountingRuleViolation(
        'SOP-038 — Conflict',
        `${employee.employeeNumber} already has ${clash.type.toLowerCase()} leave from ${iso(clash.startDate)} to ${iso(clash.endDate)}.`,
        {},
      );
    }

    const policy = await this.policy(params.companyId);
    const workingDays = workingDaysBetween(start, end);
    if (workingDays === 0 && type !== 'MATERNITY') throw new BadRequestException('Those dates contain no working days.');
    let payPercent = 100;

    if (type === 'ANNUAL') {
      const available = await this.annualAvailable(params.companyId, employee, start, policy);
      if (workingDays > available) {
        throw new AccountingRuleViolation(
          'SOP-038 — Balance',
          `${employee.employeeNumber} has ${available} day${available === 1 ? '' : 's'} of annual leave available on ${iso(start)}; ${workingDays} asked for. Take unpaid leave for the rest.`,
          { available, requested: workingDays },
        );
      }
    } else if (type === 'SICK') {
      if (!params.evidenceReference?.trim()) throw new BadRequestException('Sick leave needs its medical certificate reference (Labour Act s.16).');
      const used = await this.daysOfType(params.companyId, employee.id, 'SICK', start.getUTCFullYear());
      if (used + workingDays > policy.sickDays) {
        throw new AccountingRuleViolation(
          'Labour Act s.16 — Sick leave',
          `${employee.employeeNumber} has ${Math.max(policy.sickDays - used, 0)} paid sick day(s) left in ${start.getUTCFullYear()}; ${workingDays} asked for. Take the rest as unpaid leave.`,
          { used, requested: workingDays },
        );
      }
    } else if (type === 'MATERNITY') {
      const calendarDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
      if (calendarDays > policy.maternityWeeks * 7) {
        throw new AccountingRuleViolation('Labour Act s.54 — Maternity leave', `Maternity leave is up to ${policy.maternityWeeks} weeks; this is ${calendarDays} days.`, {});
      }
      payPercent = monthsBetween(employee.employmentDate, start) >= policy.maternityServiceMonths ? policy.maternityPayPercent : 0;
    } else {
      payPercent = 0;
    }

    const leave = await this.prisma.leaveRequest.create({
      data: {
        companyId: params.companyId,
        employeeId: employee.id,
        type,
        startDate: start,
        endDate: end,
        workingDays,
        payPercent,
        reason: params.reason.trim(),
        handover: params.handover?.trim() || null,
        evidenceReference: params.evidenceReference?.trim() || null,
        requestedById: params.actor.userId,
      },
    });
    await this.audit.write({
      transactionId: leave.id,
      module: 'hr',
      entityType: 'LeaveRequest',
      entityId: leave.id,
      status: 'PENDING',
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      comments: `${type.toLowerCase()} leave for ${employee.employeeNumber}, ${iso(start)} to ${iso(end)} (${workingDays} working days, ${payPercent}% pay).`,
    });
    return leave;
  }

  async decide(params: { companyId: string; leaveId: string; approve: boolean; note?: string | null; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => APPROVERS.includes(r))) throw new ForbiddenException('A manager or HR approves leave.');
    const leave = await this.prisma.leaveRequest.findFirst({ where: { id: params.leaveId, companyId: params.companyId } });
    if (!leave) throw new NotFoundException('No such leave request.');
    if (leave.status !== 'PENDING') throw new BadRequestException(`That request was already ${leave.status.toLowerCase()}.`);
    if (params.approve && leave.requestedById === params.actor.userId) {
      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { allowSelfApproval: true } });
      if (!company.allowSelfApproval) throw new ForbiddenException('You requested this leave, so someone else approves it.');
    }
    const note = params.note?.trim() || null;
    if (!params.approve && !note) throw new BadRequestException('Say why the leave is refused.');
    const status = params.approve ? 'APPROVED' : 'REJECTED';
    const decided = await this.prisma.leaveRequest.update({
      where: { id: leave.id },
      data: { status, decidedById: params.actor.userId, decidedAt: new Date(), decisionNote: note },
    });
    await this.audit.write({
      transactionId: leave.id,
      module: 'hr',
      entityType: 'LeaveRequest',
      entityId: leave.id,
      status,
      action: params.approve ? AuditAction.APPROVE : AuditAction.REJECT,
      userId: params.actor.userId,
      comments: note ?? 'Approved.',
    });
    return decided;
  }

  /**
   * Withdraw a request, or cancel approved leave — unless it cut pay in a
   * month whose payroll has posted, which would leave payroll and leave
   * disagreeing (AC-HR-003).
   */
  async cancel(params: { companyId: string; leaveId: string; note?: string | null; actor: WorkflowActor }) {
    const leave = await this.prisma.leaveRequest.findFirst({ where: { id: params.leaveId, companyId: params.companyId } });
    if (!leave) throw new NotFoundException('No such leave request.');
    if (leave.status !== 'PENDING' && leave.status !== 'APPROVED') throw new BadRequestException(`That request is ${leave.status.toLowerCase()}.`);
    if (leave.status === 'APPROVED') {
      if (!params.actor.roles.some((r) => APPROVERS.includes(r))) throw new ForbiddenException('A manager or HR cancels approved leave.');
      if (!params.note?.trim()) throw new BadRequestException('Say why approved leave is cancelled.');
      if (leave.payPercent < 100) {
        const posted = await this.prisma.payrollRun.findFirst({
          where: {
            companyId: params.companyId,
            status: PayrollRunStatus.POSTED,
            OR: this.monthsOf(leave.startDate, leave.endDate).map(([year, month]) => ({ year, month })),
          },
          select: { reference: true },
        });
        if (posted) {
          throw new AccountingRuleViolation(
            'AC-HR-003 — Payroll effect',
            `This leave reduced pay on ${posted.reference}, which has posted. Correct it on the next payroll instead of cancelling it.`,
            { reference: posted.reference },
          );
        }
      }
    }
    const cancelled = await this.prisma.leaveRequest.update({
      where: { id: leave.id },
      data: { status: 'CANCELLED', decidedById: params.actor.userId, decidedAt: new Date(), decisionNote: params.note?.trim() || 'Withdrawn.' },
    });
    await this.audit.write({
      transactionId: leave.id,
      module: 'hr',
      entityType: 'LeaveRequest',
      entityId: leave.id,
      status: 'CANCELLED',
      action: AuditAction.UPDATE,
      userId: params.actor.userId,
      comments: cancelled.decisionNote ?? 'Cancelled.',
    });
    return cancelled;
  }

  async list(companyId: string, status?: string) {
    const rows = await this.prisma.leaveRequest.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      include: { employee: { select: { employeeNumber: true, firstName: true, surname: true } } },
      orderBy: [{ startDate: 'desc' }],
      take: 300,
    });
    const users = await this.prisma.user.findMany({
      where: { companyId, id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter((id): id is string => Boolean(id)))] } },
      select: { id: true, fullName: true },
    });
    const name = (id: string | null) => (id ? users.find((u) => u.id === id)?.fullName ?? 'someone' : null);
    return rows.map((r) => ({
      id: r.id,
      employee: `${r.employee.employeeNumber} — ${r.employee.firstName} ${r.employee.surname}`,
      type: r.type,
      startDate: iso(r.startDate),
      endDate: iso(r.endDate),
      workingDays: r.workingDays,
      payPercent: r.payPercent,
      reason: r.reason,
      handover: r.handover,
      evidenceReference: r.evidenceReference,
      status: r.status,
      requestedBy: name(r.requestedById),
      decidedBy: name(r.decidedById),
      decisionNote: r.decisionNote,
    }));
  }

  /**
   * RPT-HR-007 Leave Balance & Liability: for each employee, annual leave
   * opening, earned, taken and closing for the year, what lapses at its end,
   * sick leave used, and the closing balance's value at today's daily rate.
   */
  async balances(companyId: string, asOf: Date) {
    const on = dayOf(asOf);
    const year = on.getUTCFullYear();
    const policy = await this.policy(companyId);
    const employees = await this.prisma.employee.findMany({
      where: { companyId, employmentStatus: { notIn: EXITED }, employmentDate: { lte: on } },
      select: { id: true, employeeNumber: true, firstName: true, surname: true, employmentDate: true },
      orderBy: { employeeNumber: 'asc' },
    });
    const monthStart = new Date(Date.UTC(year, on.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(year, on.getUTCMonth() + 1, 0));
    const monthWorkingDays = workingDaysBetween(monthStart, monthEnd);
    const rows = [];
    let totalLiability = 0n;
    for (const e of employees) {
      const annual = await this.approvedAnnual(companyId, e.id);
      const ledger = annualLedger(e.employmentDate, policy, annual.filter((a) => a.startDate <= on), year);
      const current = ledger[ledger.length - 1]!;
      // Earned only once the anniversary has passed.
      const earned = current.earnedOn && current.earnedOn <= on ? current.earned : 0;
      const closing = current.closing - (current.earned - earned);
      const sickUsed = await this.daysOfType(companyId, e.id, 'SICK', year, 'APPROVED');
      const gross = await this.grossOn(companyId, e.id, on);
      const dailyRate = monthWorkingDays > 0 ? gross / BigInt(monthWorkingDays) : 0n;
      const liability = dailyRate * BigInt(Math.max(closing, 0));
      totalLiability += liability;
      rows.push({
        employeeId: e.id,
        employee: `${e.employeeNumber} — ${e.firstName} ${e.surname}`,
        opening: current.opening,
        earned,
        earnedOn: current.earnedOn ? iso(current.earnedOn) : null,
        taken: current.taken,
        closing,
        lapsingAtYearEnd: current.lapsing,
        sickUsed,
        sickRemaining: Math.max(policy.sickDays - sickUsed, 0),
        dailyRateKobo: dailyRate.toString(),
        liabilityKobo: liability.toString(),
      });
    }
    return { asOf: iso(on), year, policy, rows, totalLiabilityKobo: totalLiability.toString() };
  }

  private async annualAvailable(companyId: string, employee: { id: string; employmentDate: Date }, start: Date, policy: LeavePolicyValues) {
    // Approved and still-pending annual leave both count against the balance.
    const booked = await this.prisma.leaveRequest.findMany({
      where: { companyId, employeeId: employee.id, type: 'ANNUAL', status: { in: ['PENDING', 'APPROVED'] } },
      select: { startDate: true, workingDays: true },
    });
    const ledger = annualLedger(employee.employmentDate, policy, booked, start.getUTCFullYear());
    const year = ledger[ledger.length - 1]!;
    const earnedYet = year.earnedOn && year.earnedOn <= start ? 0 : year.earned;
    return Math.max(year.closing - earnedYet, 0);
  }

  private approvedAnnual(companyId: string, employeeId: string) {
    return this.prisma.leaveRequest.findMany({
      where: { companyId, employeeId, type: 'ANNUAL', status: 'APPROVED' },
      select: { startDate: true, workingDays: true },
    });
  }

  private async daysOfType(companyId: string, employeeId: string, type: LeaveType, year: number, status?: 'APPROVED') {
    const rows = await this.prisma.leaveRequest.findMany({
      where: {
        companyId,
        employeeId,
        type,
        status: status ? status : { in: ['PENDING', 'APPROVED'] },
        startDate: { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) },
      },
      select: { workingDays: true },
    });
    return rows.reduce((s, r) => s + r.workingDays, 0);
  }

  private async grossOn(companyId: string, employeeId: string, on: Date): Promise<bigint> {
    const rows = await this.prisma.employeeSalaryComponent.findMany({
      where: { employeeId, employee: { companyId }, status: 'APPROVED', effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }] },
      include: { salaryComponent: { select: { isGrossPayComponent: true, type: true } } },
    });
    return rows.filter((r) => r.salaryComponent.type === 'EARNING' && r.salaryComponent.isGrossPayComponent).reduce((s, r) => s + (r.amountKobo ?? 0n), 0n);
  }

  private monthsOf(start: Date, end: Date): Array<[number, number]> {
    const months: Array<[number, number]> = [];
    for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); d <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
      months.push([d.getUTCFullYear(), d.getUTCMonth() + 1]);
    }
    return months;
  }
}

