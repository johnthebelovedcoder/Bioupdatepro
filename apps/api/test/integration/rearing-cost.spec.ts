import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { RearingCostService, share } from '../../src/biological-assets/rearing-cost.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Rearing cost relieved at weighted average — the costing policy the farm
 * chose. Feed posts into WIP; deaths, live sales and harvests take their
 * share out of it; the last animals out take whatever is left.
 */

let prisma: PrismaService;
let posting: PostingService;
let rearing: RearingCostService;
let fixture: TestFixture;
let actor: { userId: string; roles: string[] };

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const idempotency = new IdempotencyService(prisma);
  const periods = new PeriodService(prisma);
  const dimensions = new DimensionValidatorService(prisma);
  posting = new PostingService(prisma, audit, idempotency, periods, dimensions);
  rearing = new RearingCostService(prisma, posting);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  actor = { userId: fixture.makerId, roles: ['FARM_MANAGER'] };

  // The fixture chart has no Cost of Sales; a live sale needs one.
  const cos = await prisma.gLAccount.create({
    data: {
      companyId: fixture.companyId,
      accountNumber: '5001',
      name: 'Cost of Sales',
      accountType: 'EXPENSE',
      normalBalance: 'DEBIT',
    },
  });
  fixture.accounts['5001'] = cos.id;
});

/** A population with `population` animals and `feedKobo` of posted feed. */
async function populationWithFeed(code: string, population: number, feedKobo: bigint) {
  const pen = await prisma.penHouse.create({
    data: { farmId: fixture.farmId, code: `PEN-${code}`, name: `Pen ${code}` },
  });
  const group = await prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId,
      branchId: fixture.branchId,
      farmId: fixture.farmId,
      penHouseId: pen.id,
      code,
      speciesKey: 'poultry',
      breed: 'Test',
      purpose: 'Broiler',
      stage: 'Grower',
      openingPopulation: population,
      population,
      startedOn: new Date('2026-01-01'),
    },
  });
  if (feedKobo > 0n) await feed(group.id, feedKobo);
  return group;
}

/** Feed issued to a population and posted Dr WIP / Cr Raw Material. */
async function feed(groupId: string, valueKobo: bigint, recordedOn = new Date('2026-01-10')) {
  const record = await prisma.dailyRecord.create({
    data: { companyId: fixture.companyId, groupId, recordedOn, recordedById: fixture.makerId },
  });
  const issue = await prisma.feedIssue.create({
    data: {
      dailyRecordId: record.id,
      feedName: 'Grower mash',
      quantityKg: '100',
      valueKobo,
    },
  });
  const posted = await posting.post({
    sourceModule: 'OPERATIONS',
    sourceDocumentType: 'FEED_ISSUE',
    sourceDocumentId: issue.id,
    journalNumber: `FEED-${issue.id.slice(0, 8)}`,
    journalDate: recordedOn,
    narration: 'Feed',
    companyId: fixture.companyId,
    branchId: fixture.branchId,
    financialYearId: fixture.financialYearId,
    financialPeriodId: fixture.periodIds[0]!,
    currencyId: fixture.currencyId,
    exchangeRate: '1',
    idempotencyKey: `feed:${issue.id}`,
    actor,
    lines: [
      {
        glAccountId: fixture.accounts['1501']!,
        description: 'Feed',
        debit: kobo(valueKobo),
        dimensions: dims(fixture, 0, { costCentreId: fixture.costCentreId, farmId: fixture.farmId }),
      },
      {
        glAccountId: fixture.accounts['1301']!,
        description: 'Feed out of store',
        credit: kobo(valueKobo),
        dimensions: dims(fixture, 0, { farmId: fixture.farmId }),
      },
    ],
  });
  await prisma.feedIssue.update({ where: { id: issue.id }, data: { journalEntryId: posted.journalEntryId } });
}

/** Posted balance of one account: debits less credits. */
async function balance(accountNumber: string) {
  const sum = await prisma.journalLine.aggregate({
    where: { glAccountId: fixture.accounts[accountNumber]!, journalEntry: { status: 'POSTED' } },
    _sum: { debitKobo: true, creditKobo: true },
  });
  return (sum._sum.debitKobo ?? 0n) - (sum._sum.creditKobo ?? 0n);
}

const JAN = new Date('2026-01-20');

describe('share — the weighted-average arithmetic', () => {
  it('takes the proportional share, rounded down to the kobo', () => {
    expect(share(1_000n, 1, 3)).toBe(333n);
    expect(share(900_000n, 30, 90)).toBe(300_000n);
  });

  it('gives the last animals out everything that is left', () => {
    expect(share(1_001n, 3, 3)).toBe(1_001n);
    expect(share(1_001n, 5, 3)).toBe(1_001n);
  });

  it('never relieves anything from an empty or zero-count population', () => {
    expect(share(0n, 10, 100)).toBe(0n);
    expect(share(500n, 0, 100)).toBe(0n);
  });
});

