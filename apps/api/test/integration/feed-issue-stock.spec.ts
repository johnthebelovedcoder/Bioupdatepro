import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
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
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ControlAccountReconciliationService } from '../../src/reporting/control-account-reconciliation.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Feed that is a stock item leaves the store when it is posted, so Raw
 * Materials in the ledger and the store's own records can never disagree —
 * the ₦2,250 variance production showed on 2026-09-24 came from feed posted
 * to 1301 with no stock movement behind it.
 */

let prisma: PrismaService;
let posting: PostingService;
let rearing: RearingCostService;
let stock: StockMovementService;
let operations: OperationsPostingService;
let reconciliation: ControlAccountReconciliationService;
let fixture: TestFixture;
let actor: { userId: string; roles: string[] };
let itemId: string;
let warehouseId: string;
let groupId: string;

const ON = new Date('2026-01-10');

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  rearing = new RearingCostService(prisma, posting);
  stock = new StockMovementService(prisma);
  operations = new OperationsPostingService(prisma, posting, rearing, stock);
  reconciliation = new ControlAccountReconciliationService(prisma, new TrialBalanceService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  actor = { userId: fixture.makerId, roles: ['FARM_MANAGER'] };

  const kg = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'KG', name: 'Kilogram' } });
  const store = await prisma.warehouse.create({
    data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'RAW-WH', name: 'Feed & Supplies Store', type: 'RAW_MATERIAL' },
  });
  warehouseId = store.id;
  const item = await prisma.item.create({
    data: {
      companyId: fixture.companyId,
      code: 'CHICK-MASH',
      description: 'Chick Mash',
      unitOfMeasureId: kg.id,
      inventoryGlAccountId: fixture.accounts['1301']!,
      defaultWarehouseId: store.id,
    },
  });
  itemId = item.id;

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
      stage: 'Brooding',
      openingPopulation: 100,
      population: 100,
      startedOn: new Date('2026-01-01'),
    },
  });
  groupId = group.id;
});

/** A round that fed 5 kg of Chick Mash, priced at the item's standard ₦450/kg. */
async function feedRound() {
  const record = await prisma.dailyRecord.create({
    data: { companyId: fixture.companyId, groupId, recordedOn: ON, recordedById: fixture.makerId },
  });
  const issue = await prisma.feedIssue.create({
    data: { dailyRecordId: record.id, itemId, feedName: 'Chick Mash', quantityKg: '5', unitCostKobo: 45000n, valueKobo: 225000n },
  });
  return { recordId: record.id, issueId: issue.id };
}

/** 10 kg received into the store for ₦4,000 — ₦400/kg — and posted Dr 1301 / Cr Bank. */
async function receiveTenKilos() {
  await prisma.$transaction(async (tx) => {
    const journal = await posting.post(
      {
        sourceModule: 'TEST',
        sourceDocumentType: 'RECEIPT',
        sourceDocumentId: 'receipt-1',
        journalNumber: 'GRN-1',
        journalDate: ON,
        narration: 'Chick Mash received',
        companyId: fixture.companyId,
        branchId: fixture.branchId,
        financialYearId: fixture.financialYearId,
        financialPeriodId: fixture.periodIds[0]!,
        currencyId: fixture.currencyId,
        exchangeRate: '1',
        idempotencyKey: 'grn-1',
        actor,
        lines: [
          { glAccountId: fixture.accounts['1301']!, description: 'Chick Mash in', debit: kobo(400000n), dimensions: dims(fixture, 0) },
          { glAccountId: fixture.accounts['1101']!, description: 'Paid', credit: kobo(400000n), dimensions: dims(fixture, 0) },
        ],
      },
      tx,
    );
    await stock.receiveIn({
      tx,
      companyId: fixture.companyId,
      branchId: fixture.branchId,
      itemId,
      warehouseId,
      quantity: new Decimal(10),
      valueKobo: 400000n,
      sourceModule: 'TEST',
      sourceDocumentType: 'RECEIPT',
      sourceDocumentId: 'receipt-1',
      documentReference: 'GRN-1',
      movementDate: ON,
      journalEntryId: journal.journalEntryId,
    });
  });
}

