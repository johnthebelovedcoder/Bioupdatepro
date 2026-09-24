import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AccountType, AuditAction, JournalStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../posting/posting.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Farm labour and overhead charged to the populations that used it —
 * PCR-028 (payroll to cost object), PCR-043 (snailery labour/facility) and
 * PCR-064 (flock labour/overhead).
 *
 * The farm's chosen driver (2026-09-24) is ANIMAL-DAYS: each population's
 * share of a month's cost is the animals it carried × the days it carried
 * them, over the same for every population alive that month. Nobody has to
 * log hours, and a house of 5,000 birds takes more than a house of 500.
 *
 * Where each share lands, also the farm's choice:
 *   poultry  Work in Progress (1501) — capitalised like feed, and relieved at
 *            weighted average by RearingCostService when birds die, are sold
 *            or harvested. PCR-064-DR "130210/613000 per policy".
 *   snails   Snailery Labour and Facility Expense (612000) — PCR-043-DR, the
 *            workbook's own single account, dimensioned by cohort.
 *
 * The sources are whatever expense accounts the month actually carries —
 * salaries the payroll run posted (PCR-028), overheads from supplier
 * invoices, depreciation — each credited back by the amount allocated. The
 * payroll run has already credited Payroll Payable (PCR-028-CR, 220100) when
 * it accrued, so crediting it again here would double the liability; the
 * allocation moves cost, it never creates it.
 *
 * What is still available on an account is its NET movement in the period,
 * so an earlier allocation (a credit) or its reversal (a debit) is already
 * counted without keeping a second ledger of what was allocated.
 */

const POULTRY_TARGET = '1501';
const SNAIL_TARGET = '612000';
const SPECIES = ['poultry', 'snail'] as const;

export interface AllocationSourceInput {
  glAccountId: string;
  costCentreId?: string | null;
  amountKobo: bigint;
}

export interface PopulationShare {
  groupId: string;
  code: string;
  speciesKey: string;
  animalDays: Decimal;
  amountKobo: bigint;
}

