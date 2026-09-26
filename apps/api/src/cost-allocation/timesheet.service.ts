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
    const [employees, groups, orders] = await Promise.all([
      this.prisma.employee.findMany({
        where: { id: { in: [...new Set(entries.map((e) => e.employeeId))] } },
        select: { id: true, employeeNumber: true, firstName: true, surname: true },
      }),
      this.prisma.livestockGroup.findMany({
        where: { companyId, id: { in: [...new Set(entries.map((e) => e.groupId).filter((id): id is string => !!id))] } },
        select: { id: true, code: true },
      }),
      this.prisma.productionOrder.findMany({
        where: { companyId, id: { in: [...new Set(entries.map((e) => e.productionOrderId).filter((id): id is string => !!id))] } },
        select: { id: true, orderNumber: true },
      }),
    ]);
    const order = new Map(orders.map((o) => [o.id, o.orderNumber]));
    const person = new Map(employees.map((e) => [e.id, `${e.firstName} ${e.surname}`.trim() || e.employeeNumber]));
    const group = new Map(groups.map((g) => [g.id, g.code]));
    return entries.map((entry) => ({
      id: entry.id,
      workDate: entry.workDate,
      employeeId: entry.employeeId,
      employee: person.get(entry.employeeId) ?? '—',
      groupId: entry.groupId,
      productionOrderId: entry.productionOrderId,
      group: entry.groupId ? (group.get(entry.groupId) ?? '—') : (order.get(entry.productionOrderId ?? '') ?? '—'),
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      hours: entry.hours.toString(),
      notes: entry.notes,
      status: entry.status,
      selfApproved: entry.selfApproved,
      createdById: entry.createdById,
    }));
  }

  /**
   * Log (or correct) a person's hours on a population, or on a processing
   * order, for a day (INT-013). With the shift's start and end, the hours are
   * the shift and it may not overlap another shift of the same person. No
   * time goes on a closed batch or a completed or cancelled order.
   */
  async record(params: {
    companyId: string;
    employeeId: string;
    groupId?: string | null;
    productionOrderId?: string | null;
    workDate: Date;
    hours?: Decimal | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    notes?: string | null;
    actor: WorkflowActor;
  }) {
    if (!!params.groupId === !!params.productionOrderId) {
      throw new BadRequestException('Book the time to a batch or to a processing order — one of the two.');
    }
    if (!!params.startsAt !== !!params.endsAt) throw new BadRequestException('Give both the start and the end of the shift, or neither.');
    let hours = params.hours ?? null;
    if (params.startsAt && params.endsAt) {
      if (params.endsAt <= params.startsAt) throw new BadRequestException('A shift ends after it starts.');
      const shift = new Decimal(params.endsAt.getTime() - params.startsAt.getTime()).div(3_600_000).toDecimalPlaces(2);
      if (hours && !hours.equals(shift)) {
        throw new BadRequestException(`The shift is ${shift.toString()} hours; ${hours.toString()} were entered.`);
      }
      hours = shift;
    }
    if (!hours || hours.lessThanOrEqualTo(0) || hours.greaterThan(24)) {
      throw new BadRequestException('Hours must be more than 0 and at most 24.');
    }
    const employee = await this.prisma.employee.findFirst({ where: { id: params.employeeId, companyId: params.companyId } });
    if (!employee) throw new NotFoundException('No such employee in this company.');
    await this.assertOpenTarget(this.prisma, params.companyId, params.groupId ?? null, params.productionOrderId ?? null, params.workDate);

    return this.prisma.$transaction(async (tx) => {
      const others = await tx.timesheetEntry.findMany({
        where: {
          companyId: params.companyId,
          employeeId: params.employeeId,
          workDate: params.workDate,
          NOT: params.groupId ? { groupId: params.groupId } : { productionOrderId: params.productionOrderId },
        },
        select: { hours: true },
      });
      const elsewhere = others.reduce((sum, e) => sum.plus(e.hours.toString()), new Decimal(0));
      if (elsewhere.plus(hours!).greaterThan(24)) {
        throw new BadRequestException(
          `That would book ${elsewhere.plus(hours!).toString()} hours on one day for one person.`,
        );
      }
      if (params.startsAt && params.endsAt) {
        const clash = await tx.timesheetEntry.findFirst({
          where: {
            companyId: params.companyId,
            employeeId: params.employeeId,
            startsAt: { lt: params.endsAt },
            endsAt: { gt: params.startsAt },
            NOT: params.groupId
              ? { groupId: params.groupId, workDate: params.workDate }
              : { productionOrderId: params.productionOrderId, workDate: params.workDate },
          },
          select: { startsAt: true, endsAt: true },
        });
        if (clash) {
          const t = (d: Date | null) => d?.toISOString().slice(0, 16).replace('T', ' ') ?? '';
          throw new BadRequestException(`This shift overlaps another one already booked for the same person, ${t(clash.startsAt)} to ${t(clash.endsAt)} (UTC).`);
        }
      }
      const data = {
        hours: new Prisma.Decimal(hours!.toFixed(2)),
        startsAt: params.startsAt ?? null,
        endsAt: params.endsAt ?? null,
        notes: params.notes ?? null,
      };
      // A correction is new, unapproved information: it goes back for approval.
      const reset = { status: 'PENDING', approvedById: null, approvedAt: null, selfApproved: false };
      const existing = await tx.timesheetEntry.findFirst({
        where: {
          companyId: params.companyId,
          employeeId: params.employeeId,
          workDate: params.workDate,
          ...(params.groupId ? { groupId: params.groupId } : { productionOrderId: params.productionOrderId }),
        },
        select: { id: true },
      });
      if (existing) return tx.timesheetEntry.update({ where: { id: existing.id }, data: { ...data, ...reset } });
      return tx.timesheetEntry.create({
        data: {
          companyId: params.companyId,
          employeeId: params.employeeId,
          groupId: params.groupId ?? null,
          productionOrderId: params.productionOrderId ?? null,
          workDate: params.workDate,
          ...data,
          createdById: params.actor.userId,
        },
      });
    });
  }

  /** INT-013: time only on a batch still alive that day, or an order still open. */
  private async assertOpenTarget(client: Prisma.TransactionClient | PrismaService, companyId: string, groupId: string | null, productionOrderId: string | null, workDate: Date) {
    if (groupId) {
      const group = await client.livestockGroup.findFirst({ where: { id: groupId, companyId }, select: { code: true, status: true, closedOn: true } });
      if (!group) throw new NotFoundException('No such batch in this company.');
      if (group.closedOn && workDate > group.closedOn) {
        throw new BadRequestException(`${group.code} closed on ${group.closedOn.toISOString().slice(0, 10)}; no time can be booked to it after that.`);
      }
      return;
    }
    const order = await client.productionOrder.findFirst({
      where: { id: productionOrderId!, companyId },
      select: { orderNumber: true, status: true, completedAt: true, createdAt: true },
    });
    if (!order) throw new NotFoundException('No such processing order in this company.');
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new BadRequestException(`${order.orderNumber} is ${order.status.toLowerCase()}; time cannot be booked to a closed order.`);
    }
    const created = new Date(Date.UTC(order.createdAt.getUTCFullYear(), order.createdAt.getUTCMonth(), order.createdAt.getUTCDate()));
    if (workDate < created) {
      throw new BadRequestException(`${order.orderNumber} was raised on ${created.toISOString().slice(0, 10)}; time cannot be booked to it before then.`);
    }
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
      // Self-approval is a company setting, off by default (Company.allowSelfApproval).
      const company = await this.prisma.company.findUnique({
        where: { id: params.companyId },
        select: { allowSelfApproval: true },
      });
      alone = others === 0 && company?.allowSelfApproval === true;
      if (!alone) {
        throw new BadRequestException(
          `You logged ${own.length === 1 ? 'one of these entries' : `${own.length} of these entries`} yourself, so someone else approves ${own.length === 1 ? 'it' : 'them'}.`,
        );
      }
    }
    // Time on an order closed since it was logged no longer counts (INT-013).
    for (const entry of entries) {
      await this.assertOpenTarget(this.prisma, params.companyId, entry.groupId, entry.productionOrderId, entry.workDate);
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
      // Batches only: time on processing orders is conversion, not farm labour.
      where: { companyId, workDate: { gte: from, lte: to }, status: 'APPROVED', groupId: { not: null } },
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
      const row = result.get(e.groupId!) ?? { hours: new Decimal(0), weight: new Decimal(0) };
      row.hours = row.hours.plus(hours);
      row.weight = row.weight.plus(hours.mul(rate(e.employeeId)));
      result.set(e.groupId!, row);
    }
    return result;
  }
}
