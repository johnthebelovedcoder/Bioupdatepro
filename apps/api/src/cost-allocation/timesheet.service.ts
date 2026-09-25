import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Hours people worked on each population — the basis for sharing wages by
 * "approved hours × actual payroll rate" (PCR-028), the workbook's own method,
 * as an alternative to animal-days.
 *
 * One row per person, population and day: logging the same day again
 * replaces the hours rather than adding a second row, so a correction is an
 * edit, and a person can never be booked for more than 24 hours in a day.
 */
/** Who may approve timesheet hours: the people who run the farm and its money. */
export const APPROVER_ROLES = ['FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO', 'ADMINISTRATOR'];

@Injectable()
export class TimesheetService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, from: Date, to: Date) {
    const entries = await this.prisma.timesheetEntry.findMany({
      where: { companyId, workDate: { gte: from, lte: to } },
      orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
    });
    const [employees, groups] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: [...new Set(entries.map((e) => e.employeeId))] } },
        select: { id: true, employeeNumber: true, firstName: true, surname: true },
      }),
      this.prisma.livestockGroup.findMany({
        where: { id: { in: [...new Set(entries.map((e) => e.groupId))] } },
        select: { id: true, code: true },
      }),
    ]);
    const person = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.surname}`.trim() || e.employeeNumber]));
    const group = new Map(groups.map((g) => [g.id, g.code]));
    return entries.map((entry) => ({
      id: entry.id,
      workDate: entry.workDate,
      employeeId: entry.employeeId,
      employee: person.get(entry.employeeId) ?? '—',
      groupId: entry.groupId,
      group: group.get(entry.groupId) ?? '—',
      hours: entry.hours.toString(),
      notes: entry.notes,
      status: entry.status,
      selfApproved: entry.selfApproved,
      createdById: entry.createdById,
    }));
  }

  /** Log (or correct) a person's hours on a population for a day. */
  async record(params: {
    companyId: string;
    employeeId: string;
    groupId: string;
    workDate: Date;
    hours: Decimal;
    notes?: string | null;
    actor: WorkflowActor;
  }) {
    if (params.hours.lessThanOrEqualTo(0) || params.hours.greaterThan(24)) {
      throw new BadRequestException('Hours must be more than 0 and at most 24.');
    }
    const [employee, group] = await Promise.all([
      this.prisma.employee.findFirst({ where: { id: params.employeeId, companyId: params.companyId } }),
      this.prisma.livestockGroup.findFirst({ where: { id: params.groupId, companyId: params.companyId } }),
    ]);
    if (!employee) throw new NotFoundException('No such employee in this company.');
    if (!group) throw new NotFoundException('No such batch in this company.');

    return this.prisma.$transaction(async (tx) => {
      const sameDay = await tx.timesheetEntry.findMany({
        where: { employeeId: params.employeeId, workDate: params.workDate, groupId: { not: params.groupId } },
        select: { hours: true },
      });
      const elsewhere = sameDay.reduce((sum, e) => sum.plus(e.hours.toString()), new Decimal(0));
      if (elsewhere.plus(params.hours).greaterThan(24)) {
        throw new BadRequestException(
          `That would book ${elsewhere.plus(params.hours).toString()} hours on one day for one person.`,
        );
      }
      return tx.timesheetEntry.upsert({
        where: { employeeId_groupId_workDate: { employeeId: params.employeeId, groupId: params.groupId, workDate: params.workDate } },
        // A correction is new, unapproved information: it goes back for approval.
        update: {
          hours: new Prisma.Decimal(params.hours.toFixed(2)),
          notes: params.notes ?? null,
          status: 'PENDING',
          approvedById: null,
          approvedAt: null,
          selfApproved: false,
        },
        create: {
          companyId: params.companyId,
          employeeId: params.employeeId,
          groupId: params.groupId,
          workDate: params.workDate,
          hours: new Prisma.Decimal(params.hours.toFixed(2)),
          notes: params.notes ?? null,
          createdById: params.actor.userId,
        },
      });
    });
  }

  /**
   * Approve hours — PCR-028's "approved hours". Whoever logged an entry may
   * not approve it, unless nobody else in the company could (the same rule
   * as a self-approved document), in which case it is marked so.
   */
  async approve(params: { companyId: string; ids: string[]; actor: WorkflowActor }) {
    const entries = await this.prisma.timesheetEntry.findMany({
      where: { companyId: params.companyId, id: { in: params.ids }, status: 'PENDING' },
    });
    const own = entries.filter((e) => e.createdById === params.actor.userId);
    let alone = false;
    if (own.length > 0) {
      const others = await this.prisma.user.count({
        where: {
          companyId: params.companyId,
          active: true,
          id: { not: params.actor.userId },
          roles: { hasSome: APPROVER_ROLES },
        },
      });
      alone = others === 0;
      if (!alone) {
        throw new BadRequestException(
          `You logged ${own.length === 1 ? 'one of these entries' : `${own.length} of these entries`} yourself, so someone else approves ${own.length === 1 ? 'it' : 'them'}.`,
        );
      }
    }
    const now = new Date();
    for (const entry of entries) {
      await this.prisma.timesheetEntry.update({
        where: { id: entry.id },
        data: {
          status: 'APPROVED',
          approvedById: params.actor.userId,
          approvedAt: now,
          selfApproved: entry.createdById === params.actor.userId,
        },
      });
    }
    return { approved: entries.length, selfApproved: alone ? own.length : 0 };
  }

  async remove(companyId: string, id: string) {
    const entry = await this.prisma.timesheetEntry.findFirst({ where: { id, companyId } });
    if (!entry) throw new NotFoundException('No such timesheet entry.');
    await this.prisma.timesheetEntry.delete({ where: { id } });
    return { id };
  }

  /**
   * Each population's weight for a month on the HOURS basis: every person's
   * hours on it, times their pay rate for the month — their gross on the
   * month's posted payroll over all the hours they logged. Someone with hours
   * but no posted pay that month counts at the average rate of those with
   * both, so their time is not simply dropped; with nobody paid, hours count
   * as they are.
   */
  async weights(companyId: string, from: Date, to: Date, financialPeriodId: string): Promise<Map<string, { hours: Decimal; weight: Decimal }>> {
    const entries = await this.prisma.timesheetEntry.findMany({
      where: { companyId, workDate: { gte: from, lte: to }, status: 'APPROVED' },
      select: { employeeId: true, groupId: true, hours: true },
    });
    const pay = await this.prisma.payrollRunLine.groupBy({
      by: ['employeeId'],
      where: { payrollRun: { companyId, financialPeriodId, status: 'POSTED' } },
      _sum: { monthlyGrossKobo: true },
    });
    const gross = new Map(pay.map((p) => [p.employeeId, new Decimal((p._sum.monthlyGrossKobo ?? 0n).toString())]));

    const hoursByPerson = new Map<string, Decimal>();
    for (const e of entries) {
      hoursByPerson.set(e.employeeId, (hoursByPerson.get(e.employeeId) ?? new Decimal(0)).plus(e.hours.toString()));
    }
    let paidTotal = new Decimal(0);
    let paidHours = new Decimal(0);
    for (const [employeeId, hours] of hoursByPerson) {
      const g = gross.get(employeeId);
      if (g && g.greaterThan(0)) {
        paidTotal = paidTotal.plus(g);
        paidHours = paidHours.plus(hours);
      }
    }
    const averageRate = paidHours.greaterThan(0) ? paidTotal.div(paidHours) : new Decimal(1);
    const rate = (employeeId: string) => {
      const g = gross.get(employeeId);
      const h = hoursByPerson.get(employeeId)!;
      return g && g.greaterThan(0) ? g.div(h) : averageRate;
    };

    const result = new Map<string, { hours: Decimal; weight: Decimal }>();
    for (const e of entries) {
      const hours = new Decimal(e.hours.toString());
      const row = result.get(e.groupId) ?? { hours: new Decimal(0), weight: new Decimal(0) };
      row.hours = row.hours.plus(hours);
      row.weight = row.weight.plus(hours.mul(rate(e.employeeId)));
      result.set(e.groupId, row);
    }
    return result;
  }
}
