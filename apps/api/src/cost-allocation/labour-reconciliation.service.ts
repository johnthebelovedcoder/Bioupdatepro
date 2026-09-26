import { NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AccountType, JournalStatus } from '@bioassetpro/database';
import type { PrismaService } from '../prisma/prisma.service';

export interface LabourReconciliation {
  period: { id: string; name: string; startDate: string; endDate: string };
  runs: Array<{ reference: string; status: string }>;
  employees: Array<{
    employeeId: string;
    number: string;
    name: string;
    onPostedRun: boolean;
    grossKobo: string;
    employerCostKobo: string;
    approvedHours: string;
    pendingHours: string;
    batchHours: string;
    orderHours: string;
    issue: string | null;
  }>;
  totals: {
    registerCostKobo: string;
    ledgerCostKobo: string;
    allocatedKobo: string;
    unallocatedKobo: string;
    approvedHours: string;
    pendingHours: string;
    hoursAllocated: string | null;
    approvedBatchHours: string;
  };
  checks: {
    /** The payroll register's cost less what payroll posted to expense; zero when they agree. */
    registerVsLedgerKobo: string;
    /** Labour allocated to cost objects never exceeds what payroll posted. */
    allocatedWithinLedger: boolean;
    /** Hours still waiting for approval in the period. */
    pendingHours: string;
    /** People with approved hours but not on a posted payroll run for the period. */
    hoursWithoutPay: number;
    /** On an hours-basis allocation, hours allocated less approved batch hours; null when none was hours-based. */
    hoursAllocatedVsApproved: string | null;
  };
  reconciled: boolean;
}

/**
 * Approved hours reconciled to payroll and to cost-object allocation
 * (AC-HR-002, CLOSE-07 "register = GL"). For a period: the posted payroll
 * register against what payroll posted to expense; the labour allocated to
 * batches against that expense, with what is left unallocated (admin staff,
 * say); and each person's approved and pending hours against whether they
 * were paid. The period cannot close until it reconciles.
 */
