import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
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
const ACCOUNT = {
  workInProgress: '1501',
  productionLoss: '5305',
  costOfSales: '5001',
} as const;

export type ReliefEvent = 'MORTALITY' | 'DISPOSAL' | 'HARVEST';

/** Events that take cost out of a population. TRANSFER_IN adds it back. */
const OUTFLOWS = ['MORTALITY', 'DISPOSAL', 'HARVEST', 'TRANSFER_OUT'];

@Injectable()
export class RearingCostService {
  private readonly logger = new Logger(RearingCostService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
  ) {}

  /** What is still sitting in WIP for this population, in kobo. */
  async remaining(groupId: string, client: Prisma.TransactionClient | PrismaService = this.prisma) {
    const [feed, treatments, reliefs] = await Promise.all([
      client.feedIssue.aggregate({
        where: { dailyRecord: { groupId }, journalEntryId: { not: null } },
        _sum: { valueKobo: true },
      }),
      client.treatmentRecord.aggregate({
        where: { groupId, journalEntryId: { not: null } },
        _sum: { costKobo: true },
      }),
      client.livestockRearingRelief.groupBy({
        by: ['eventType'],
        where: { groupId },
        _sum: { amountKobo: true },
      }),
    ]);

    let balance = (feed._sum.valueKobo ?? 0n) + (treatments._sum.costKobo ?? 0n);
    for (const row of reliefs) {
      const amount = row._sum.amountKobo ?? 0n;
      balance += row.eventType === 'TRANSFER_IN' ? amount : OUTFLOWS.includes(row.eventType) ? -amount : 0n;
    }
    return balance > 0n ? balance : 0n;
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
        const remaining = await this.remaining(params.groupId);
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

      const remaining = await this.remaining(params.fromGroupId, tx);
      const amountKobo = share(remaining, params.count, params.populationBefore);
      const common = {
        companyId: params.companyId,
        sourceId: params.sourceId,
        count: params.count,
        populationBefore: Math.max(params.populationBefore, params.count),
        amountKobo,
        occurredOn: params.occurredOn,
      };
      await tx.livestockRearingRelief.create({
        data: { ...common, groupId: params.fromGroupId, eventType: 'TRANSFER_OUT' },
      });
      await tx.livestockRearingRelief.create({
        data: { ...common, groupId: params.toGroupId, eventType: 'TRANSFER_IN' },
      });
      return amountKobo;
    });
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
    const debitNumber = relief.eventType === 'MORTALITY' ? ACCOUNT.productionLoss : ACCOUNT.costOfSales;

    try {
      const [accounts, period, costCentre, company] = await Promise.all([
        this.prisma.gLAccount.findMany({
          where: {
            companyId: relief.companyId,
            accountNumber: { in: [ACCOUNT.workInProgress, debitNumber] },
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
          where: { companyId: relief.companyId, active: true },
          orderBy: { code: 'asc' },
          select: { id: true },
        }),
        this.prisma.company.findUniqueOrThrow({ where: { id: relief.companyId } }),
      ]);

      const wip = accounts.find((a) => a.accountNumber === ACCOUNT.workInProgress)?.id;
      const debit = accounts.find((a) => a.accountNumber === debitNumber)?.id;
      if (!wip || !debit) {
        return { posted: false, reason: `No active ${ACCOUNT.workInProgress} or ${debitNumber} account.` };
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
          { glAccountId: wip, description: `Rearing cost out of WIP — ${group.code}`, credit: kobo(relief.amountKobo), dimensions },
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
export function share(remaining: bigint, count: number, populationBefore: number): bigint {
  if (remaining <= 0n || count <= 0) return 0n;
  if (count >= populationBefore) return remaining;
  return (remaining * BigInt(count)) / BigInt(populationBefore);
}
