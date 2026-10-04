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
 * Poultry rearing cost on the approved five-digit chart is held by the flock's
 * stage on the day it is posted — 16032 immature, 16042 mature — and relieved
 * from whichever accounts hold it, so every stage account clears to exactly
 * zero when the last bird leaves.
 */

let prisma: PrismaService;
let rearing: RearingCostService;
let operations: OperationsPostingService;
let assets: BiologicalAssetService;
let fixture: TestFixture;
let actor: { userId: string; roles: string[] };
let groupId: string;
const ledger = new Map<string, string>();

beforeAll(() => {
  prisma = new PrismaService();
  const posting = new PostingService(
    prisma,
    new AuditService(prisma),
    new IdempotencyService(prisma),
    new PeriodService(prisma),
    new DimensionValidatorService(prisma),
  );
  rearing = new RearingCostService(prisma, posting);
  operations = new OperationsPostingService(prisma, posting, rearing, new StockMovementService(prisma));
  const audit = new AuditService(prisma);
  const workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  assets = new BiologicalAssetService(prisma, posting, workflow, audit, rearing);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  actor = { userId: fixture.makerId, roles: ['FARM_MANAGER'] };
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'APPROVED' } });

  // The workbook's accounts: the two livestock stages and feed inventory are
  // control accounts (no direct journals), mortality loss and cost of sales post.
  const accounts: Array<[string, string, 'ASSET' | 'EXPENSE' | 'REVENUE', 'DEBIT' | 'CREDIT', boolean]> = [
    ['16032', 'Poultry biological assets - immature', 'ASSET', 'DEBIT', true],
    ['16042', 'Poultry biological assets - mature', 'ASSET', 'DEBIT', true],
    ['12100', 'Feed ingredients inventory control', 'ASSET', 'DEBIT', true],
    ['12000', 'Raw materials inventory control', 'ASSET', 'DEBIT', true],
    ['51120', 'Abnormal poultry mortality loss', 'EXPENSE', 'DEBIT', false],
    ['50310', 'Cost of sales - live poultry', 'EXPENSE', 'DEBIT', false],
    // Where a valuation's gain is credited on the approved chart, and its loss debited.
    ['42000', 'Fair value gain on biological assets', 'REVENUE', 'CREDIT', false],
    ['42100', 'Fair value loss on biological assets', 'EXPENSE', 'DEBIT', false],
  ];
  ledger.clear();
  for (const [accountNumber, name, accountType, normalBalance, control] of accounts) {
    const account = await prisma.gLAccount.create({
      data: { companyId: fixture.companyId, accountNumber, name, accountType, normalBalance, isControlAccount: control, isPostingAccount: !control },
    });
    ledger.set(accountNumber, account.id);
  }

  await prisma.workflowDefinition.create({
    data: {
      companyId: fixture.companyId, transactionType: 'BA_VALUATION', name: 'Valuation route', effectiveFrom: new Date('2026-01-01'),
      steps: { create: [{ level: 1, roleCode: 'CFO', name: 'CFO', maxAmountKobo: null }] },
    },
  });

  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'PEN-1', name: 'Pen 1' } });
  const group = await prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId,
      branchId: fixture.branchId,
      farmId: fixture.farmId,
      penHouseId: pen.id,
      code: 'L-001',
      speciesKey: 'poultry',
      breed: 'Test',
      purpose: 'Broiler',
      stage: 'Chick',
      openingPopulation: 100,
      population: 100,
      startedOn: new Date('2026-01-01'),
    },
  });
  groupId = group.id;
});

async function feed(valueKobo: bigint, on: Date) {
  const record = await prisma.dailyRecord.create({
    data: { companyId: fixture.companyId, groupId, recordedOn: on, recordedById: fixture.makerId },
  });
  await prisma.feedIssue.create({ data: { dailyRecordId: record.id, feedName: 'Mash', quantityKg: '10', valueKobo } });
  const outcome = await operations.postFeedIssues({ companyId: fixture.companyId, dailyRecordId: record.id, actor });
  expect(outcome.skipped).toEqual([]);
  expect(outcome.posted).toBe(1);
}

