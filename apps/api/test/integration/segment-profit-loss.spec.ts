import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ProfitLossService } from '../../src/reporting/profit-loss.service';
import { SegmentProfitLossService, type Statement } from '../../src/reporting/segment-profit-loss.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Segment profit or loss (S_/P_/ENTERPRISE_CONSOLIDATED_PL): farm, feed mill
 * and processing per product; the mill's feed to the farm shown and
 * eliminated; head-office costs shared; everything tying to the statutory
 * profit and loss.
 */

let prisma: PrismaService;
let posting: PostingService;
let segments: SegmentProfitLossService;
let profitLoss: ProfitLossService;
let fixture: TestFixture;
const account: Record<string, string> = {};
const pen: Record<string, string> = {};

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  profitLoss = new ProfitLossService(new TrialBalanceService(prisma));
  segments = new SegmentProfitLossService(prisma, profitLoss);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  for (const [number, name, type, normal] of [
    ['410100', 'Revenue — Live Snails', 'REVENUE', 'CREDIT'],
    ['410300', 'Revenue — Live Birds/Eggs', 'REVENUE', 'CREDIT'],
    ['410400', 'Revenue — Processed Poultry', 'REVENUE', 'CREDIT'],
    ['510300', 'COGS — Live Birds/Eggs', 'EXPENSE', 'DEBIT'],
    ['611000', 'Snail Feed and Medication Expense', 'EXPENSE', 'DEBIT'],
    ['520500', 'Feed Production Variance', 'EXPENSE', 'DEBIT'],
    ['620100', 'Payroll Expense', 'EXPENSE', 'DEBIT'],
    ['630100', 'Depreciation Expense', 'EXPENSE', 'DEBIT'],
  ] as const) {
    account[number] = (
      await prisma.gLAccount.create({ data: { companyId: fixture.companyId, accountNumber: number, name, accountType: type, normalBalance: normal } })
    ).id;
  }
  for (const [code, speciesKey] of [['L-1', 'poultry'], ['S-1', 'snail']] as const) {
    const house = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: `PEN-${code}`, name: code } });
    pen[speciesKey] = house.id;
    await prisma.livestockGroup.create({
      data: {
        companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: house.id, code, speciesKey,
        breed: 'Test', purpose: 'Growers', stage: 'Grower', openingPopulation: 100, population: 100, startedOn: new Date('2026-01-01'),
      },
    });
  }

  const line = (id: string, amount: { debit?: bigint; credit?: bigint }, over: Record<string, unknown> = {}) => ({
    glAccountId: id,
    description: 'Test',
    ...(amount.debit ? { debit: kobo(amount.debit) } : { credit: kobo(amount.credit!) }),
    dimensions: dims(fixture, 0, over),
  });
  await posting.post({
    sourceModule: 'test', sourceDocumentType: 'Test', journalNumber: 'SEG-1', journalDate: new Date('2026-01-15'),
    narration: 'A month on a mixed farm', ...dims(fixture, 0), idempotencyKey: 'seg-1',
    actor: { userId: fixture.makerId, roles: ['CFO'] },
    lines: [
      line(account['410100']!, { credit: 400_000n }), // snails sold
      line(account['410300']!, { credit: 1_000_000n }), // birds sold
      line(account['410400']!, { credit: 300_000n }), // dressed birds sold
      line(account['510300']!, { debit: 600_000n }),
      line(account['611000']!, { debit: 200_000n }, { penHouseId: pen.snail }), // snail feed, some of it milled
      line(account['520500']!, { debit: 10_000n }), // the mill's variance — no species
      line(account['620100']!, { debit: 250_000n }), // office wages — shared
      line(account['630100']!, { debit: 100_000n }), // shared
      line(fixture.accounts['1101']!, { debit: 540_000n }),
    ],
  });

  // The mill made snail mash; ₦500 of it went out on a snail round in January.
  const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'KG', name: 'Kilogram' } });
  const mash = await prisma.item.create({ data: { companyId: fixture.companyId, code: 'SNAIL-MASH', description: 'Snail mash (milled)', unitOfMeasureId: uom.id, isBiologicalFeed: true } });
  const recipe = await prisma.productRecipe.create({ data: { companyId: fixture.companyId, code: 'R-MASH', name: 'Snail mash', outputItemId: mash.id } });
  const version = await prisma.productRecipeVersion.create({ data: { recipeId: recipe.id, version: 1, batchSize: '100', effectiveFrom: new Date('2026-01-01') } });
  const order = await prisma.productionOrder.create({
    data: {
      companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, orderNumber: 'FM-001', recipeVersionId: version.id,
      plannedOutputQuantity: '100', createdById: fixture.makerId, processingCycle: 'FEED_MILL',
    },
  });
  await prisma.productionOrderOutput.create({
    data: { productionOrderId: order.id, itemId: mash.id, outputType: 'MAIN', quantity: '100', allocationWeightKobo: 0n, allocatedCostKobo: 0n },
  });
  const warehouse = await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'FEED', name: 'Feed store', type: 'RAW_MATERIAL' } });
  const snailGroup = await prisma.livestockGroup.findFirstOrThrow({ where: { code: 'S-1' } });
  const round = await prisma.dailyRecord.create({ data: { companyId: fixture.companyId, groupId: snailGroup.id, recordedOn: new Date('2026-01-12'), recordedById: fixture.makerId } });
  const issue = await prisma.feedIssue.create({ data: { dailyRecordId: round.id, feedName: 'Snail mash', quantityKg: '10', itemId: mash.id } });
  await prisma.stockMovement.create({
    data: {
      companyId: fixture.companyId, branchId: fixture.branchId, itemId: mash.id, warehouseId: warehouse.id, direction: 'OUT', quantity: '10',
      unitCostKobo: 5_000n, valueKobo: 50_000n, sourceModule: 'OPERATIONS', sourceDocumentType: 'FEED_ISSUE', sourceDocumentId: issue.id,
      documentReference: 'FEED-1', movementDate: new Date('2026-01-12'),
    },
  });
});

