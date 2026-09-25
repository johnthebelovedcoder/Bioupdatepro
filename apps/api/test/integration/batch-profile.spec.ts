import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { BatchProfileService } from '../../src/operations/batch-profile.service';
import { OperationsService } from '../../src/operations/operations.service';
import type { OperationsPostingService } from '../../src/operations/operations-posting.service';
import type { BiologicalAssetService } from '../../src/biological-assets/biological-asset.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * A batch's biological master data (POULTRY_FLOCK_MASTER / SNAIL_COHORT_MASTER,
 * POULTRY_WEIGHT_HISTORY): age on its basis, the stage that age suggests, an
 * approved and append-only weight history with one current reading, biomass,
 * and how animals left.
 */

let prisma: PrismaService;
let profiles: BatchProfileService;
let fixture: TestFixture;
let clerk: { userId: string; roles: string[] };
let supervisor: { userId: string; roles: string[] };

const TODAY = new Date('2026-03-01');

beforeAll(() => {
  prisma = new PrismaService();
  profiles = new BatchProfileService(prisma, new AuditService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  clerk = { userId: fixture.makerId, roles: ['FARM_ATTENDANT'] };
  supervisor = { userId: fixture.checkerId, roles: ['POULTRY_SUPERVISOR'] };

  // Ross 308 thresholds from POULTRY_BREED_MASTER, with target weights.
  await prisma.speciesBreed.create({
    data: {
      companyId: fixture.companyId, speciesKey: 'poultry', code: 'BR-BROIL-01', name: 'Ross 308', openingStage: 'Chick',
      stages: {
        create: [
          { stageName: 'Chick', minDay: 0, sortOrder: 1, targetWeightGrams: 180 },
          { stageName: 'Grower', minDay: 15, sortOrder: 2, targetWeightGrams: 900 },
          { stageName: 'Finisher', minDay: 29, sortOrder: 3, targetWeightGrams: 1600 },
          { stageName: 'Market-ready', minDay: 42, sortOrder: 4, targetWeightGrams: 2200 },
        ],
      },
    },
  });
  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'PEN-B1', name: 'Broiler house' } });
  await prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: pen.id, code: 'BR-1', speciesKey: 'poultry',
      breed: 'Ross 308', purpose: 'Broiler', stage: 'Grower', openingPopulation: 1000, population: 950, startedOn: new Date('2026-02-01'),
    },
  });
});

const weigh = (on: string, sample: number, total: number, unit: 'g' | 'kg' = 'kg', actor = clerk) =>
  profiles.recordWeighing({
    companyId: fixture.companyId, code: 'BR-1', weighedOn: new Date(on), sampleSize: sample, totalSampleWeight: total, unit, actor, today: TODAY,
  });

describe('Age and stage', () => {
  it('counts age from placement, then from an exact or estimated hatch date, and suggests the stage that age reaches', async () => {
    expect(await profiles.profile(fixture.companyId, 'BR-1', TODAY)).toMatchObject({
      ageDays: 28, ageWeeks: '4.0', ageMonths: '0.9', ageBasis: 'PLACEMENT', configuredStage: 'Grower', suggestedStage: 'Grower', stageStatus: 'OK',
    });

    // Bought in at a day old: hatched the day before placement, on the vendor's word.
    await profiles.setHatchDate({ companyId: fixture.companyId, code: 'BR-1', hatchedOn: new Date('2026-01-30'), estimated: true, actor: supervisor });
    // 30 days old: Finisher by the thresholds, still Grower on the record — REVIEW.
    expect(await profiles.profile(fixture.companyId, 'BR-1', TODAY)).toMatchObject({
      ageDays: 30, ageBasis: 'ESTIMATED', suggestedStage: 'Finisher', stageStatus: 'REVIEW',
    });

    await expect(
      profiles.setHatchDate({ companyId: fixture.companyId, code: 'BR-1', hatchedOn: new Date('2026-02-05'), actor: supervisor }),
    ).rejects.toThrow(/hatched on or before/);
  });
});

