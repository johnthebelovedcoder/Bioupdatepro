import Decimal from 'decimal.js';
import type { Prisma, PrismaClient } from '@bioassetpro/database';

type Client = Prisma.TransactionClient | PrismaClient;

/** The Nigerian Labour Act minimums a company starts with (Cap L1). */
export const STATUTORY_LEAVE = {
  annualDays: 6, // s.18(1): at least six working days after 12 months' continuous service
  annualServiceMonths: 12,
  carryOverYears: 1, // s.18(2): deferrable, but the earning period no longer than 24 months
  sickDays: 12, // s.16: up to 12 working days a year, with a medical certificate
  maternityWeeks: 12, // s.54: six weeks before and six after confinement
  maternityPayPercent: 50, // s.54: not less than 50% of wages
  maternityServiceMonths: 6, // s.54: after six months' continuous service
} as const;

export type LeavePolicyValues = { -readonly [K in keyof typeof STATUTORY_LEAVE]: number };

export const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Monday to Friday, inclusive of both ends. Public holidays are not known here. */
export function workingDaysBetween(start: Date, end: Date): number {
  let count = 0;
  for (let d = dayOf(start); d <= dayOf(end); d = new Date(d.getTime() + 86_400_000)) {
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

/** Whole months from one date to another. */
export function monthsBetween(from: Date, to: Date): number {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}

/** The anniversary of a date in a given year (29 February falls back to the 28th). */
function anniversary(from: Date, year: number): Date {
  const month = from.getUTCMonth();
  const day = Math.min(from.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day));
}

export interface AnnualYear {
  year: number;
  /** Days carried in from earlier years. */
  opening: number;
  earned: number;
  /** When this year's days were earned — the service anniversary. */
  earnedOn: Date | null;
  taken: number;
  /** Unused days that expire at the end of this year. */
  lapsing: number;
  closing: number;
}

/**
 * Annual leave rolled forward year by year (AC-HR-003): each year earns the
 * policy's days on the service anniversary once enough service is complete;
 * days taken use the oldest first; days older than the carry-over allows
 * lapse at the end of a year.
 */
export function annualLedger(
  employmentDate: Date,
  policy: LeavePolicyValues,
  taken: Array<{ startDate: Date; workingDays: number }>,
  throughYear: number,
): AnnualYear[] {
  const years: AnnualYear[] = [];
  let pools: Array<{ fromYear: number; remaining: number }> = [];
  for (let year = employmentDate.getUTCFullYear(); year <= throughYear; year += 1) {
    pools = pools.filter((p) => year - p.fromYear <= policy.carryOverYears);
    const opening = pools.reduce((s, p) => s + p.remaining, 0);
    const on = anniversary(employmentDate, year);
    const qualifies = year > employmentDate.getUTCFullYear() && monthsBetween(employmentDate, on) >= policy.annualServiceMonths;
    const earned = qualifies ? policy.annualDays : 0;
    if (earned > 0) pools.push({ fromYear: year, remaining: earned });
    let used = 0;
    for (const t of taken.filter((x) => x.startDate.getUTCFullYear() === year)) {
      let need = t.workingDays;
      used += need;
      for (const pool of pools) {
        const take = Math.min(pool.remaining, need);
        pool.remaining -= take;
        need -= take;
        if (need === 0) break;
      }
    }
    const lapsing = pools.filter((p) => year + 1 - p.fromYear > policy.carryOverYears).reduce((s, p) => s + p.remaining, 0);
    const closing = pools.reduce((s, p) => s + p.remaining, 0);
    years.push({ year, opening, earned, earnedOn: qualifies ? on : null, taken: used, lapsing, closing });
  }
  return years;
}

/**
 * Pay not earned in a month because of approved leave paid below 100%
 * (unpaid leave, and the unpaid share of maternity leave): the share of the
 * month's working days it covers. Payroll takes this share off gross.
 */
export async function leavePayReduction(client: Client, companyId: string, employeeId: string, year: number, month: number) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0));
  const requests = await client.leaveRequest.findMany({
    where: { companyId, employeeId, status: 'APPROVED', payPercent: { lt: 100 }, startDate: { lte: monthEnd }, endDate: { gte: monthStart } },
    select: { id: true, type: true, startDate: true, endDate: true, payPercent: true },
  });
  const workingDays = workingDaysBetween(monthStart, monthEnd);
  let unpaidDays = new Decimal(0);
  const detail = requests.map((r) => {
    const from = r.startDate > monthStart ? r.startDate : monthStart;
    const to = r.endDate < monthEnd ? r.endDate : monthEnd;
    const days = workingDaysBetween(from, to);
    const unpaid = new Decimal(days).mul(100 - r.payPercent).div(100);
    unpaidDays = unpaidDays.plus(unpaid);
    return { id: r.id, type: r.type, days, payPercent: r.payPercent, unpaidDays: unpaid.toString() };
  });
  const fraction = workingDays === 0 ? new Decimal(0) : Decimal.min(unpaidDays.div(workingDays), 1);
  return { workingDays, unpaidDays: unpaidDays.toString(), fraction, requests: detail };
}
