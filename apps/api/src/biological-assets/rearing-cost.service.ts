import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { chartVersionOf, rearingNumbersFor, speciesNumberFor, type ChartVersion } from '../chart/chart';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../posting/posting.service';
import { kobo } from '../common/money';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * A population's rearing cost, relieved at weighted average.
 *
 * Feed and treatments post Dr Work in Progress (1501) the day they go into a
 * population (`OperationsPostingService`), and that side was always built.
 * The other side was deliberately left open until the farm chose a costing
 * policy — and until it did, the feed eaten by animals that died, were sold
 * or were harvested stayed in WIP for ever, overstating the balance sheet and
 * understating every loss and every cost of sale.
 *
 * The policy chosen (2026-09-24) is weighted average over the live
 * population: every event that removes animals takes
 *
 *     remaining rearing cost × animals removed ÷ animals there before
 *
 * and the last animals out take whatever is left, so a finished population's
 * WIP clears to exactly zero rather than to a rounding residue.
 *
 * Only POSTED feed and treatments count. A feed issue still waiting for an
 * open period is not in WIP yet, and relieving it would take out of WIP what
 * was never put in.
 */
/*
 * Accounts are resolved on the company's own chart (chart.ts): on LEGACY the
 * four-digit Work in Progress (1501), Production Loss (5305) and Cost of Sales
 * (5001) as always; on SPEC, poultry rearing cost is held in Biological Assets
 * — Poultry (130210) and relieved to 640500 / 510300, while snail feed and
 * medication are expensed as used (611000), so a snail population holds none.
 */

export type ReliefEvent = 'MORTALITY' | 'DISPOSAL' | 'HARVEST';

/** Events that take cost out of a population. TRANSFER_IN adds it back. */
// REVALUED: absorbed into the flock's fair value by a valuation (client's chart only).
const OUTFLOWS = ['MORTALITY', 'DISPOSAL', 'HARVEST', 'TRANSFER_OUT', 'REVALUED'];