describe('Weight history', () => {
  it('records weighings pending, and only an approved one counts', async () => {
    const w = await weigh('2026-02-22', 20, 17.6); // 17.6 kg over 20 birds
    expect(w).toMatchObject({ status: 'PENDING', averageWeightGrams: 880, totalSampleWeightGrams: 17600, targetWeightGrams: 900, stage: 'Grower', ageDays: 21 });

    let profile = await profiles.profile(fixture.companyId, 'BR-1', TODAY);
    expect(profile.current).toBeNull();
    expect(profile.biomassKg).toBeNull();
    expect(profile.pending).toHaveLength(1);

    await profiles.approveWeighing({ companyId: fixture.companyId, weighingId: w.id, actor: supervisor });
    profile = await profiles.profile(fixture.companyId, 'BR-1', TODAY);
    expect(profile.current).toMatchObject({ averageWeightGrams: 880, varianceGrams: -20, variancePercent: '-2.2', isCurrent: true, approvedBy: 'Checker User' });
    expect(profile.biomassKg).toBe('836.000'); // 950 × 880 g
    const group = await prisma.livestockGroup.findFirstOrThrow({ where: { code: 'BR-1' } });
    expect(group.currentWeightKg?.toString()).toBe('0.88');
  });

  it('keeps exactly one current weighing: the latest approved', async () => {
    const early = await weigh('2026-02-08', 20, 3600, 'g');
    const late = await weigh('2026-02-22', 25, 22, 'kg');
    await profiles.approveWeighing({ companyId: fixture.companyId, weighingId: late.id, actor: supervisor });
    await profiles.approveWeighing({ companyId: fixture.companyId, weighingId: early.id, actor: supervisor }); // older: history only

    const profile = await profiles.profile(fixture.companyId, 'BR-1', TODAY);
    expect(profile.weighings.filter((w) => w.isCurrent).map((w) => w.weighedOn)).toEqual(['2026-02-22']);
    expect(profile.averageDailyGainGrams).toBe('50.0'); // 180 g to 880 g over 14 days
    await expect(
      prisma.livestockWeighing.update({ where: { id: early.id }, data: { isCurrent: true } }),
    ).rejects.toThrow(); // the database holds one current per batch
  });

  it('will not let whoever recorded a weighing approve it, nor a clerk approve at all', async () => {
    const w = await weigh('2026-02-22', 20, 17.6);
    await expect(
      profiles.approveWeighing({ companyId: fixture.companyId, weighingId: w.id, actor: { userId: fixture.makerId, roles: ['POULTRY_SUPERVISOR'] } }),
    ).rejects.toThrow(/someone else must approve/);
    await expect(
      profiles.approveWeighing({ companyId: fixture.companyId, weighingId: w.id, actor: { userId: fixture.financeUserId, roles: ['FARM_ATTENDANT'] } }),
    ).rejects.toThrow(/supervisor or farm manager/);
  });

  it('treats a weighing as history: measurements cannot change, rows cannot go, a decision is made once', async () => {
    const w = await weigh('2026-02-22', 20, 17.6);
    await expect(prisma.livestockWeighing.update({ where: { id: w.id }, data: { averageWeightGrams: 999 } })).rejects.toThrow(/history/);
    await expect(prisma.livestockWeighing.delete({ where: { id: w.id } })).rejects.toThrow(/cannot be deleted/);

    await profiles.rejectWeighing({ companyId: fixture.companyId, weighingId: w.id, reason: 'Scale not zeroed', actor: supervisor });
    await expect(profiles.approveWeighing({ companyId: fixture.companyId, weighingId: w.id, actor: supervisor })).rejects.toThrow(/already rejected/);
    const profile = await profiles.profile(fixture.companyId, 'BR-1', TODAY);
    expect(profile.weighings[0]).toMatchObject({ status: 'REJECTED', rejectionReason: 'Scale not zeroed', isCurrent: false });
  });

  it('refuses a weighing that cannot be right, saying what was entered and what is allowed', async () => {
    await expect(weigh('2026-01-20', 10, 1)).rejects.toThrow(/placed on 2026-02-01/);
    await expect(weigh('2026-03-05', 10, 1)).rejects.toThrow(/future/);
    await expect(weigh('2026-02-10', 2000, 1)).rejects.toThrow(/You weighed 2000, but BR-1 has 950 animals/);
    await expect(weigh('2026-02-10', 10, 0)).rejects.toThrow(/what the whole sample weighed/);
  });
});

