import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { RearingCostService } from '../../src/biological-assets/rearing-cost.service';
import { StockMovementService } from '../../src/inventory/stock-movement.service';
import { OperationsPostingService } from '../../src/operations/operations-posting.service';
import { BiologicalAssetService } from '../../src/biological-assets/biological-asset.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * The client's six-digit chart (Company.chartVersion = 'SPEC'), policy of
 * 2026-09-25: poultry rearing cost is capitalised into Biological Assets —
 * Poultry (130210) and absorbed into fair value at each revaluation; snail
 * feed and medication are expensed as used (611000).
 */

let prisma: PrismaService;
let posting: PostingService;
let rearing: RearingCostService;
let operations: OperationsPostingService;
let assets: BiologicalAssetService;
let fixture: TestFixture;
let actor: { userId: string; roles: string[] };
const account: Record<string, string> = {};

const ON = new Date('2026-01-10');

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  rearing = new RearingCostService(prisma, posting);
  operations = new OperationsPostingService(prisma, posting, rearing, new StockMovementService(prisma));
  const workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  assets = new BiologicalAssetService(prisma, posting, workflow, audit, rearing);
});

async function useChart(version: 'LEGACY' | 'SPEC') {
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: version } });
}

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  actor = { userId: fixture.makerId, roles: ['CFO'] };
  for (const [number, name, type, normal] of [
    ['130210', 'Biological Assets — Poultry', 'ASSET', 'DEBIT'],
    ['130110', 'Feed Inventory', 'ASSET', 'DEBIT'],
    ['611000', 'Snail Feed and Medication Expense', 'EXPENSE', 'DEBIT'],
    ['420200', 'Fair-Value Gain/Loss — Poultry', 'REVENUE', 'CREDIT'],
  ] as const) {
    account[number] = (
      await prisma.gLAccount.create({ data: { companyId: fixture.companyId, accountNumber: number, name, accountType: type, normalBalance: normal } })
    ).id;
  }
  // Valuations go for approval; the approval itself is not under test here.
  await prisma.workflowDefinition.create({
    data: {
      companyId: fixture.companyId, transactionType: 'BA_VALUATION', name: 'Valuation route', effectiveFrom: new Date('2026-01-01'),
      steps: { create: [{ level: 1, roleCode: 'CFO', name: 'CFO', maxAmountKobo: null }] },
    },
  });
});

async function population(code: string, speciesKey: 'poultry' | 'snail', animals: number) {
  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: `PEN-${code}`, name: code } });
  return prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: pen.id, code, speciesKey,
      breed: 'Test', purpose: 'Growers', stage: speciesKey === 'poultry' ? 'Grower' : 'Grower', openingPopulation: animals,
      population: animals, startedOn: new Date('2026-01-01'),
    },
  });
}

/** A round that fed feed worth `valueKobo` (not a stock item — valued on the round). */
async function feed(groupId: string, valueKobo: bigint) {
  const record = await prisma.dailyRecord.create({
    data: { companyId: fixture.companyId, groupId, recordedOn: ON, recordedById: fixture.makerId },
  });
  await prisma.feedIssue.create({ data: { dailyRecordId: record.id, feedName: 'Grower mash', quantityKg: '10', valueKobo } });
  return operations.postFeedIssues({ companyId: fixture.companyId, dailyRecordId: record.id, actor });
}

const balance = async (id: string) => {
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: id }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
};

describe('The client’s chart (SPEC)', () => {
  it('capitalises poultry feed into Biological Assets and expenses snail feed', async () => {
    await useChart('SPEC');
    const flock = await population('L-1', 'poultry', 100);
    const cohort = await population('S-1', 'snail', 500);

    expect(await feed(flock.id, 5_000_000n)).toEqual({ posted: 1, skipped: [] });
    expect(await feed(cohort.id, 200_000n)).toEqual({ posted: 1, skipped: [] });

    expect(await balance(account['130210']!)).toBe(5_000_000n);
    expect(await balance(account['611000']!)).toBe(200_000n);
    expect(await balance(account['130110']!)).toBe(-5_200_000n);
    expect(await balance(fixture.accounts['1501']!)).toBe(0n); // nothing on the old chart
    expect(await rearing.remaining(flock.id)).toBe(5_000_000n);
    expect(await rearing.remaining(cohort.id)).toBe(0n); // expensed, not held
  });

  it('measures a revaluation against fair value plus capitalised rearing cost, and absorbs it', async () => {
    await useChart('SPEC');
    const flock = await population('L-2', 'poultry', 100);
    await feed(flock.id, 5_000_000n); // ₦50,000 of feed in 130210

    // Worth ₦1,000 a bird: ₦100,000 in all. Gain = ₦100,000 − ₦50,000 held.
    const { id } = await assets.requestValuation({
      companyId: fixture.companyId, groupId: flock.id, valuationDate: ON, marketPricePerUnitKobo: 100_000n,
      costsToSellPerUnitKobo: 0n, evidenceReference: 'Market survey', actor,
    });
    const valuation = await prisma.biologicalAssetValuation.findUniqueOrThrow({ where: { id } });
    expect(valuation).toMatchObject({ direction: 'GAIN', gainLossKobo: 5_000_000n, rearingCostAbsorbedKobo: 5_000_000n });

    await prisma.$transaction((tx) => assets.postApprovedValuation({ valuationId: id, actor, tx }));
    expect(await balance(account['130210']!)).toBe(10_000_000n); // exactly 100 birds × ₦1,000
    expect(await rearing.remaining(flock.id)).toBe(0n); // absorbed, not counted again
  });
});

describe('The old chart (LEGACY) is unchanged', () => {
  it('holds rearing cost apart in 1501 and does not absorb it into a revaluation', async () => {
    const flock = await population('L-3', 'poultry', 100);
    await feed(flock.id, 5_000_000n);
    expect(await balance(fixture.accounts['1501']!)).toBe(5_000_000n);

    const { id } = await assets.requestValuation({
      companyId: fixture.companyId, groupId: flock.id, valuationDate: ON, marketPricePerUnitKobo: 100_000n,
      costsToSellPerUnitKobo: 0n, evidenceReference: 'Market survey', actor,
    });
    expect(await prisma.biologicalAssetValuation.findUniqueOrThrow({ where: { id } })).toMatchObject({
      gainLossKobo: 10_000_000n,
      rearingCostAbsorbedKobo: 0n,
    });
  });
});