@Injectable()
export class RearingCostService {
  private readonly logger = new Logger(RearingCostService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  /** What is still sitting in WIP for this population, in kobo. */
  async remaining(groupId: string, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const byAccount = await this.remainingByAccount(groupId, client);
    let total = 0n;
    for (const amount of byAccount.values()) total += amount;
    return total > 0n ? total : 0n;
  }

  /**
   * The same balance by the account holding it. One account on LEGACY and SPEC
   * (the species' rearing account); on the approved chart poultry cost sits in
   * the immature or mature account it was posted to, so a relief can take its
   * share from each. Empty where the population holds none (snails on the
   * client's charts, whose feed and medication are expensed as used).
   */
  async remainingByAccount(
    groupId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Map<string, bigint>> {
    const owner = await client.livestockGroup.findUnique({ where: { id: groupId }, select: { companyId: true, speciesKey: true, rearingHomeAccount: true } });
    if (!owner) return new Map();
    const version = await chartVersionOf(client, owner.companyId);
    const accounts = rearingNumbersFor(version, owner.speciesKey);
    if (accounts.length === 0) return new Map();
    // Cost that carries no account was posted before the chart held it in
    // more than one; it sits in the cohort's home account — set by the balance
    // cutover from its stage that day — or, with none, the first (immature).
    const home = owner.rearingHomeAccount && accounts.includes(owner.rearingHomeAccount) ? owner.rearingHomeAccount : accounts[0]!;
    const balance = new Map<string, bigint>(accounts.map((a) => [a, 0n]));
    const add = (account: string | null | undefined, amount: bigint) =>
      balance.set(account && balance.has(account) ? account : home, (balance.get(account && balance.has(account) ? account : home) ?? 0n) + amount);

    // Posted and still standing: a reversed feed or treatment journal took its
    // cost back out of WIP, so it is no longer in the population either.
    const standing = { is: { reversedBy: { is: null } } };
    const [feed, treatments, reliefs, labour] = await Promise.all([
      client.feedIssue.groupBy({
        by: ['rearingAccountNumber'],
        where: { dailyRecord: { groupId }, journalEntry: standing },
        _sum: { valueKobo: true },
      }),
      client.treatmentRecord.groupBy({
        by: ['rearingAccountNumber'],
        where: { companyId: owner.companyId, groupId, journalEntry: standing },
        _sum: { costKobo: true },
      }),
      client.livestockRearingRelief.findMany({
        where: { companyId: owner.companyId, groupId },
        select: { eventType: true, amountKobo: true, splits: { select: { accountNumber: true, amountKobo: true } } },
      }),
      // A flock's share of farm labour and overhead (PCR-064), which the farm
      // capitalises into the same Work in Progress. Snail shares go to
      // expense (612000), so they were never in WIP.
      client.farmCostAllocationLine.findMany({
        where: { groupId, speciesKey: 'poultry', allocation: { journalEntry: standing } },
        select: { amountKobo: true, glAccountId: true },
      }),
    ]);

    for (const row of feed) add(row.rearingAccountNumber, row._sum.valueKobo ?? 0n);
    for (const row of treatments) add(row.rearingAccountNumber, row._sum.costKobo ?? 0n);
    const labourAccounts = new Map(
      (await client.gLAccount.findMany({
        where: { companyId: owner.companyId, id: { in: [...new Set(labour.map((l) => l.glAccountId))] } },
        select: { id: true, accountNumber: true },
      })).map((a) => [a.id, a.accountNumber]),
    );
    for (const line of labour) add(labourAccounts.get(line.glAccountId), line.amountKobo);
    for (const relief of reliefs) {
      const sign = relief.eventType === 'TRANSFER_IN' ? 1n : OUTFLOWS.includes(relief.eventType) ? -1n : 0n;
      if (sign === 0n) continue;
      if (relief.splits.length === 0) add(null, sign * relief.amountKobo);
      else for (const split of relief.splits) add(split.accountNumber, sign * split.amountKobo);
    }
    return balance;
  }

  /**
   * Take this event's weighted-average share out of the population.
   *
   * Idempotent on (population, event, source): calling it again for the same
   * death or sale line returns the relief already recorded, and only tries to
   * post it if it has not posted yet. Never throws for an accounting reason —
   * a relief that cannot post (closed period, no cost centre) is recorded and
   * left unposted, the same "visible, not lost" rule every other posting here
   * follows, and `postPending()` picks it up later.
   */
  async relieve(params: {
    companyId: string;
    groupId: string;
    event: ReliefEvent;
    sourceId: string;
    count: number;
    populationBefore: number;
    occurredOn: Date;
    actor: WorkflowActor;
  }): Promise<{ amountKobo: bigint; posted: boolean; reason?: string }> {
    if (params.count <= 0) return { amountKobo: 0n, posted: false };

    const existing = await this.prisma.livestockRearingRelief.findUnique({
      where: {
        groupId_eventType_sourceId: {
          groupId: params.groupId,
          eventType: params.event,
          sourceId: params.sourceId,
        },
      },
    });

    const relief =
      existing ??
      (await (async () => {
        const byAccount = await this.remainingByAccount(params.groupId);
        const remaining = positiveTotal(byAccount);
        const amountKobo = share(remaining, params.count, params.populationBefore);
        return this.prisma.livestockRearingRelief.create({
          data: {
            companyId: params.companyId,
            groupId: params.groupId,
            eventType: params.event,
            sourceId: params.sourceId,
            count: params.count,
            populationBefore: Math.max(params.populationBefore, params.count),
            amountKobo,
            occurredOn: params.occurredOn,
            splits: { create: this.splitsFor(amountKobo, byAccount) },
          },
        });
      })());

    // A harvest's share is posted by the processing order raised from it.
    if (params.event === 'HARVEST') return { amountKobo: relief.amountKobo, posted: false };
    if (relief.journalEntryId) return { amountKobo: relief.amountKobo, posted: true };

    const outcome = await this.post(relief.id, params.actor);
    return { amountKobo: relief.amountKobo, ...outcome };
  }

  /**
   * Animals moved into another population take their share with them. Same
   * account on both sides, so this is attribution only — no journal.
   */
  async transfer(params: {
    companyId: string;
    fromGroupId: string;
    toGroupId: string;
    sourceId: string;
    count: number;
    populationBefore: number;
    occurredOn: Date;
  }): Promise<bigint> {
    if (params.count <= 0 || params.fromGroupId === params.toGroupId) return 0n;

    return this.prisma.$transaction(async (tx) => {
      const already = await tx.livestockRearingRelief.findUnique({
        where: {
          groupId_eventType_sourceId: {
            groupId: params.fromGroupId,
            eventType: 'TRANSFER_OUT',
            sourceId: params.sourceId,
          },
        },
      });
      if (already) return already.amountKobo;

      const byAccount = await this.remainingByAccount(params.fromGroupId, tx);
      const remaining = positiveTotal(byAccount);
      const amountKobo = share(remaining, params.count, params.populationBefore);
      // The cost stays in the accounts it was posted to; the receiving
      // population simply holds the same split.
      const splits = this.splitsFor(amountKobo, byAccount);
      const common = {
        companyId: params.companyId,
        sourceId: params.sourceId,
        count: params.count,
        populationBefore: Math.max(params.populationBefore, params.count),
        amountKobo,
        occurredOn: params.occurredOn,
      };
      await tx.livestockRearingRelief.create({
        data: { ...common, groupId: params.fromGroupId, eventType: 'TRANSFER_OUT', splits: { create: splits } },
      });
      await tx.livestockRearingRelief.create({
        data: { ...common, groupId: params.toGroupId, eventType: 'TRANSFER_IN', splits: { create: splits } },
      });
      return amountKobo;
    });
  }

  /**
   * Split rows for a relief of `amountKobo`: its share of each account in
   * proportion to what that account holds. None where the chart holds the
   * cost in a single account — the relief is simply from that one.
   */
  private splitsFor(amountKobo: bigint, byAccount: Map<string, bigint>): Array<{ accountNumber: string; amountKobo: bigint }> {
    if (amountKobo <= 0n || byAccount.size <= 1) return [];
    return allocateAcross(amountKobo, byAccount).map(([accountNumber, amount]) => ({ accountNumber, amountKobo: amount }));
  }

  /** The accounts a harvest's share came from, for the processing order's issue journal. Empty on a one-account chart. */
  async harvestSplits(harvestRecordId: string, groupId: string): Promise<Array<{ accountNumber: string; amountKobo: bigint }>> {
    const relief = await this.prisma.livestockRearingRelief.findUnique({
      where: { groupId_eventType_sourceId: { groupId, eventType: 'HARVEST', sourceId: harvestRecordId } },
      select: { splits: { select: { accountNumber: true, amountKobo: true }, orderBy: { accountNumber: 'asc' } } },
    });
    return relief?.splits ?? [];
  }

  /** The share a harvest took, for the processing order raised from it. */
  async harvestShare(harvestRecordId: string, groupId: string): Promise<bigint> {
    const relief = await this.prisma.livestockRearingRelief.findUnique({
      where: {
        groupId_eventType_sourceId: { groupId, eventType: 'HARVEST', sourceId: harvestRecordId },
      },
    });
    return relief?.amountKobo ?? 0n;
  }

  /** Mark a harvest's share as posted, by the processing order's issue journal. */
  async markHarvestPosted(harvestRecordId: string, groupId: string, journalEntryId: string, tx: Prisma.TransactionClient) {
    await tx.livestockRearingRelief.updateMany({
      where: { groupId, eventType: 'HARVEST', sourceId: harvestRecordId, journalEntryId: null },
      data: { journalEntryId },
    });
  }

  /** Post every death and sale relief still waiting — the Controls backlog button. */
  async postPending(companyId: string, actor: WorkflowActor) {
    const pending = await this.prisma.livestockRearingRelief.findMany({
      where: { companyId, journalEntryId: null, eventType: { in: ['MORTALITY', 'DISPOSAL'] } },
      orderBy: { occurredOn: 'asc' },
      select: { id: true },
    });
    let posted = 0;
    let failed = 0;
    const reasons = new Set<string>();
    for (const row of pending) {
      const outcome = await this.post(row.id, actor);
      if (outcome.posted) posted += 1;
      else {
        failed += 1;
        if (outcome.reason) reasons.add(outcome.reason);
      }
    }
    return { posted, failed, reasons: [...reasons] };
  }

  /* ------------------------------------------------------------------ */

  /** Where a relief's credit lines come from: its split rows, or the species' one account. */
  private async reliefSources(
    reliefId: string,
    amountKobo: bigint,
    version: ChartVersion,
    species: string,
  ): Promise<Array<{ accountNumber: string; amountKobo: bigint }>> {
    const splits = await this.prisma.livestockRearingReliefSplit.findMany({
      where: { reliefId },
      select: { accountNumber: true, amountKobo: true },
      orderBy: { accountNumber: 'asc' },
    });
    if (splits.length > 0) return splits;
    const [only] = rearingNumbersFor(version, species);
    // More than one account and no split recorded cannot be posted without guessing which.
    return only && rearingNumbersFor(version, species).length === 1 ? [{ accountNumber: only, amountKobo }] : [];
  }

  private async post(reliefId: string, actor: WorkflowActor): Promise<{ posted: boolean; reason?: string }> {
    const relief = await this.prisma.livestockRearingRelief.findUniqueOrThrow({
      where: { id: reliefId },
      include: { group: true },
    });
    if (relief.journalEntryId) return { posted: true };
    if (relief.amountKobo <= 0n) {
      // Nothing had been absorbed yet — a population that died before its
      // first posted feed. Recorded, with nothing to post.
      return { posted: false };
    }

    const group = relief.group;
    const version: ChartVersion = await chartVersionOf(this.prisma, relief.companyId);
    const sources = await this.reliefSources(relief.id, relief.amountKobo, version, group.speciesKey);
    const debitNumber = speciesNumberFor(version, relief.eventType === 'MORTALITY' ? 'productionLoss' : 'liveCostOfSales', group.speciesKey)!;
    if (sources.length === 0) {
      // Held nowhere on this chart (snails on SPEC): expensed when incurred.
      return { posted: false, reason: 'This population\u2019s rearing cost is expensed as it is incurred, so there is nothing to relieve.' };
    }

    try {
      const [accounts, period, costCentre, company] = await Promise.all([
        this.prisma.gLAccount.findMany({
          where: {
            companyId: relief.companyId,
            accountNumber: { in: [...sources.map((l) => l.accountNumber), debitNumber] },
            active: true,
          },
          select: { id: true, accountNumber: true },
        }),
        this.prisma.financialPeriod.findFirst({
          where: {
            financialYear: { companyId: relief.companyId },
            startDate: { lte: relief.occurredOn },
            endDate: { gte: relief.occurredOn },
            status: 'OPEN',
          },
          select: { id: true, financialYearId: true },
        }),
        this.prisma.costCentre.findFirst({
          where: { companyId: relief.companyId, active: true, postingAllowed: true },
          orderBy: { code: 'asc' },
          select: { id: true },
        }),
        this.prisma.company.findUniqueOrThrow({ where: { id: relief.companyId } }),
      ]);

      const wipLines = sources.map((l) => ({ id: accounts.find((a) => a.accountNumber === l.accountNumber)?.id, ...l }));
      const debit = accounts.find((a) => a.accountNumber === debitNumber)?.id;
      if (!debit || wipLines.some((l) => !l.id)) {
        return { posted: false, reason: `No active ${[...sources.map((l) => l.accountNumber), debitNumber].join(' / ')} account.` };
      }
      if (!period) {
        return {
          posted: false,
          reason: `No open accounting period covers ${relief.occurredOn.toISOString().slice(0, 10)}.`,
        };
      }
      if (!costCentre) return { posted: false, reason: 'No cost centre is configured.' };

      const dimensions = {
        companyId: relief.companyId,
        branchId: group.branchId,
        financialYearId: period.financialYearId,
        financialPeriodId: period.id,
        currencyId: company.baseCurrencyId,
        exchangeRate: '1',
        costCentreId: costCentre.id,
        farmId: group.farmId,
        penHouseId: group.penHouseId,
      };
      const what =
        relief.eventType === 'MORTALITY'
          ? `Rearing cost of ${relief.count} dead`
          : `Rearing cost of ${relief.count} sold live`;

      const result = await this.posting.post({
        sourceModule: 'BIOLOGICAL_ASSETS',
        sourceDocumentType: 'REARING_COST_RELIEF',
        sourceDocumentId: relief.id,
        journalNumber: `RC-${relief.id.slice(0, 8).toUpperCase()}`,
        journalDate: relief.occurredOn,
        narration: `${what} — ${group.code} (weighted average)`,
        ...dimensions,
        lines: [
          { glAccountId: debit, description: `${what} — ${group.code}`, debit: kobo(relief.amountKobo), dimensions },
          ...wipLines.map((l) => ({
            glAccountId: l.id!,
            description: `Rearing cost out of WIP — ${group.code}`,
            credit: kobo(l.amountKobo),
            dimensions,
          })),
        ],
        idempotencyKey: `rearing-relief:${relief.id}`,
        actor,
      });

      await this.prisma.livestockRearingRelief.update({
        where: { id: relief.id },
        data: { journalEntryId: result.journalEntryId },
      });
      return { posted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Rearing relief ${relief.id} did not post: ${message}`);
      return { posted: false, reason: message };
    }
  }
}

/**
 * The weighted-average share, in whole kobo. Rounded down, so a population is
 * never relieved of more than it holds; the last animals out take the rest.
 */
export function positiveTotal(byAccount: Map<string, bigint>): bigint {
  let total = 0n;
  for (const amount of byAccount.values()) total += amount;
  return total > 0n ? total : 0n;
}

/**
 * Divides `amount` across accounts in proportion to what each holds, in whole
 * kobo that add up to exactly `amount` and never take more from an account
 * than it holds (largest remainder). An account holding nothing or less
 * takes none.
 */
export function allocateAcross(amount: bigint, balances: Map<string, bigint>): Array<[string, bigint]> {
  const held = [...balances].filter(([, b]) => b > 0n).sort(([a], [b]) => a.localeCompare(b));
  const total = held.reduce((sum, [, b]) => sum + b, 0n);
  if (amount <= 0n || total <= 0n) return [];
  const take = amount > total ? total : amount;
  const rows = held.map(([account, balance]) => {
    const numerator = take * balance;
    return { account, balance, floor: numerator / total, fraction: numerator % total };
  });
  let leftover = take - rows.reduce((sum, r) => sum + r.floor, 0n);
  for (const row of [...rows].sort((a, b) => (b.fraction > a.fraction ? 1 : b.fraction < a.fraction ? -1 : 0))) {
    if (leftover <= 0n) break;
    if (row.fraction > 0n && row.floor < row.balance) {
      row.floor += 1n;
      leftover -= 1n;
    }
  }
  return rows.filter((r) => r.floor > 0n).map((r) => [r.account, r.floor]);
}

export function share(remaining: bigint, count: number, populationBefore: number): bigint {
  if (remaining <= 0n || count <= 0) return 0n;
  if (count >= populationBefore) return remaining;
  return (remaining * BigInt(count)) / BigInt(populationBefore);
}