const row = (s: Statement, key: string) => s.rows.find((r) => r.key === key)!.amounts;

describe('SegmentProfitLossService', () => {
  it('shows each product by farm, feed mill and processing, with the mill’s feed eliminated', async () => {
    const report = await segments.build({ companyId: fixture.companyId, financialYearId: fixture.financialYearId });
    const snail = report.products.snail;
    expect(snail.columns).toEqual(['Snailery', 'Feed mill', 'Processing', 'Eliminations', 'Consolidated']);
    //                                                 Snailery   Mill      Proc  Elim       Cons
    expect(row(snail, 'externalRevenue')).toEqual(['400000', '0', '0', '0', '400000']);
    expect(row(snail, 'internalFeedRevenue')).toEqual(['0', '50000', '0', '-50000', '0']);
    expect(row(snail, 'internalFeedCost')).toEqual(['50000', '0', '0', '-50000', '0']);
    expect(row(snail, 'milledFeedIncluded')).toEqual(['-50000', '0', '0', '0', '-50000']);
    expect(row(snail, 'feedMillProductionCost')).toEqual(['0', '50000', '0', '0', '50000']);
    expect(row(snail, 'feedMedication')).toEqual(['200000', '0', '0', '0', '200000']);
    expect(row(snail, 'profitBeforeTax')).toEqual(['200000', '0', '0', '0', '200000']);

    const poultry = report.products.poultry;
    expect(row(poultry, 'externalRevenue')).toEqual(['1000000', '0', '300000', '0', '1300000']);
    expect(row(poultry, 'profitBeforeTax')).toEqual(['400000', '0', '300000', '0', '700000']);

    // Snail | Poultry | Shared | Enterprise eliminations | Consolidated
    expect(row(report.enterprise, 'profitBeforeTax')).toEqual(['200000', '700000', '-360000', '0', '540000']);
    expect(report.internalFeedKobo).toEqual({ snail: '50000', poultry: '0' });
  });

  it('passes its release checks: the consolidated result is the statutory one, and internal feed nets to nothing', async () => {
    const report = await segments.build({ companyId: fixture.companyId, financialYearId: fixture.financialYearId });
    expect(report.checks.every((c) => c.status === 'PASS')).toBe(true);
    const statutory = await profitLoss.build({ companyId: fixture.companyId, financialYearId: fixture.financialYearId });
    expect(row(report.enterprise, 'profitBeforeTax')[4]).toBe(statutory.profitBeforeTaxKobo);
  });

  it('counts only the period asked for', async () => {
    const february = await segments.build({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[1]! });
    expect(february.internalFeedKobo).toEqual({ snail: '0', poultry: '0' });
    expect(row(february.enterprise, 'profitBeforeTax')[4]).toBe('0');
    expect(february.checks.every((c) => c.status === 'PASS')).toBe(true);
  });
});
