import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { allocateKobo, kobo } from '../common/money';
import { FarmCostAllocationService } from './farm-cost-allocation.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Farm lifecycle ABC — S_SNAILERY_ABC and P_POULTRY_FARM_ABC (V895_FULL_CHECKS).
 *
 * SNAILS. On the client's chart snail feed and medication (611000) and
 * labour and facility (612000) are expensed as used, so the books do not say
 * what each stage of the lifecycle cost or what the live sales and the
 * processing carried. This schedule does: each pool is shared across the
 * stages by driver quantity × the stage's rate —
 *
 *   Breeder        breeder-months     (animal-days of breeder cohorts ÷ 30.44)
 *   Egg            eggs produced      (breeding cycles set in the year)
 *   Hatchling      hatchlings         (hatched in the year)
 *   Juvenile       juveniles          (moved to Juvenile in the year)
 *   Market-ready   market-ready snails (moved to Market-ready in the year)
 *
 * — and then over what became of the market-ready snails: sold live,
 * processed, or kept (replacement breeders and stock still held). The rates
 * are weights: the actual pool is always allocated in full, so this never
 * shows cost that was not spent. A farm sets its own rates; until it does,
 * the workbook's.
 *
 * POULTRY. A flock's lifecycle cost is capitalised into it (acquisition,
 * feed, medication, labour — RearingCostService), so the pools are the
 * flock's own, and they are shared over the birds that left it alive: sold
 * live, sent to processing, or still held. Birds that died are not an
 * outcome here, as in the workbook; the books write their share off when they
 * die (see the 500-poultry replay's mortalityExpensed).
 */
export const SNAIL_STAGES = ['Breeder', 'Egg', 'Hatchling', 'Juvenile', 'Market-ready'] as const;
export type SnailStage = (typeof SNAIL_STAGES)[number];
export type AbcPool = 'FEED' | 'LABOUR';
const DRIVER: Record<SnailStage, string> = {
  Breeder: 'Breeder-months',
  Egg: 'Eggs produced',
  Hatchling: 'Hatchlings',
  Juvenile: 'Juveniles',
  'Market-ready': 'Market-ready snails',
};
/** S_SNAILERY_ABC's rates, naira per driver unit. */
export const DEFAULT_SNAIL_RATES: Record<SnailStage, Record<AbcPool, string>> = {
  Breeder: { FEED: '80', LABOUR: '60' },
  Egg: { FEED: '12', LABOUR: '6.75' },
  Hatchling: { FEED: '32', LABOUR: '18' },
  Juvenile: { FEED: '70', LABOUR: '33.75' },
  'Market-ready': { FEED: '47.058824', LABOUR: '26.470588' },
};
const POOL_ACCOUNT: Record<AbcPool, string> = { FEED: '611000', LABOUR: '612000' };
const DAYS_PER_MONTH = new Decimal('30.4375');

type Outcome = { keptKobo: string; liveKobo: string; processingKobo: string };

@Injectable()
export class FarmAbcService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly allocation: FarmCostAllocationService,
  ) {}

  async rates(companyId: string) {
    const rows = await this.prisma.farmAbcRate.findMany({ where: { companyId, speciesKey: 'snail' } });
    return SNAIL_STAGES.map((stage) => {
      const own = (pool: AbcPool) => rows.find((r) => r.stage === stage && r.pool === pool);
      return {
        stage,
        driver: DRIVER[stage],
        feedRate: own('FEED')?.rate.toString() ?? DEFAULT_SNAIL_RATES[stage].FEED,
        labourRate: own('LABOUR')?.rate.toString() ?? DEFAULT_SNAIL_RATES[stage].LABOUR,
        own: Boolean(own('FEED') || own('LABOUR')),
      };
    });
  }

  async setRate(params: { companyId: string; actor: WorkflowActor; stage: string; pool: string; rate: string }) {
    if (!(SNAIL_STAGES as readonly string[]).includes(params.stage)) throw new BadRequestException(`Stage is one of ${SNAIL_STAGES.join(', ')}.`);
    if (params.pool !== 'FEED' && params.pool !== 'LABOUR') throw new BadRequestException('Pool is FEED or LABOUR.');
    let rate: Decimal;
    try {
      rate = new Decimal(params.rate);
    } catch {
      throw new BadRequestException('The rate is a number of naira per driver unit.');
    }
    if (rate.isNegative()) throw new BadRequestException('A rate cannot be negative.');
    const row = await this.prisma.farmAbcRate.upsert({
      where: { companyId_speciesKey_stage_pool: { companyId: params.companyId, speciesKey: 'snail', stage: params.stage, pool: params.pool } },
      create: { companyId: params.companyId, speciesKey: 'snail', stage: params.stage, pool: params.pool, rate: rate.toFixed(6), setById: params.actor.userId },
      update: { rate: rate.toFixed(6), setById: params.actor.userId },
    });
    await this.audit.write({
      transactionId: row.id, module: 'COST_ALLOCATION', entityType: 'FarmAbcRate', entityId: row.id, status: 'ACTIVE', action: AuditAction.CONFIG_CHANGE,
      userId: params.actor.userId, ipAddress: params.actor.ipAddress ?? null, device: params.actor.device ?? null,
      comments: `Snail ${params.stage} ${params.pool.toLowerCase()} ABC rate NGN ${rate.toString()} per ${DRIVER[params.stage as SnailStage].toLowerCase()}`,
    });
    return row;
  }

  /** The snailery schedule for a financial year. */
  async snailery(companyId: string, financialYearId: string) {
    const year = await this.prisma.financialYear.findFirst({ where: { id: financialYearId, companyId }, include: { periods: { select: { id: true } } } });
    if (!year) throw new NotFoundException('No such financial year.');
    const within = { gte: year.startDate, lte: year.endDate };
    const snailGroups = await this.prisma.livestockGroup.findMany({ where: { companyId, speciesKey: 'snail' }, select: { id: true, stage: true } });
    const ids = snailGroups.map((g) => g.id);

    // --- the two pools, as the ledger has them for the year ---
    const pools: Record<AbcPool, bigint> = { FEED: 0n, LABOUR: 0n };
    for (const pool of ['FEED', 'LABOUR'] as const) {
      const account = await this.prisma.gLAccount.findFirst({ where: { companyId, accountNumber: POOL_ACCOUNT[pool] }, select: { id: true } });
      if (!account) continue;
      const sums = await this.prisma.journalLine.aggregate({
        where: { glAccountId: account.id, financialPeriodId: { in: year.periods.map((p) => p.id) }, journalEntry: { companyId, status: 'POSTED' } },
        _sum: { debitKobo: true, creditKobo: true },
      });
      pools[pool] = (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
    }

    // --- the drivers, from the farm's own records ---
    const breederIds = new Set(snailGroups.filter((g) => g.stage === 'Breeder').map((g) => g.id));
    const [animalDays, cycles, hatched, moves, sold, processed] = await Promise.all([
      this.allocation.animalDays(companyId, year.startDate, year.endDate),
      this.prisma.snailBreedingCycle.aggregate({ where: { companyId, setOn: within }, _sum: { eggsLaid: true } }),
      this.prisma.snailBreedingCycle.aggregate({ where: { companyId, hatchedOn: within }, _sum: { hatchedCount: true } }),
      this.prisma.stageChange.groupBy({ by: ['toStage'], where: { companyId, groupId: { in: ids }, changedOn: within }, _sum: { population: true } }),
      this.prisma.livestockGroupDisposal.aggregate({ where: { groupId: { in: ids }, group: { companyId }, method: 'SOLD', occurredOn: within }, _sum: { quantity: true } }),
      this.prisma.harvestRecord.aggregate({ where: { companyId, groupId: { in: ids }, destination: 'PROCESSING', harvestedOn: within }, _sum: { count: true } }),
    ]);
    const moved = (stage: string) => moves.find((m) => m.toStage === stage)?._sum.population ?? 0;
    const breederDays = animalDays.filter((a) => breederIds.has(a.groupId)).reduce((s, a) => s.plus(a.animalDays), new Decimal(0));
    const drivers: Record<SnailStage, Decimal> = {
      Breeder: breederDays.div(DAYS_PER_MONTH).toDecimalPlaces(2),
      Egg: new Decimal(cycles._sum.eggsLaid ?? 0),
      Hatchling: new Decimal(hatched._sum.hatchedCount ?? 0),
      Juvenile: new Decimal(moved('Juvenile')),
      'Market-ready': new Decimal(moved('Market-ready')),
    };

    // --- pools to stages, by driver × rate ---
    const rates = await this.rates(companyId);
    const spread = (pool: AbcPool, rateOf: (r: (typeof rates)[number]) => string) => {
      const weights = rates.map((r) => drivers[r.stage].mul(rateOf(r)));
      if (pools[pool] === 0n || weights.every((w) => w.isZero())) return rates.map(() => 0n);
      return allocateKobo(kobo(pools[pool]), weights).map((k) => BigInt(k));
    };
    const feed = spread('FEED', (r) => r.feedRate);
    const labour = spread('LABOUR', (r) => r.labourRate);

    // --- stages to outcomes, by what became of the market-ready snails ---
    const marketReady = drivers['Market-ready'].toNumber();
    const live = Math.min(sold._sum.quantity ?? 0, marketReady);
    const processing = Math.min(processed._sum.count ?? 0, marketReady - live);
    const kept = Math.max(0, marketReady - live - processing);
    const outcome = (cost: bigint): Outcome | null => {
      if (marketReady <= 0 || cost === 0n) return marketReady <= 0 ? null : { keptKobo: '0', liveKobo: '0', processingKobo: '0' };
      const [k, l, p] = allocateKobo(kobo(cost), [kept, live, processing]).map((x) => BigInt(x));
      return { keptKobo: k!.toString(), liveKobo: l!.toString(), processingKobo: p!.toString() };
    };

    const stages = rates.map((r, i) => {
      const total = feed[i]! + labour[i]!;
      return {
        stage: r.stage,
        driver: r.driver,
        driverQuantity: drivers[r.stage].toString(),
        feedRate: r.feedRate,
        labourRate: r.labourRate,
        feedKobo: feed[i]!.toString(),
        labourKobo: labour[i]!.toString(),
        totalKobo: total.toString(),
        outcome: outcome(total),
      };
    });
    const total = pools.FEED + pools.LABOUR;
    return {
      financialYear: year.code,
      pools: { feedKobo: pools.FEED.toString(), labourKobo: pools.LABOUR.toString(), totalKobo: total.toString() },
      allocatedKobo: stages.reduce((s, x) => s + BigInt(x.totalKobo), 0n).toString(),
      marketReady: { total: marketReady, kept, live, processing },
      outcome: outcome(total),
      stages,
    };
  }

  /** Each flock's capitalised lifecycle cost, shared over the birds that left it alive. */
  async flocks(companyId: string) {
    const flocks = await this.prisma.livestockGroup.findMany({
      where: { companyId, speciesKey: 'poultry' },
      select: { id: true, code: true, status: true, population: true, acquisitionCostKobo: true },
      orderBy: { startedOn: 'desc' },
    });
    const ids = flocks.map((f) => f.id);
    const posted = { journalEntryId: { not: null } };
    const [feed, treatments, labour, sold, processed] = await Promise.all([
      this.prisma.feedIssue.groupBy({ by: ['dailyRecordId'], where: { dailyRecord: { companyId, groupId: { in: ids } }, ...posted }, _sum: { valueKobo: true } }),
      this.prisma.treatmentRecord.groupBy({ by: ['groupId'], where: { companyId, groupId: { in: ids }, ...posted }, _sum: { costKobo: true } }),
      this.prisma.farmCostAllocationLine.groupBy({ by: ['groupId'], where: { groupId: { in: ids }, allocation: { companyId, journalEntryId: { not: null } } }, _sum: { amountKobo: true } }),
      this.prisma.livestockGroupDisposal.groupBy({ by: ['groupId'], where: { groupId: { in: ids }, group: { companyId }, method: 'SOLD' }, _sum: { quantity: true } }),
      this.prisma.harvestRecord.groupBy({ by: ['groupId'], where: { companyId, groupId: { in: ids }, destination: 'PROCESSING' }, _sum: { count: true } }),
    ]);
    const rounds = await this.prisma.dailyRecord.findMany({ where: { companyId, id: { in: feed.map((f) => f.dailyRecordId) } }, select: { id: true, groupId: true } });
    const groupOfRound = new Map(rounds.map((r) => [r.id, r.groupId]));
    const feedBy = new Map<string, bigint>();
    for (const f of feed) {
      const g = groupOfRound.get(f.dailyRecordId)!;
      feedBy.set(g, (feedBy.get(g) ?? 0n) + (f._sum.valueKobo ?? 0n));
    }
    const of = <T extends { groupId: string }>(rows: T[], id: string, pick: (r: T) => bigint | number | null) => {
      const row = rows.find((r) => r.groupId === id);
      return row ? pick(row) ?? 0 : 0;
    };

    return flocks.map((f) => {
      const pools = {
        acquisitionKobo: f.acquisitionCostKobo,
        feedKobo: feedBy.get(f.id) ?? 0n,
        medicationKobo: BigInt(of(treatments, f.id, (r) => r._sum.costKobo)),
        labourKobo: BigInt(of(labour, f.id, (r) => r._sum.amountKobo)),
      };
      const total = pools.acquisitionKobo + pools.feedKobo + pools.medicationKobo + pools.labourKobo;
      const live = Number(of(sold, f.id, (r) => r._sum.quantity));
      const processing = Number(of(processed, f.id, (r) => r._sum.count));
      const held = f.population;
      const base = live + processing + held;
      const [l, p, h] = base > 0 && total > 0n ? allocateKobo(kobo(total), [live, processing, held]).map((x) => BigInt(x)) : [0n, 0n, 0n];
      return {
        code: f.code,
        status: f.status,
        acquisitionKobo: pools.acquisitionKobo.toString(),
        feedKobo: pools.feedKobo.toString(),
        medicationKobo: pools.medicationKobo.toString(),
        labourKobo: pools.labourKobo.toString(),
        totalKobo: total.toString(),
        birds: { live, processing, held },
        liveKobo: l!.toString(),
        processingKobo: p!.toString(),
        heldKobo: h!.toString(),
      };
    });
  }
}
