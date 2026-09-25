import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, EmploymentStatus, EmploymentType } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { EmployeeService } from './employee.service';
import {
  documentPackGaps,
  requiredChecks,
  VERIFICATION_CHECKS,
  VERIFICATION_STATUSES,
  type VerificationCheck,
} from './employee-onboarding';

/** Personal and payment fields HR keeps up to date outside a job change. */
const DETAIL_FIELDS = [
  'title', 'firstName', 'middleName', 'surname', 'gender', 'nationality', 'stateOfOrigin', 'address', 'email', 'phone',
  'bankName', 'accountNumber', 'accountName',
  'tin', 'nhfNumber', 'pensionRsaNumber', 'pensionAdministrator', 'taxState',
  'nextOfKinName', 'nextOfKinRelationship', 'nextOfKinPhone', 'nextOfKinAddress',
] as const;
type DetailField = (typeof DETAIL_FIELDS)[number];

/** A change to one of these undoes the check that vouched for the old value. */
const RECHECK_ON_CHANGE: Partial<Record<DetailField, VerificationCheck>> = {
  bankName: 'BANK',
  accountNumber: 'BANK',
  accountName: 'BANK',
  tin: 'TAX_ID',
  pensionRsaNumber: 'PENSION',
  pensionAdministrator: 'PENSION',
  nhfNumber: 'NHF',
  address: 'ADDRESS',
  nextOfKinName: 'EMERGENCY_CONTACT',
  nextOfKinPhone: 'EMERGENCY_CONTACT',
};

/** What a check needs on the record before it can be verified. */
const EVIDENCE_FIELD: Partial<Record<VerificationCheck, { field: DetailField; label: string }[]>> = {
  BANK: [
    { field: 'bankName', label: 'bank' },
    { field: 'accountNumber', label: 'account number' },
  ],
  TAX_ID: [{ field: 'tin', label: 'TIN' }],
  PENSION: [
    { field: 'pensionRsaNumber', label: 'RSA number' },
    { field: 'pensionAdministrator', label: 'PFA' },
  ],
  NHF: [{ field: 'nhfNumber', label: 'NHF number' }],
  ADDRESS: [{ field: 'address', label: 'address' }],
  EMERGENCY_CONTACT: [
    { field: 'nextOfKinName', label: 'next of kin' },
    { field: 'nextOfKinPhone', label: 'next-of-kin phone' },
  ],
};

const EXIT_STATUSES: EmploymentStatus[] = [EmploymentStatus.TERMINATED, EmploymentStatus.RESIGNED, EmploymentStatus.RETIRED];

/**
 * Employee onboarding in the workbook's four steps — Employee_Master_v2
 * (personal), Employee_Employment, Employee_Compensation, Employee_Documents —
 * and the Employee_Master_Checks that say whether each is done.
 */