export class LabourReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async reconcile(companyId: string, financialPeriodId: string): Promise<LabourReconciliation> {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: financialPeriodId, financialYear: { companyId } },
      select: { id: true, name: true, startDate: true, endDate: true },
    });
    if (!period) throw new NotFoundException('No such period in this company.');

    const [runs, entries, payrollJournalLines, allocations] = await Promise.all([
      this.prisma.payrollRun.findMany({
        where: { companyId, financialPeriodId: period.id },
        select: { id: true, reference: true, status: true, lines: { select: { employeeId: true, monthlyGrossKobo: true, employerPensionKobo: true, nsitfKobo: true, itfKobo: true } } },
      }),
      this.prisma.timesheetEntry.findMany({
        where: { companyId, workDate: { gte: period.startDate, lte: period.endDate } },
        select: { employeeId: true, hours: true, status: true, groupId: true, productionOrderId: true },
      }),
      this.prisma.journalLine.findMany({
        where: {
          companyId,
          financialPeriodId: period.id,
          journalEntry: { status: JournalStatus.POSTED, sourceDocumentType: 'PayrollRun' },
          glAccount: { accountType: AccountType.EXPENSE },
        },
        select: { glAccountId: true, debitKobo: true, creditKobo: true },
      }),
      this.prisma.farmCostAllocation.findMany({
        where: { companyId, financialPeriodId: period.id },
        select: { basis: true, sources: { select: { glAccountId: true, amountKobo: true } }, lines: { select: { hours: true } } },
      }),
    ]);

    const posted = runs.filter((r) => r.status === 'POSTED');
    const pay = new Map<string, { gross: bigint; employer: bigint }>();
    for (const run of posted) {
      for (const line of run.lines) {
        const row = pay.get(line.employeeId) ?? { gross: 0n, employer: 0n };
        row.gross += line.monthlyGrossKobo;
        row.employer += line.employerPensionKobo + line.nsitfKobo + line.itfKobo;
        pay.set(line.employeeId, row);
      }
    }
    const registerCost = [...pay.values()].reduce((s, p) => s + p.gross + p.employer, 0n);
    const payrollAccounts = new Set(payrollJournalLines.map((l) => l.glAccountId));
    const ledgerCost = payrollJournalLines.reduce((s, l) => s + l.debitKobo - l.creditKobo, 0n);
    const allocated = allocations.flatMap((a) => a.sources).filter((s) => payrollAccounts.has(s.glAccountId)).reduce((s, x) => s + x.amountKobo, 0n);
    const hoursBased = allocations.filter((a) => a.basis === 'HOURS');
    const hoursAllocated = hoursBased.length
      ? hoursBased.flatMap((a) => a.lines).reduce((s, l) => s.plus(l.hours?.toString() ?? '0'), new Decimal(0))
      : null;

    const byPerson = new Map<string, { approved: Decimal; pending: Decimal; batch: Decimal; order: Decimal }>();
    for (const e of entries) {
      const row = byPerson.get(e.employeeId) ?? { approved: new Decimal(0), pending: new Decimal(0), batch: new Decimal(0), order: new Decimal(0) };
      const h = new Decimal(e.hours.toString());
      if (e.status === 'APPROVED') {
        row.approved = row.approved.plus(h);
        if (e.groupId) row.batch = row.batch.plus(h);
        else row.order = row.order.plus(h);
      } else row.pending = row.pending.plus(h);
      byPerson.set(e.employeeId, row);
    }
    const ids = [...new Set([...pay.keys(), ...byPerson.keys()])];
    const people = await this.prisma.employee.findMany({
      where: { companyId, id: { in: ids } },
      select: { id: true, employeeNumber: true, firstName: true, surname: true },
    });

    let pendingTotal = new Decimal(0);
    let approvedTotal = new Decimal(0);
    let batchTotal = new Decimal(0);
    let hoursWithoutPay = 0;
    const employees = ids
      .map((id) => {
        const person = people.find((p) => p.id === id);
        const p = pay.get(id);
        const h = byPerson.get(id) ?? { approved: new Decimal(0), pending: new Decimal(0), batch: new Decimal(0), order: new Decimal(0) };
        pendingTotal = pendingTotal.plus(h.pending);
        approvedTotal = approvedTotal.plus(h.approved);
        batchTotal = batchTotal.plus(h.batch);
        let issue: string | null = null;
        if (h.approved.gt(0) && !p) {
          issue = 'Approved hours, but not on a posted payroll run for the period.';
          hoursWithoutPay += 1;
        } else if (h.pending.gt(0)) issue = 'Hours waiting for approval.';
        return {
          employeeId: id,
          number: person?.employeeNumber ?? '',
          name: person ? `${person.firstName} ${person.surname}`.trim() : '—',
          onPostedRun: !!p,
          grossKobo: (p?.gross ?? 0n).toString(),
          employerCostKobo: (p?.employer ?? 0n).toString(),
          approvedHours: h.approved.toFixed(2),
          pendingHours: h.pending.toFixed(2),
          batchHours: h.batch.toFixed(2),
          orderHours: h.order.toFixed(2),
          issue,
        };
      })
      .sort((a, b) => a.number.localeCompare(b.number));

    const registerVsLedger = posted.length ? registerCost - ledgerCost : 0n;
    const hoursVsApproved = hoursAllocated ? hoursAllocated.minus(batchTotal) : null;
    const checks = {
      registerVsLedgerKobo: registerVsLedger.toString(),
      allocatedWithinLedger: allocated <= ledgerCost || allocated === 0n,
      pendingHours: pendingTotal.toFixed(2),
      hoursWithoutPay,
      hoursAllocatedVsApproved: hoursVsApproved ? hoursVsApproved.toFixed(2) : null,
    };
    return {
      period: { id: period.id, name: period.name, startDate: period.startDate.toISOString().slice(0, 10), endDate: period.endDate.toISOString().slice(0, 10) },
      runs: runs.map((r) => ({ reference: r.reference, status: r.status })),
      employees,
      totals: {
        registerCostKobo: registerCost.toString(),
        ledgerCostKobo: ledgerCost.toString(),
        allocatedKobo: allocated.toString(),
        unallocatedKobo: (ledgerCost - allocated).toString(),
        approvedHours: approvedTotal.toFixed(2),
        pendingHours: pendingTotal.toFixed(2),
        hoursAllocated: hoursAllocated ? hoursAllocated.toFixed(2) : null,
        approvedBatchHours: batchTotal.toFixed(2),
      },
      checks,
      reconciled:
        registerVsLedger === 0n &&
        checks.allocatedWithinLedger &&
        pendingTotal.isZero() &&
        hoursWithoutPay === 0 &&
        (!hoursVsApproved || hoursVsApproved.abs().lte('0.01')),
    };
  }
}