const rawMaterials = async () => (await reconciliation.reconcile(fixture.companyId)).find((row) => row.accountNumber === '1301')!;

describe('Feed issued from stock', () => {
  it('takes the feed out of the store at average cost and posts exactly that', async () => {
    await receiveTenKilos();
    const { recordId, issueId } = await feedRound();

    const outcome = await operations.postFeedIssues({ companyId: fixture.companyId, dailyRecordId: recordId, actor });
    expect(outcome).toEqual({ posted: 1, skipped: [] });

    const issue = await prisma.feedIssue.findUniqueOrThrow({ where: { id: issueId } });
    // Valued by the store (₦400/kg), not the ₦450 standard typed on the round.
    expect(issue.valueKobo).toBe(200000n);
    expect(issue.unitCostKobo).toBe(40000n);

    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { sourceDocumentId: issueId } });
    expect(movement.direction).toBe('OUT');
    expect(movement.valueKobo).toBe(200000n);
    expect(movement.sourceDocumentType).toBe('FEED_ISSUE');

    const lines = await prisma.journalLine.findMany({ where: { journalEntryId: issue.journalEntryId! } });
    expect(lines.find((l) => l.glAccountId === fixture.accounts['1501'])?.debitKobo).toBe(200000n);
    expect(lines.find((l) => l.glAccountId === fixture.accounts['1301'])?.creditKobo).toBe(200000n);

    const row = await rawMaterials();
    expect(row.reconciled).toBe(true);
    expect(row.glBalanceKobo).toBe('200000');
  });

  it('keeps the round but posts nothing when the store has never received the feed', async () => {
    const { recordId, issueId } = await feedRound();

    const outcome = await operations.postFeedIssues({ companyId: fixture.companyId, dailyRecordId: recordId, actor });
    expect(outcome.posted).toBe(0);
    expect(outcome.skipped.join(' ')).toMatch(/nothing has ever been received/);

    expect((await prisma.feedIssue.findUniqueOrThrow({ where: { id: issueId } })).journalEntryId).toBeNull();
    expect(await prisma.stockMovement.count({ where: { companyId: fixture.companyId } })).toBe(0);
    expect((await rawMaterials()).varianceKobo).toBe('0');

    // Once the feed is received, the waiting round posts from the backlog.
    await receiveTenKilos();
    const backlog = await operations.postBacklog({ companyId: fixture.companyId, actor });
    expect(backlog.feedIssues).toEqual({ posted: 1, failed: 0 });
    expect((await rawMaterials()).reconciled).toBe(true);
  });

  it('posts only once, however many times it runs', async () => {
    await receiveTenKilos();
    const { recordId } = await feedRound();
    await operations.postFeedIssues({ companyId: fixture.companyId, dailyRecordId: recordId, actor });
    const again = await operations.postFeedIssues({ companyId: fixture.companyId, dailyRecordId: recordId, actor });
    expect(again).toEqual({ posted: 0, skipped: [] });
    expect(await prisma.stockMovement.count({ where: { direction: 'OUT' } })).toBe(1);
  });

  it('no longer counts a reversed feed journal as rearing cost', async () => {
    await receiveTenKilos();
    const { recordId, issueId } = await feedRound();
    await operations.postFeedIssues({ companyId: fixture.companyId, dailyRecordId: recordId, actor });
    expect(await rearing.remaining(groupId)).toBe(200000n);

    const issue = await prisma.feedIssue.findUniqueOrThrow({ where: { id: issueId } });
    await posting.reverse(issue.journalEntryId!, {
      journalNumber: 'REV-FEED',
      journalDate: ON,
      narration: 'Test round',
      financialYearId: fixture.financialYearId,
      financialPeriodId: fixture.periodIds[0]!,
      idempotencyKey: 'rev-feed',
      actor,
    });
    expect(await rearing.remaining(groupId)).toBe(0n);
  });
});