async function balance(accountNumber: string) {
  const sum = await prisma.journalLine.aggregate({
    where: { glAccountId: ledger.get(accountNumber)!, journalEntry: { status: 'POSTED' } },
    _sum: { debitKobo: true, creditKobo: true },
  });
  return (sum._sum.debitKobo ?? 0n) - (sum._sum.creditKobo ?? 0n);
}

async function heldByAccount() {
  return Object.fromEntries([...(await rearing.remainingByAccount(groupId))].map(([a, v]) => [a, v]));
}

/** The flock fed as chicks (₦10,000), then as layers (₦30,000). */
async function fedInTwoStages() {
  await feed(1_000_000n, new Date('2026-01-10'));
  await prisma.livestockGroup.update({ where: { id: groupId }, data: { stage: 'Layer' } });
  await feed(3_000_000n, new Date('2026-02-10'));
}

describe('rearing cost held by stage on the approved chart', () => {
  it('posts each feed to the account of the flock’s stage that day and records it', async () => {
    await fedInTwoStages();
    expect(await balance('16032')).toBe(1_000_000n);
    expect(await balance('16042')).toBe(3_000_000n);
    expect(await balance('12100')).toBe(-4_000_000n);
    expect(await heldByAccount()).toEqual({ '16032': 1_000_000n, '16042': 3_000_000n });
    const issues = await prisma.feedIssue.findMany({ orderBy: { dailyRecord: { recordedOn: 'asc' } }, select: { rearingAccountNumber: true } });
    expect(issues.map((i) => i.rearingAccountNumber)).toEqual(['16032', '16042']);
  });

  it('relieves a death from both stage accounts in proportion, and balances', async () => {
    await fedInTwoStages();
    const mortality = await rearing.relieve({
      companyId: fixture.companyId, groupId, event: 'MORTALITY', sourceId: crypto.randomUUID(),
      count: 10, populationBefore: 100, occurredOn: new Date('2026-02-20'), actor,
    });
    expect(mortality).toMatchObject({ amountKobo: 400_000n, posted: true });
    expect(await balance('51120')).toBe(400_000n);
    expect(await balance('16032')).toBe(900_000n);
    expect(await balance('16042')).toBe(2_700_000n);
    const relief = await prisma.livestockRearingRelief.findFirstOrThrow({ include: { splits: true } });
    expect(relief.splits.reduce((sum, s) => sum + s.amountKobo, 0n)).toBe(relief.amountKobo);
    expect(await heldByAccount()).toEqual({ '16032': 900_000n, '16042': 2_700_000n });
  });

  it('clears every stage account to exactly zero when the last birds leave', async () => {
    await fedInTwoStages();
    const on = new Date('2026-02-20');
    await rearing.relieve({ companyId: fixture.companyId, groupId, event: 'MORTALITY', sourceId: crypto.randomUUID(), count: 10, populationBefore: 100, occurredOn: on, actor });
    const sale = await rearing.relieve({ companyId: fixture.companyId, groupId, event: 'DISPOSAL', sourceId: crypto.randomUUID(), count: 30, populationBefore: 90, occurredOn: on, actor });
    expect(sale).toMatchObject({ amountKobo: 1_200_000n, posted: true });
    expect(await balance('50310')).toBe(1_200_000n);
    expect(await heldByAccount()).toEqual({ '16032': 600_000n, '16042': 1_800_000n });
    await rearing.relieve({ companyId: fixture.companyId, groupId, event: 'DISPOSAL', sourceId: crypto.randomUUID(), count: 60, populationBefore: 60, occurredOn: on, actor });
    expect(await balance('16032')).toBe(0n);
    expect(await balance('16042')).toBe(0n);
    expect(await balance('50310')).toBe(2_400_000n + 1_200_000n);
    expect(await rearing.remaining(groupId)).toBe(0n);
  });

  it('is idempotent: relieving the same death twice takes nothing more', async () => {
    await fedInTwoStages();
    const params = { companyId: fixture.companyId, groupId, event: 'MORTALITY' as const, sourceId: crypto.randomUUID(), count: 10, populationBefore: 100, occurredOn: new Date('2026-02-20'), actor };
    await rearing.relieve(params);
    await rearing.relieve(params);
    expect(await balance('16032')).toBe(900_000n);
    expect(await balance('16042')).toBe(2_700_000n);
  });

  it('carries a transfer’s split to the receiving flock without a journal', async () => {
    await fedInTwoStages();
    const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'PEN-2', name: 'Pen 2' } });
    const other = await prisma.livestockGroup.create({
      data: {
        companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: pen.id, code: 'L-002',
        speciesKey: 'poultry', breed: 'Test', purpose: 'Broiler', stage: 'Layer', openingPopulation: 0, population: 0, startedOn: new Date('2026-02-01'),
      },
    });
    const moved = await rearing.transfer({
      companyId: fixture.companyId, fromGroupId: groupId, toGroupId: other.id, sourceId: crypto.randomUUID(),
      count: 50, populationBefore: 100, occurredOn: new Date('2026-02-20'),
    });
    expect(moved).toBe(2_000_000n);
    expect(await heldByAccount()).toEqual({ '16032': 500_000n, '16042': 1_500_000n });
    expect(Object.fromEntries(await rearing.remainingByAccount(other.id))).toEqual({ '16032': 500_000n, '16042': 1_500_000n });
    // Attribution only: the ledger did not move.
    expect(await balance('16032')).toBe(1_000_000n);
    expect(await balance('16042')).toBe(3_000_000n);
  });

  it('refuses to guess a stage account for a stage the chart does not classify', async () => {
    await prisma.livestockGroup.update({ where: { id: groupId }, data: { stage: 'Egg' } });
    const record = await prisma.dailyRecord.create({
      data: { companyId: fixture.companyId, groupId, recordedOn: new Date('2026-01-10'), recordedById: fixture.makerId },
    });
    await prisma.feedIssue.create({ data: { dailyRecordId: record.id, feedName: 'Mash', quantityKg: '10', valueKobo: 100_000n } });
    await expect(operations.postFeedIssues({ companyId: fixture.companyId, dailyRecordId: record.id, actor })).rejects.toThrow(/Egg/);
  });

  it('moves cost held in the other stage into the account fair value sits in at a valuation', async () => {
    await fedInTwoStages();
    // ₦1,000 a bird × 100 = ₦100,000; carrying = nothing valued yet + ₦40,000 of feed held, so the gain is ₦60,000.
    const cfo = { userId: fixture.makerId, roles: ['CFO'] };
    const { id } = await assets.requestValuation({
      companyId: fixture.companyId, groupId, valuationDate: new Date('2026-02-28'), marketPricePerUnitKobo: 100_000n,
      costsToSellPerUnitKobo: 0n, evidenceReference: 'Market survey', actor: cfo,
    });
    expect(await prisma.biologicalAssetValuation.findUniqueOrThrow({ where: { id } })).toMatchObject({
      stage: 'Layer', direction: 'GAIN', gainLossKobo: 6_000_000n, rearingCostAbsorbedKobo: 4_000_000n,
    });

    await prisma.$transaction((tx) => assets.postApprovedValuation({ valuationId: id, actor: cfo, tx }));

    // Mature account: ₦30,000 of feed + ₦60,000 gain + ₦10,000 moved in from immature = exactly 100 × ₦1,000.
    expect(await balance('16042')).toBe(10_000_000n);
    expect(await balance('16032')).toBe(0n);
    expect(await balance('42000')).toBe(-6_000_000n);
    expect(await rearing.remaining(groupId)).toBe(0n);
    expect(await heldByAccount()).toEqual({ '16032': 0n, '16042': 0n });
    const revalued = await prisma.livestockRearingRelief.findFirstOrThrow({ where: { eventType: 'REVALUED' }, include: { splits: true } });
    expect(revalued.splits.map((x) => [x.accountNumber, x.amountKobo]).sort()).toEqual([['16032', 1_000_000n], ['16042', 3_000_000n]]);
  });
});