@Injectable()
export class FarmCostAllocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly audit: AuditService,
  ) {}

  /** Expense accounts with cost in the period that can be allocated, and how much of each. */
  async sources(companyId: string, financialPeriodId: string) {
    const period = await this.period(companyId, financialPeriodId);
    const targets = await this.targetAccounts(companyId, false);
    const rows = await this.prisma.journalLine.groupBy({
      by: ['glAccountId', 'costCentreId'],
      where: {
        companyId,
        financialPeriodId: period.id,
        journalEntry: { status: JournalStatus.POSTED },
        glAccount: { accountType: AccountType.EXPENSE },
        ...(targets.snail ? { glAccountId: { not: targets.snail } } : {}),
      },
      _sum: { debitKobo: true, creditKobo: true },
    });

    const accounts = await this.prisma.gLAccount.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.glAccountId))] } },
      select: { id: true, accountNumber: true, name: true },
    });
    const centres = await this.prisma.costCentre.findMany({
      where: { id: { in: rows.map((r) => r.costCentreId).filter((id): id is string => !!id) } },
      select: { id: true, code: true, name: true },
    });
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const centreById = new Map(centres.map((c) => [c.id, c]));

    return rows
      .map((row) => {
        const available = (row._sum.debitKobo ?? 0n) - (row._sum.creditKobo ?? 0n);
        const account = accountById.get(row.glAccountId)!;
        const centre = row.costCentreId ? centreById.get(row.costCentreId) : null;
        return {
          glAccountId: row.glAccountId,
          accountNumber: account.accountNumber,
          accountName: account.name,
          costCentreId: row.costCentreId,
          costCentre: centre ? `${centre.code} — ${centre.name}` : null,
          availableKobo: available,
        };
      })
      .filter((row) => row.availableKobo > 0n)
      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber) || (a.costCentre ?? '').localeCompare(b.costCentre ?? ''));
  }

  /**
   * Each live population's animal-days in the period, and its share of
   * `totalKobo`. Shares are whole kobo by largest remainder, so they always
   * add up to the total exactly.
   */
  async preview(companyId: string, financialPeriodId: string, totalKobo: bigint): Promise<PopulationShare[]> {
    const period = await this.period(companyId, financialPeriodId);
    const days = await this.animalDays(companyId, period.startDate, period.endDate);
    return split(days, totalKobo);
  }

  /** Post an allocation: Dr each population's share / Cr each source. */
  async post(params: {
    companyId: string;
    financialPeriodId: string;
    sources: AllocationSourceInput[];
    actor: WorkflowActor;
  }) {
    const period = await this.period(params.companyId, params.financialPeriodId);
    if (period.status !== 'OPEN') {
      throw new AccountingRuleViolation('§9 — Financial period', `${period.name} is not open.`, { periodId: period.id });
    }

    const sources = params.sources.filter((s) => s.amountKobo > 0n);
    if (sources.length === 0) throw new BadRequestException('Choose at least one amount to allocate.');

    // Never more than the account carries in the month — allocating cost that
    // is not there would put a credit balance on an expense account.
    const available = await this.sources(params.companyId, period.id);
    for (const source of sources) {
      const row = available.find(
        (a) => a.glAccountId === source.glAccountId && (a.costCentreId ?? null) === (source.costCentreId ?? null),
      );
      if (!row || source.amountKobo > row.availableKobo) {
        throw new AccountingRuleViolation(
          'PCR-043/064 — Source pool and driver reconcile',
          `Only ${row ? formatNaira(row.availableKobo) : '₦0.00'} is left to allocate on that account in ${period.name}.`,
          { glAccountId: source.glAccountId, costCentreId: source.costCentreId ?? null },
        );
      }
    }

    const total = sources.reduce((sum, s) => sum + s.amountKobo, 0n);
    const shares = (await this.preview(params.companyId, period.id, total)).filter((s) => s.amountKobo > 0n);
    if (shares.length === 0) {
      throw new AccountingRuleViolation(
        'PCR-043/064 — Active cost object required',
        `No poultry or snail population was alive on the farm in ${period.name}, so there is nothing to charge the cost to.`,
        { periodId: period.id },
      );
    }

    const targets = await this.targetAccounts(params.companyId, true);
    const [company, groups, costCentre, count] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { baseCurrencyId: true } }),
      this.prisma.livestockGroup.findMany({
        where: { id: { in: shares.map((s) => s.groupId) } },
        select: { id: true, code: true, branchId: true, farmId: true, penHouseId: true },
      }),
      this.prisma.costCentre.findFirst({ where: { companyId: params.companyId, active: true }, orderBy: { code: 'asc' } }),
      this.prisma.farmCostAllocation.count({ where: { companyId: params.companyId, financialPeriodId: period.id } }),
    ]);
    const groupById = new Map(groups.map((g) => [g.id, g]));
    const branchId = groups[0]!.branchId;
    const reference = `ALLOC-${period.startDate.toISOString().slice(0, 7)}-${count + 1}`;

    const header = {
      companyId: params.companyId,
      branchId,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      currencyId: company.baseCurrencyId,
      exchangeRate: '1',
    };

    const debitLines = shares.map((share) => {
      const group = groupById.get(share.groupId)!;
      const glAccountId = share.speciesKey === 'poultry' ? targets.poultry! : targets.snail!;
      return {
        share,
        line: {
          glAccountId,
          description: `${share.speciesKey === 'poultry' ? 'PCR-064' : 'PCR-043'} — farm labour/overhead to ${group.code} (${share.animalDays.toFixed(0)} animal-days)`,
          debit: kobo(share.amountKobo),
          dimensions: {
            ...header,
            branchId: group.branchId,
            costCentreId: costCentre?.id ?? null,
            farmId: group.farmId,
            penHouseId: group.penHouseId,
          },
        },
      };
    });
    const creditLines = sources.map((source) => ({
      glAccountId: source.glAccountId,
      description: `PCR-028 — allocated to farm populations by animal-days (${reference})`,
      credit: kobo(source.amountKobo),
      dimensions: { ...header, costCentreId: source.costCentreId ?? null },
    }));

    const allocationId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const journal = await this.posting.post(
        {
          sourceModule: 'cost-allocation',
          sourceDocumentType: 'FarmCostAllocation',
          sourceDocumentId: allocationId,
          journalNumber: reference,
          journalDate: period.endDate,
          narration: `Farm labour and overhead by animal-days — ${period.name}`,
          ...header,
          idempotencyKey: `farm-cost-allocation:${params.companyId}:${reference}`,
          actor: params.actor,
          lines: [...debitLines.map((d) => d.line), ...creditLines],
        },
        tx,
      );

      const allocation = await tx.farmCostAllocation.create({
        data: {
          id: allocationId,
          companyId: params.companyId,
          financialPeriodId: period.id,
          reference,
          totalKobo: total,
          journalEntryId: journal.journalEntryId,
          createdById: params.actor.userId,
          sources: {
            create: sources.map((s) => ({ glAccountId: s.glAccountId, costCentreId: s.costCentreId ?? null, amountKobo: s.amountKobo })),
          },
          lines: {
            create: debitLines.map(({ share, line }) => ({
              groupId: share.groupId,
              speciesKey: share.speciesKey,
              animalDays: share.animalDays.toFixed(6),
              glAccountId: line.glAccountId,
              amountKobo: share.amountKobo,
            })),
          },
        },
      });

      await this.audit.write(
        {
          transactionId: allocation.id,
          module: 'cost-allocation',
          entityType: 'FarmCostAllocation',
          entityId: allocation.id,
          status: 'POSTED',
          action: AuditAction.POST,
          userId: params.actor.userId,
          newValue: { reference, totalKobo: total.toString(), populations: shares.length, journal: journal.journalNumber },
        },
        tx,
      );

      return { id: allocation.id, reference, journalNumber: journal.journalNumber, totalKobo: total, populations: shares.length };
    });
  }

  async list(companyId: string) {
    const rows = await this.prisma.farmCostAllocation.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        journalEntry: { select: { journalNumber: true, reversedBy: { select: { journalNumber: true } } } },
        lines: { select: { groupId: true, speciesKey: true, animalDays: true, amountKobo: true } },
      },
    });
    const groups = await this.prisma.livestockGroup.findMany({
      where: { id: { in: rows.flatMap((r) => r.lines.map((l) => l.groupId)) } },
      select: { id: true, code: true },
    });
    const periods = await this.prisma.financialPeriod.findMany({
      where: { id: { in: rows.map((r) => r.financialPeriodId) } },
      select: { id: true, name: true },
    });
    const code = new Map(groups.map((g) => [g.id, g.code]));
    const periodName = new Map(periods.map((p) => [p.id, p.name]));
    return rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      period: periodName.get(row.financialPeriodId) ?? '',
      totalKobo: row.totalKobo,
      createdAt: row.createdAt,
      journalNumber: row.journalEntry?.journalNumber ?? null,
      reversedBy: row.journalEntry?.reversedBy?.journalNumber ?? null,
      lines: row.lines.map((l) => ({
        group: code.get(l.groupId) ?? l.groupId,
        speciesKey: l.speciesKey,
        animalDays: l.animalDays.toString(),
        amountKobo: l.amountKobo,
      })),
    }));
  }

  /**
   * Animals × days for every poultry and snail population alive in the range,
   * counting only days up to today — a month still running has not carried
   * its later days yet.
   *
   * There is no stored daily population, so each day's count is rebuilt
   * backwards from today's: every recorded death, harvest, live sale or
   * transfer after that day is added back (or taken off, for animals that
   * arrived). A live sale recorded before 2026-09-24 left no dated record of
   * its count, so a month before that can understate a population that sold
   * animals later — never the other way round.
   */
  async animalDays(companyId: string, from: Date, to: Date): Promise<Array<{ groupId: string; code: string; speciesKey: string; animalDays: Decimal }>> {
    const today = utcDay(new Date());
    const end = to < today ? utcDay(to) : today;
    const start = utcDay(from);
    if (end < start) return [];

    const groups = await this.prisma.livestockGroup.findMany({
      where: {
        companyId,
        speciesKey: { in: [...SPECIES] },
        startedOn: { lte: end },
        OR: [{ closedOn: null }, { closedOn: { gte: start } }],
      },
      select: { id: true, code: true, speciesKey: true, population: true, startedOn: true, closedOn: true },
    });
    if (groups.length === 0) return [];
    const ids = groups.map((g) => g.id);

    const [deaths, harvests, arrivals, sales] = await Promise.all([
      this.prisma.mortalityRecord.findMany({
        where: { dailyRecord: { groupId: { in: ids }, recordedOn: { gt: start } } },
        select: { quantity: true, dailyRecord: { select: { groupId: true, recordedOn: true } } },
      }),
      this.prisma.harvestRecord.findMany({
        where: { groupId: { in: ids }, harvestedOn: { gt: start } },
        select: { groupId: true, harvestedOn: true, count: true },
      }),
      this.prisma.harvestRecord.findMany({
        where: { movedToGroupId: { in: ids }, harvestedOn: { gt: start } },
        select: { movedToGroupId: true, harvestedOn: true, count: true },
      }),
      this.prisma.livestockRearingRelief.findMany({
        where: { groupId: { in: ids }, eventType: 'DISPOSAL', occurredOn: { gt: start } },
        select: { groupId: true, occurredOn: true, count: true },
      }),
    ]);

    // Change in population ON each day, per group: negative for animals out.
    const changes = new Map<string, Array<{ on: Date; delta: number }>>();
    const add = (groupId: string, on: Date, delta: number) => {
      const list = changes.get(groupId) ?? [];
      list.push({ on: utcDay(on), delta });
      changes.set(groupId, list);
    };
    for (const d of deaths) add(d.dailyRecord.groupId, d.dailyRecord.recordedOn, -d.quantity);
    for (const h of harvests) add(h.groupId, h.harvestedOn, -h.count);
    for (const a of arrivals) add(a.movedToGroupId!, a.harvestedOn, a.count);
    for (const s of sales) add(s.groupId, s.occurredOn, -s.count);

    return groups.map((group) => {
      const events = changes.get(group.id) ?? [];
      const first = maxDay(start, utcDay(group.startedOn));
      const last = group.closedOn ? minDay(end, utcDay(group.closedOn)) : end;
      let total = 0;
      for (let day = first; day <= last; day = nextDay(day)) {
        // Population at the end of `day` = today's, plus everything that left
        // after it, less everything that arrived after it.
        const after = events.filter((e) => e.on > day).reduce((sum, e) => sum + e.delta, 0);
        total += Math.max(0, group.population - after);
      }
      return { groupId: group.id, code: group.code, speciesKey: group.speciesKey, animalDays: new Decimal(total) };
    });
  }

  private async period(companyId: string, financialPeriodId: string) {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: financialPeriodId, financialYear: { companyId } },
    });
    if (!period) throw new NotFoundException('No such period in this company.');
    return period;
  }

  private async targetAccounts(companyId: string, required: boolean) {
    const rows = await this.prisma.gLAccount.findMany({
      where: { companyId, accountNumber: { in: [POULTRY_TARGET, SNAIL_TARGET] }, active: true },
      select: { id: true, accountNumber: true },
    });
    const poultry = rows.find((r) => r.accountNumber === POULTRY_TARGET)?.id;
    const snail = rows.find((r) => r.accountNumber === SNAIL_TARGET)?.id;
    if (required && (!poultry || !snail)) {
      throw new AccountingRuleViolation(
        'PCR-043/064 — Posting keys',
        `Allocating farm cost needs Work in Progress (${POULTRY_TARGET}) and Snailery Labour and Facility Expense (${SNAIL_TARGET}). Load the posting rules on Controls first.`,
        {},
      );
    }
    return { poultry, snail };
  }
}