describe('Flock KPIs', () => {
  it('works out FCR (KPI-11): feed ÷ live-weight gain between the first and current approved weighings', async () => {
    const group = await prisma.livestockGroup.findFirstOrThrow({ where: { code: 'BR-1' } });
    const first = await weigh('2026-02-08', 20, 3600, 'g'); // 180 g
    const second = await weigh('2026-02-22', 20, 17.6); // 880 g
    for (const w of [first, second]) await profiles.approveWeighing({ companyId: fixture.companyId, weighingId: w.id, actor: supervisor });
    for (const [on, kg] of [['2026-02-10', 400], ['2026-02-15', 598.5], ['2026-02-25', 999]] as const) {
      const round = await prisma.dailyRecord.create({ data: { companyId: fixture.companyId, groupId: group.id, recordedOn: new Date(on), recordedById: fixture.makerId } });
      await prisma.feedIssue.create({ data: { dailyRecordId: round.id, feedName: 'Grower', quantityKg: String(kg) } });
    }
    // 998.5 kg eaten between the weighings (the 25th is after); 950 birds gained 0.7 kg each = 665 kg.
    expect((await profiles.profile(fixture.companyId, 'BR-1', TODAY)).fcr).toEqual({
      value: '1.50', feedKg: '998.5', gainKg: '665.0', from: '2026-02-08', to: '2026-02-22',
    });
  });

  it('works out hen-day % (KPI-13) against the hens alive each day', async () => {
    const group = await prisma.livestockGroup.findFirstOrThrow({ where: { code: 'BR-1' } });
    for (const [on, eggs, died] of [['2026-02-20', 800, 0], ['2026-02-21', 800, 50], ['2026-02-22', 800, 0]] as const) {
      const round = await prisma.dailyRecord.create({ data: { companyId: fixture.companyId, groupId: group.id, recordedOn: new Date(on), recordedById: fixture.makerId } });
      await prisma.productionLine.create({ data: { dailyRecordId: round.id, fieldKey: 'whole', quantity: String(eggs) } });
      if (died) await prisma.mortalityRecord.create({ data: { dailyRecordId: round.id, quantity: died, causes: ['Heat stress'] } });
    }
    // 950 alive now; 1,000 on the 20th (50 died after it), 950 on the 21st and 22nd: 2,900 hen-days, 2,400 eggs.
    expect((await profiles.profile(fixture.companyId, 'BR-1', TODAY)).henDay).toEqual({ percent: '82.8', eggs: 2400, henDays: 2900, days: 3 });
  });
});

describe('The round', () => {
  it('records a weight sample taken on the round as a pending weighing, and what was done with the dead', async () => {
    const rounds = new OperationsService(
      prisma, new IdempotencyService(prisma), new AuditService(prisma),
      { postFeedIssues: async () => ({ posted: 0, skipped: [] }) } as unknown as OperationsPostingService,
      { postMortality: async () => ({ posted: false }) } as unknown as BiologicalAssetService,
      profiles,
    );
    const round = (date: string, entry: Record<string, unknown>) =>
      rounds.recordRound({
        companyId: fixture.companyId, actor: clerk, idempotencyKey: `round-${date}`,
        payload: { module: 'poultry', date, entries: [{ groupCode: 'BR-1', ...entry }] },
      });
    await round('2026-02-10', { deaths: 5, causes: ['Heat stress'], carcassDisposal: 'BURNT', weightSample: { sampleSize: 10, totalWeight: 3.5, unit: 'kg' } });
    await round('2026-02-11', { deaths: 5, causes: ['Heat stress'], carcassDisposal: 'THROWN_AWAY' });

    const profile = await profiles.profile(fixture.companyId, 'BR-1', TODAY);
    expect(profile.deaths).toEqual({ total: 10, byCarcassDisposal: { BURNT: 5, NOT_RECORDED: 5 } });
    expect(profile.pending).toHaveLength(1);
    expect(profile.pending[0]).toMatchObject({ weighedOn: '2026-02-10', sampleSize: 10, averageWeightGrams: 350, recordedBy: 'Maker User' });
  });

  it('shows animals sold', async () => {
    const group = await prisma.livestockGroup.findFirstOrThrow({ where: { code: 'BR-1' } });
    await prisma.livestockGroupDisposal.create({
      data: { groupId: group.id, quantity: 30, fvlctsPerUnitKobo: 100n, carryingAmountKobo: 3000n, occurredOn: new Date('2026-02-20'), method: 'SOLD' },
    });
    expect((await profiles.profile(fixture.companyId, 'BR-1', TODAY)).disposals).toEqual([{ occurredOn: '2026-02-20', quantity: 30, method: 'SOLD' }]);
  });

  it('does not show another company’s batch', async () => {
    await expect(profiles.profile('00000000-0000-0000-0000-000000000000', 'BR-1', TODAY)).rejects.toThrow(/No such group/);
  });
});