@Injectable()
export class EmployeeOnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly employees: EmployeeService,
  ) {}

  async onboarding(companyId: string, employeeId: string, on: Date) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: {
        department: { select: { code: true, name: true } },
        branch: { select: { code: true, name: true } },
        costCentre: { select: { code: true, name: true } },
        reportingManager: { select: { employeeNumber: true, firstName: true, surname: true } },
      },
    });
    if (!employee) throw new NotFoundException('No such employee.');

    const [assignments, pay, verifications, readiness] = await Promise.all([
      this.prisma.employeeAssignment.findMany({
        where: { companyId, employeeId },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.employeeSalaryComponent.findMany({
        where: { employeeId, employee: { companyId } },
        include: { salaryComponent: { select: { code: true, name: true } } },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.employeeVerification.findMany({ where: { companyId, employeeId } }),
      this.employees.payrollReadiness(employeeId, on),
    ]);

    const userIds = [
      ...assignments.map((a) => a.recordedById),
      ...pay.flatMap((p) => [p.preparedById, p.approvedById]),
      ...verifications.map((v) => v.verifiedById),
    ].filter((id): id is string => Boolean(id));
    const users = await this.prisma.user.findMany({
      where: { companyId, id: { in: [...new Set(userIds)] } },
      select: { id: true, fullName: true },
    });
    const nameOf = (id: string | null) => (id ? users.find((u) => u.id === id)?.fullName ?? 'someone' : null);

    const [deptIds, centreIds, branchIds, farmIds, managerIds] = [
      assignments.map((a) => a.departmentId),
      assignments.map((a) => a.costCentreId),
      assignments.map((a) => a.branchId),
      assignments.map((a) => a.farmId),
      assignments.map((a) => a.reportingManagerId),
    ].map((ids) => [...new Set(ids.filter((id): id is string => Boolean(id)))]);
    const [depts, centres, branches, farms, managers] = await Promise.all([
      this.prisma.department.findMany({ where: { companyId, id: { in: deptIds } }, select: { id: true, code: true } }),
      this.prisma.costCentre.findMany({ where: { companyId, id: { in: centreIds } }, select: { id: true, code: true } }),
      this.prisma.branch.findMany({ where: { companyId, id: { in: branchIds } }, select: { id: true, code: true } }),
      this.prisma.farm.findMany({ where: { companyId, id: { in: farmIds } }, select: { id: true, code: true } }),
      this.prisma.employee.findMany({ where: { companyId, id: { in: managerIds } }, select: { id: true, employeeNumber: true } }),
    ]);
    const code = (rows: Array<{ id: string; code?: string; employeeNumber?: string }>, id: string | null) =>
      id ? (rows.find((r) => r.id === id)?.code ?? rows.find((r) => r.id === id)?.employeeNumber ?? null) : null;

    // Step 1 — personal (Employee_Master_v2).
    const personalMissing = [
      [employee.dateOfBirth, 'date of birth'],
      [employee.gender, 'gender'],
      [employee.phone || employee.email, 'a phone number or email'],
      [employee.address, 'address'],
      [employee.nextOfKinName && employee.nextOfKinPhone, 'next of kin and their phone'],
      [employee.bankName && employee.accountNumber, 'bank details'],
      [employee.taxState, 'tax state'],
    ]
      .filter(([value]) => !value)
      .map(([, label]) => String(label));

    // Step 2 — employment (Employee_Employment).
    const current = assignments.find((a) => a.effectiveFrom <= on) ?? null;
    const employmentMissing: string[] = [];
    if (!current) employmentMissing.push('no assignment in force');
    else {
      if (EXIT_STATUSES.includes(current.employmentStatus as EmploymentStatus)) employmentMissing.push(`employment ended (${current.employmentStatus.toLowerCase()})`);
      if (!current.departmentId) employmentMissing.push('department');
      if (!current.costCentreId) employmentMissing.push('cost centre');
      if (!current.branchId) employmentMissing.push('branch');
      if (!current.designation) employmentMissing.push('designation');
    }

    // Step 3 — compensation (Employee_Compensation).
    const approvedInForce = pay.filter(
      (p) => p.status === 'APPROVED' && p.effectiveFrom <= on && (!p.effectiveTo || p.effectiveTo >= on),
    );
    const pendingPay = pay.filter((p) => p.status === 'PENDING');
    const compensationMissing: string[] = [];
    if (approvedInForce.length === 0) compensationMissing.push('no approved pay in force');
    if (pendingPay.length > 0) compensationMissing.push(`${pendingPay.length} change${pendingPay.length === 1 ? '' : 's'} awaiting approval`);

    // Step 4 — documents (Employee_Documents).
    const gaps = documentPackGaps(employee, verifications);
    const required = new Set<string>(requiredChecks(employee));
    const byType = new Map(verifications.map((v) => [v.checkType, v]));
    const answered = VERIFICATION_CHECKS.filter((c) => {
      const status = byType.get(c.code)?.status;
      return status === 'VERIFIED' || (status === 'NOT_APPLICABLE' && !required.has(c.code));
    }).length;

    const steps = [
      { key: 'PERSONAL', title: 'Personal', complete: personalMissing.length === 0, missing: personalMissing },
      { key: 'EMPLOYMENT', title: 'Employment', complete: employmentMissing.length === 0, missing: employmentMissing },
      { key: 'COMPENSATION', title: 'Compensation', complete: compensationMissing.length === 0, missing: compensationMissing },
      { key: 'DOCUMENTS', title: 'Documents', complete: gaps.length === 0, missing: gaps },
    ];

    return {
      on: on.toISOString().slice(0, 10),
      employee: {
        id: employee.id,
        employeeNumber: employee.employeeNumber,
        name: [employee.firstName, employee.middleName, employee.surname].filter(Boolean).join(' '),
        payrollActive: employee.payrollActive,
        employmentStatus: employee.employmentStatus,
        employmentType: employee.employmentType,
        employmentDate: employee.employmentDate.toISOString().slice(0, 10),
        pensionEnrolled: employee.pensionEnrolled,
        nhfEnrolled: employee.nhfEnrolled,
        details: Object.fromEntries(DETAIL_FIELDS.map((field) => [field, employee[field] ?? null])),
        dateOfBirth: employee.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        department: employee.department,
        branch: employee.branch,
        costCentre: employee.costCentre,
        reportingManager: employee.reportingManager
          ? `${employee.reportingManager.employeeNumber} — ${employee.reportingManager.firstName} ${employee.reportingManager.surname}`
          : null,
      },
      steps,
      allComplete: steps.every((s) => s.complete),
      assignments: assignments.map((a) => ({
        id: a.id,
        effectiveFrom: a.effectiveFrom.toISOString().slice(0, 10),
        current: a.id === current?.id,
        employmentStatus: a.employmentStatus,
        employmentType: a.employmentType,
        department: code(depts, a.departmentId),
        costCentre: code(centres, a.costCentreId),
        branch: code(branches, a.branchId),
        farm: code(farms, a.farmId),
        reportingManager: code(managers, a.reportingManagerId),
        designation: a.designation,
        grade: a.grade,
        shift: a.shift,
        reason: a.reason,
        recordedBy: nameOf(a.recordedById),
      })),
      pay: pay.map((p) => ({
        id: p.id,
        code: p.salaryComponent.code,
        name: p.salaryComponent.name,
        amountKobo: p.amountKobo?.toString() ?? null,
        rate: p.rate?.toString() ?? null,
        effectiveFrom: p.effectiveFrom.toISOString().slice(0, 10),
        effectiveTo: p.effectiveTo?.toISOString().slice(0, 10) ?? null,
        status: p.status,
        preparedBy: nameOf(p.preparedById),
        approvedBy: nameOf(p.approvedById),
        inForce: approvedInForce.some((a) => a.id === p.id),
      })),
      checks: VERIFICATION_CHECKS.map((c) => {
        const v = byType.get(c.code);
        return {
          code: c.code,
          label: c.label,
          required: required.has(c.code),
          status: v?.status ?? 'OUTSTANDING',
          reference: v?.reference ?? null,
          note: v?.note ?? null,
          verifiedBy: v ? nameOf(v.verifiedById) : null,
          verifiedAt: v?.verifiedAt.toISOString().slice(0, 10) ?? null,
        };
      }),
      documentPack: { answered, total: VERIFICATION_CHECKS.length },
      readiness,
    };
  }

  async listDepartments(companyId: string) {
    return this.prisma.department.findMany({
      where: { companyId, active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
  }

  /**
   * Personal, bank and statutory details. A changed bank account, TIN, RSA or
   * NHF number undoes the check that vouched for the old one — a verified
   * account that has since been edited is not verified.
   */
  async updateDetails(params: {
    companyId: string;
    employeeId: string;
    details: Partial<Record<DetailField, string | null>> & { dateOfBirth?: string | null; pensionEnrolled?: boolean; nhfEnrolled?: boolean };
    actorId: string;
  }) {
    const employee = await this.prisma.employee.findFirst({ where: { id: params.employeeId, companyId: params.companyId } });
    if (!employee) throw new NotFoundException('No such employee.');

    const data: Record<string, unknown> = {};
    const recheck = new Set<VerificationCheck>();
    for (const field of DETAIL_FIELDS) {
      if (!(field in params.details)) continue;
      const raw = params.details[field];
      const value = typeof raw === 'string' ? raw.trim() || null : null;
      if ((field === 'firstName' || field === 'surname') && !value) throw new BadRequestException('First name and surname cannot be blank.');
      if (value !== (employee[field] ?? null)) {
        data[field] = value;
        const check = RECHECK_ON_CHANGE[field];
        if (check) recheck.add(check);
      }
    }
    if ('dateOfBirth' in params.details) {
      const dob = params.details.dateOfBirth ? new Date(params.details.dateOfBirth) : null;
      if (dob && (Number.isNaN(dob.getTime()) || dob >= employee.employmentDate)) {
        throw new BadRequestException('Give a date of birth before the employment date.');
      }
      data.dateOfBirth = dob;
    }
    for (const flag of ['pensionEnrolled', 'nhfEnrolled'] as const) {
      if (typeof params.details[flag] === 'boolean' && params.details[flag] !== employee[flag]) data[flag] = params.details[flag];
    }
    if (Object.keys(data).length === 0) return employee;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({ where: { id: employee.id }, data });
      if (recheck.size > 0) {
        await tx.employeeVerification.deleteMany({
          where: { companyId: params.companyId, employeeId: employee.id, checkType: { in: [...recheck] } },
        });
      }
      await this.audit.write(
        {
          transactionId: employee.id,
          module: 'masters',
          entityType: 'Employee',
          entityId: employee.id,
          status: updated.employmentStatus,
          action: AuditAction.UPDATE,
          userId: params.actorId,
          comments:
            `Updated ${Object.keys(data).join(', ')} for ${employee.employeeNumber}.` +
            (recheck.size > 0 ? ` To verify again: ${[...recheck].join(', ')}.` : ''),
          // Bank and statutory numbers are named, not copied into the log.
          metadata: { fields: Object.keys(data), recheck: [...recheck] },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * A job change from a date (Employee_Employment): promotion, transfer,
   * confirmation, suspension, exit. Recorded as history; the employee's own
   * fields then carry it. Backdating behind the latest entry is refused, and
   * so is a future date — record it on the day it takes effect.
   */
  async recordAssignment(params: {
    companyId: string;
    employeeId: string;
    effectiveFrom: Date;
    employmentStatus: string;
    employmentType: string;
    departmentId?: string | null;
    costCentreId?: string | null;
    branchId?: string | null;
    farmId?: string | null;
    designation?: string | null;
    grade?: string | null;
    reportingManagerId?: string | null;
    shift?: string | null;
    reason: string;
    actorId: string;
  }) {
    const employee = await this.prisma.employee.findFirst({ where: { id: params.employeeId, companyId: params.companyId } });
    if (!employee) throw new NotFoundException('No such employee.');
    if (!Object.values(EmploymentStatus).includes(params.employmentStatus as EmploymentStatus)) {
      throw new BadRequestException(`Unknown employment status ${params.employmentStatus}.`);
    }
    if (!Object.values(EmploymentType).includes(params.employmentType as EmploymentType)) {
      throw new BadRequestException(`Unknown employment type ${params.employmentType}.`);
    }
    if (!params.reason?.trim()) throw new BadRequestException('Say why — promotion, transfer, confirmation, exit.');
    const day = new Date(Date.UTC(params.effectiveFrom.getUTCFullYear(), params.effectiveFrom.getUTCMonth(), params.effectiveFrom.getUTCDate()));
    if (Number.isNaN(day.getTime())) throw new BadRequestException('Give the date it takes effect.');
    if (day > new Date()) throw new BadRequestException('Record a job change on or after the day it takes effect, not before.');
    if (day < employee.employmentDate) throw new BadRequestException('A job change cannot start before the employee joined.');

    const latest = await this.prisma.employeeAssignment.findFirst({
      where: { companyId: params.companyId, employeeId: employee.id },
      orderBy: { effectiveFrom: 'desc' },
      select: { effectiveFrom: true },
    });
    if (latest && day <= latest.effectiveFrom) {
      throw new AccountingRuleViolation(
        'Employee_Employment — history is not rewritten',
        `The latest job change is from ${latest.effectiveFrom.toISOString().slice(0, 10)}; a new one must start after it.`,
        { latest: latest.effectiveFrom.toISOString().slice(0, 10) },
      );
    }

    const owned = async (model: 'department' | 'costCentre' | 'branch' | 'farm', id: string | null | undefined, label: string) => {
      if (!id) return;
      const found = await (this.prisma[model] as unknown as { findFirst: (a: unknown) => Promise<unknown> }).findFirst({
        where: { id, companyId: params.companyId },
        select: { id: true },
      });
      if (!found) throw new BadRequestException(`That ${label} is not one of this company's.`);
    };
    await owned('department', params.departmentId, 'department');
    await owned('costCentre', params.costCentreId, 'cost centre');
    await owned('branch', params.branchId, 'branch');
    await owned('farm', params.farmId, 'farm');
    if (params.reportingManagerId) {
      const manager = await this.prisma.employee.findFirst({ where: { id: params.reportingManagerId, companyId: params.companyId }, select: { id: true } });
      if (!manager) throw new BadRequestException('That manager is not one of this company’s employees.');
      if (manager.id === employee.id) throw new BadRequestException('An employee cannot report to themselves.');
      await this.employees.assertNoManagementCycle(params.reportingManagerId, employee.id);
    }

    const status = params.employmentStatus as EmploymentStatus;
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.employeeAssignment.create({
        data: {
          companyId: params.companyId,
          employeeId: employee.id,
          effectiveFrom: day,
          employmentStatus: status,
          employmentType: params.employmentType,
          departmentId: params.departmentId ?? null,
          costCentreId: params.costCentreId ?? null,
          branchId: params.branchId ?? null,
          farmId: params.farmId ?? null,
          designation: params.designation?.trim() || null,
          grade: params.grade?.trim() || null,
          reportingManagerId: params.reportingManagerId ?? null,
          shift: params.shift?.trim() || null,
          reason: params.reason.trim(),
          recordedById: params.actorId,
        },
      });
      await tx.employee.update({
        where: { id: employee.id },
        data: {
          employmentStatus: status,
          employmentType: params.employmentType as EmploymentType,
          departmentId: assignment.departmentId,
          costCentreId: assignment.costCentreId,
          branchId: assignment.branchId,
          designation: assignment.designation,
          grade: assignment.grade,
          reportingManagerId: assignment.reportingManagerId,
          ...(status === EmploymentStatus.ACTIVE && employee.employmentStatus === EmploymentStatus.PROBATION ? { confirmationDate: day } : {}),
          ...(EXIT_STATUSES.includes(status) ? { exitDate: day } : {}),
        },
      });
      await this.audit.write(
        {
          transactionId: employee.id,
          module: 'masters',
          entityType: 'EmployeeAssignment',
          entityId: assignment.id,
          status,
          action: AuditAction.UPDATE,
          userId: params.actorId,
          comments: `${employee.employeeNumber} from ${day.toISOString().slice(0, 10)}: ${params.reason.trim()}.`,
        },
        tx,
      );
      return assignment;
    });
  }

  /** Record one check in the document pack (Employee_Documents). */
  async verify(params: {
    companyId: string;
    employeeId: string;
    checkType: string;
    status: string;
    reference?: string | null;
    note?: string | null;
    actorId: string;
  }) {
    const check = VERIFICATION_CHECKS.find((c) => c.code === params.checkType);
    if (!check) throw new BadRequestException(`Unknown check ${params.checkType}.`);
    if (!(VERIFICATION_STATUSES as readonly string[]).includes(params.status)) {
      throw new BadRequestException(`Unknown status ${params.status}.`);
    }
    const employee = await this.prisma.employee.findFirst({ where: { id: params.employeeId, companyId: params.companyId } });
    if (!employee) throw new NotFoundException('No such employee.');

    if (params.status === 'NOT_APPLICABLE' && requiredChecks(employee).includes(check.code)) {
      throw new AccountingRuleViolation(
        'Employee_Master_Checks — required document',
        `${check.label} is required for ${employee.employeeNumber}; it cannot be marked not applicable.`,
        { checkType: check.code },
      );
    }
    if (params.status === 'VERIFIED') {
      const missing = (EVIDENCE_FIELD[check.code] ?? []).filter((e) => !employee[e.field]).map((e) => e.label);
      if (missing.length > 0) {
        throw new BadRequestException(`Record the ${missing.join(' and ')} before verifying ${check.label.toLowerCase()}.`);
      }
      if (!params.reference?.trim()) throw new BadRequestException('Say what was seen — a file reference, letter or confirmation.');
    }
    if (params.status === 'NOT_APPLICABLE' && !params.note?.trim()) {
      throw new BadRequestException('Say why it does not apply.');
    }

    return this.prisma.$transaction(async (tx) => {
      const data = {
        status: params.status,
        reference: params.reference?.trim() || null,
        note: params.note?.trim() || null,
        verifiedById: params.actorId,
        verifiedAt: new Date(),
      };
      const existing = await tx.employeeVerification.findFirst({
        where: { companyId: params.companyId, employeeId: employee.id, checkType: check.code },
        select: { id: true },
      });
      const row = existing
        ? await tx.employeeVerification.update({ where: { id: existing.id }, data })
        : await tx.employeeVerification.create({ data: { ...data, companyId: params.companyId, employeeId: employee.id, checkType: check.code } });
      await this.audit.write(
        {
          transactionId: employee.id,
          module: 'masters',
          entityType: 'EmployeeVerification',
          entityId: row.id,
          status: params.status,
          action: AuditAction.UPDATE,
          userId: params.actorId,
          comments: `${check.label} for ${employee.employeeNumber}: ${params.status.toLowerCase().replace('_', ' ')}${data.reference ? ` (${data.reference})` : ''}.`,
        },
        tx,
      );
      return row;
    });
  }
}