/** Largest-remainder split of `total` by animal-days, in whole kobo. */
export function split(
  rows: Array<{ groupId: string; code: string; speciesKey: string; animalDays: Decimal }>,
  total: bigint,
): PopulationShare[] {
  const weight = rows.reduce((sum, r) => sum.plus(r.animalDays), new Decimal(0));
  if (weight.isZero()) return rows.map((r) => ({ ...r, amountKobo: 0n }));

  const exact = rows.map((r) => new Decimal(total.toString()).mul(r.animalDays).div(weight));
  const floors = exact.map((e) => BigInt(e.floor().toFixed(0)));
  let left = total - floors.reduce((s, f) => s + f, 0n);
  const order = exact
    .map((e, i) => ({ i, frac: e.minus(e.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0n) break;
    floors[i] = floors[i]! + 1n;
    left -= 1n;
  }
  return rows.map((r, i) => ({ ...r, amountKobo: floors[i]! }));
}

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function nextDay(date: Date): Date {
  return new Date(date.getTime() + 86_400_000);
}
function maxDay(a: Date, b: Date): Date {
  return a > b ? a : b;
}
function minDay(a: Date, b: Date): Date {
  return a < b ? a : b;
}
function formatNaira(k: bigint): string {
  const negative = k < 0n;
  const abs = negative ? -k : k;
  const naira = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}₦${naira}.${(abs % 100n).toString().padStart(2, '0')}`;
}