describe('RearingCostService — relief at weighted average', () => {
  it('writes the rearing cost of deaths to Production Loss, out of WIP', async () => {
    const group = await populationWithFeed('FLK-1', 100, 1_000_000n);

    const outcome = await rearing.relieve({
      companyId: fixture.companyId,
      groupId: group.id,
      event: 'MORTALITY',
      sourceId: randomUUID(),
      count: 10,
      populationBefore: 100,
      occurredOn: JAN,
      actor,
    });

    expect(outcome).toMatchObject({ amountKobo: 100_000n, posted: true });
    expect(await balance('5305')).toBe(100_000n);
    expect(await balance('1501')).toBe(900_000n);
    expect(await rearing.remaining(group.id)).toBe(900_000n);
  });

  it('sends a live sale\'s share to Cost of Sales, averaged over what was left', async () => {
    const group = await populationWithFeed('FLK-2', 100, 1_000_000n);
    await rearing.relieve({
      companyId: fixture.companyId, groupId: group.id, event: 'MORTALITY',
      sourceId: randomUUID(), count: 10, populationBefore: 100, occurredOn: JAN, actor,
    });

    const sale = await rearing.relieve({
      companyId: fixture.companyId, groupId: group.id, event: 'DISPOSAL',
      sourceId: randomUUID(), count: 30, populationBefore: 90, occurredOn: JAN, actor,
    });

    expect(sale.amountKobo).toBe(300_000n);
    expect(await balance('5001')).toBe(300_000n);
    expect(await rearing.remaining(group.id)).toBe(600_000n);
  });

  it('clears the population to exactly zero when the last animals leave', async () => {
    const group = await populationWithFeed('FLK-3', 3, 1_001n);
    // 1,001 over three birds: 333, then 334 of the 668 left, then the last 334.
    for (const populationBefore of [3, 2]) {
      await rearing.relieve({
        companyId: fixture.companyId, groupId: group.id, event: 'DISPOSAL',
        sourceId: randomUUID(), count: 1, populationBefore, occurredOn: JAN, actor,
      });
    }
    await rearing.relieve({
      companyId: fixture.companyId, groupId: group.id, event: 'MORTALITY',
      sourceId: randomUUID(), count: 1, populationBefore: 1, occurredOn: JAN, actor,
    });
    expect(await rearing.remaining(group.id)).toBe(0n);
  });

  it('never relieves the same event twice', async () => {
    const group = await populationWithFeed('FLK-4', 100, 1_000_000n);
    const sourceId = randomUUID();
    const input = {
      companyId: fixture.companyId, groupId: group.id, event: 'MORTALITY' as const,
      sourceId, count: 10, populationBefore: 100, occurredOn: JAN, actor,
    };

    await rearing.relieve(input);
    const again = await rearing.relieve(input);

    expect(again).toMatchObject({ amountKobo: 100_000n, posted: true });
    expect(await balance('5305')).toBe(100_000n);
    expect(await prisma.livestockRearingRelief.count({ where: { groupId: group.id } })).toBe(1);
  });

  it('holds a harvest\'s share for its processing order instead of posting it', async () => {
    const group = await populationWithFeed('FLK-5', 50, 500_000n);
    const harvestId = randomUUID();

    const outcome = await rearing.relieve({
      companyId: fixture.companyId, groupId: group.id, event: 'HARVEST',
      sourceId: harvestId, count: 50, populationBefore: 50, occurredOn: JAN, actor,
    });

    expect(outcome).toMatchObject({ amountKobo: 500_000n, posted: false });
    expect(await rearing.harvestShare(harvestId, group.id)).toBe(500_000n);
    // Still in WIP until the processing order issues it.
    expect(await balance('1501')).toBe(500_000n);
    expect(await rearing.remaining(group.id)).toBe(0n);
  });

  it('moves the share of animals kept back into the population they join, with no journal', async () => {
    const from = await populationWithFeed('FLK-6', 100, 1_000_000n);
    const to = await populationWithFeed('BRD-1', 20, 0n);
    const journalsBefore = await prisma.journalEntry.count();

    const moved = await rearing.transfer({
      companyId: fixture.companyId, fromGroupId: from.id, toGroupId: to.id,
      sourceId: randomUUID(), count: 25, populationBefore: 100, occurredOn: JAN,
    });

    expect(moved).toBe(250_000n);
    expect(await rearing.remaining(from.id)).toBe(750_000n);
    expect(await rearing.remaining(to.id)).toBe(250_000n);
    expect(await prisma.journalEntry.count()).toBe(journalsBefore);
  });

  it('counts only posted feed — unposted feed was never put into WIP', async () => {
    const group = await populationWithFeed('FLK-7', 10, 100_000n);
    const record = await prisma.dailyRecord.create({
      data: {
        companyId: fixture.companyId, groupId: group.id,
        recordedOn: new Date('2026-01-11'), recordedById: fixture.makerId,
      },
    });
    await prisma.feedIssue.create({
      data: { dailyRecordId: record.id, feedName: 'Not yet posted', quantityKg: '5', valueKobo: 999_999n },
    });

    expect(await rearing.remaining(group.id)).toBe(100_000n);
  });

  it('records a relief it cannot post, and posts it once a period covers it', async () => {
    const group = await populationWithFeed('FLK-8', 100, 1_000_000n);
    const outside = new Date('2031-06-15'); // no financial period covers this

    const outcome = await rearing.relieve({
      companyId: fixture.companyId, groupId: group.id, event: 'MORTALITY',
      sourceId: randomUUID(), count: 10, populationBefore: 100, occurredOn: outside, actor,
    });

    expect(outcome.posted).toBe(false);
    expect(outcome.reason).toMatch(/no open accounting period/i);
    // Taken out of the population all the same — the animals are gone.
    expect(await rearing.remaining(group.id)).toBe(900_000n);

    const pending = await rearing.postPending(fixture.companyId, actor);
    expect(pending.posted).toBe(0);
    expect(pending.failed).toBe(1);
  });
});
