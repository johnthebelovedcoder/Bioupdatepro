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
import { FarmCostAllocationService, split } from '../../src/cost-allocation/farm-cost-allocation.service';
import { PoultryEggService } from '../../src/poultry-egg/poultry-egg.service';
import { EggPostingService } from '../../src/poultry-egg/egg-posting.service';
import { FixedAssetService } from '../../src/fixed-assets/fixed-asset.service';
import type { WorkflowService } from '../../src/workflow/workflow.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ControlAccountReconciliationService } from '../../src/reporting/control-account-reconciliation.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * The last five posting rules the Controls page showed as blocked, built to
 * the farm's answers of 2026-09-24:
 *   PCR-028/043/064  labour and overhead shared by animal-days
 *   PCR-031          each machine's depreciation to its processing line
 *   PCR-067          eggs recognised at a dated value per crate (with 068/069)
 */

let prisma: PrismaService;
let posting: PostingService;
let rearing: RearingCostService;
let allocation: FarmCostAllocationService;
let eggs: PoultryEggService;
let eggPostings: EggPostingService;
let assets: FixedAssetService;
let reconciliation: ControlAccountReconciliationService;
let fixture: TestFixture;
let actor: { userId: string; roles: string[] };
const account: Record<string, string> = {};

const JANUARY = 0;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  rearing = new RearingCostService(prisma, posting);
  allocation = new FarmCostAllocationService(prisma, posting, audit);
  eggs = new PoultryEggService(prisma, new IdempotencyService(prisma));
  eggPostings = new EggPostingService(prisma, posting, new StockMovementService(prisma), audit);
  assets = new FixedAssetService(prisma, audit, posting, {} as WorkflowService);
  reconciliation = new ControlAccountReconciliationService(prisma, new TrialBalanceService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  actor = { userId: fixture.makerId, roles: ['CFO'] };
  for (const [number, name, type, normal] of [
    ['5101', 'Salaries and Wages', 'EXPENSE', 'DEBIT'],
    ['5501', 'Depreciation Expense', 'EXPENSE', 'DEBIT'],
    ['1702', 'Accumulated Depreciation', 'ASSET', 'CREDIT'],
    ['612000', 'Snailery Labour and Facility Expense', 'EXPENSE', 'DEBIT'],
    ['622100', 'Poultry Processing Conversion Expense', 'EXPENSE', 'DEBIT'],
    ['130210', 'Biological Assets — Poultry', 'ASSET', 'DEBIT'],
    ['130215', 'BA/Inventory — Eggs', 'ASSET', 'DEBIT'],
    ['130216', 'BA/WIP — Eggs in Incubation', 'ASSET', 'DEBIT'],
    ['420210', 'Agricultural Produce Gain — Eggs', 'REVENUE', 'CREDIT'],
  ] as const) {
    const created = await prisma.gLAccount.create({
      data: { companyId: fixture.companyId, accountNumber: number, name, accountType: type, normalBalance: normal },
    });
    account[number] = created.id;
  }
});

async function population(code: string, speciesKey: 'poultry' | 'snail', animals: number, startedOn = new Date('2026-01-01')) {
  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: `PEN-${code}`, name: `Pen ${code}` } });
  return prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId,
      branchId: fixture.branchId,
      farmId: fixture.farmId,
      penHouseId: pen.id,
      code,
      speciesKey,
      breed: 'Test',
      purpose: speciesKey === 'poultry' ? 'Layers' : 'Growers',
      stage: speciesKey === 'poultry' ? 'Layer' : 'Grower',
      openingPopulation: animals,
      population: animals,
      startedOn,
    },
  });
}

/** Salaries of `amount` kobo accrued in January: Dr 5101 / Cr Bank. */
async function salaries(amount: bigint) {
  await posting.post({
    sourceModule: 'TEST',
    sourceDocumentType: 'PAYROLL',
    sourceDocumentId: 'payroll-jan',
    journalNumber: 'PAY-JAN',
    journalDate: new Date('2026-01-31'),
    narration: 'January payroll',
    companyId: fixture.companyId,
    branchId: fixture.branchId,
    financialYearId: fixture.financialYearId,
    financialPeriodId: fixture.periodIds[JANUARY]!,
    currencyId: fixture.currencyId,
    exchangeRate: '1',
    idempotencyKey: 'pay-jan',
    actor,
    lines: [
      { glAccountId: account['5101']!, description: 'Salaries', debit: kobo(amount), dimensions: dims(fixture, JANUARY) },
      { glAccountId: fixture.accounts['1101']!, description: 'Paid', credit: kobo(amount), dimensions: dims(fixture, JANUARY) },
    ],
  });
}

describe('Farm labour and overhead by animal-days (PCR-028/043/064)', () => {
  it('splits by animals × days, rebuilding the population from the deaths recorded', async () => {
    const layers = await population('L-A', 'poultry', 100);
    await population('L-B', 'poultry', 300);
    await population('S-A', 'snail', 600);
    // Ten layers died on 16 January: 110 a day for 15 days, then 100 for 16.
    const round = await prisma.dailyRecord.create({
      data: { companyId: fixture.companyId, groupId: layers.id, recordedOn: new Date('2026-01-16'), recordedById: fixture.makerId },
    });
    await prisma.mortalityRecord.create({ data: { dailyRecordId: round.id, quantity: 10 } });

    const shares = await allocation.preview(fixture.companyId, fixture.periodIds[JANUARY]!, 1_000_000n);
    const byCode = Object.fromEntries(shares.map((s) => [s.code, s]));
    expect(byCode['L-A']!.animalDays.toNumber()).toBe(15 * 110 + 16 * 100);
    expect(byCode['L-B']!.animalDays.toNumber()).toBe(31 * 300);
    expect(byCode['S-A']!.animalDays.toNumber()).toBe(31 * 600);
    expect(shares.reduce((sum, s) => sum + s.amountKobo, 0n)).toBe(1_000_000n);
  });

  it('posts flocks into Work in Progress, snails to 612000, and takes it out of salaries', async () => {
    const layers = await population('L-A', 'poultry', 100);
    await population('S-A', 'snail', 300);
    await salaries(400_000n);

    const [source] = await allocation.sources(fixture.companyId, fixture.periodIds[JANUARY]!);
    expect(source).toMatchObject({ glAccountId: account['5101'], availableKobo: 400_000n });

    const result = await allocation.post({
      companyId: fixture.companyId,
      financialPeriodId: fixture.periodIds[JANUARY]!,
      sources: [{ glAccountId: account['5101']!, amountKobo: 400_000n }],
      actor,
    });
    expect(result.populations).toBe(2);

    const lines = await prisma.journalLine.findMany({
      where: { journalEntry: { journalNumber: result.journalNumber } },
    });
    const amount = (id: string, side: 'debitKobo' | 'creditKobo') =>
      lines.filter((l) => l.glAccountId === id).reduce((s, l) => s + l[side], 0n);
    // 100 birds vs 300 snails over the same 31 days: a quarter and three quarters.
    expect(amount(fixture.accounts['1501']!, 'debitKobo')).toBe(100_000n);
    expect(amount(account['612000']!, 'debitKobo')).toBe(300_000n);
    expect(amount(account['5101']!, 'creditKobo')).toBe(400_000n);

    // The flock's share is now part of its rearing cost.
    expect(await rearing.remaining(layers.id)).toBe(100_000n);
    // And the salaries are fully allocated — nothing left to allocate twice.
    expect(await allocation.sources(fixture.companyId, fixture.periodIds[JANUARY]!)).toEqual([]);
  });

  it('refuses to allocate more than the account carries', async () => {
    await population('L-A', 'poultry', 100);
    await salaries(50_000n);
    await expect(
      allocation.post({
        companyId: fixture.companyId,
        financialPeriodId: fixture.periodIds[JANUARY]!,
        sources: [{ glAccountId: account['5101']!, amountKobo: 50_001n }],
        actor,
      }),
    ).rejects.toThrow(/Only ₦500.00 is left/);
  });

  it('splits whole kobo so the shares always add up', () => {
    const rows = ['A', 'B', 'C'].map((code) => ({ groupId: code, code, speciesKey: 'poultry', animalDays: new Decimal(1) }));
    expect(split(rows, 100n).map((r) => r.amountKobo)).toEqual([34n, 33n, 33n]);
  });
});

describe('Eggs at a dated value per crate (PCR-067/068/069)', () => {
  let itemId: string;
  let layersId: string;

  beforeEach(async () => {
    const crate = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'CRATE', name: 'Crate of 30' } });
    const store = await prisma.warehouse.create({
      data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'FG-WH', name: 'Produce Store' },
    });
    const item = await prisma.item.create({
      data: { companyId: fixture.companyId, code: 'EGGS', description: 'Table eggs', unitOfMeasureId: crate.id, defaultWarehouseId: store.id },
    });
    itemId = item.id;
    layersId = (await population('L-EGG', 'poultry', 500)).id;
  });

  const collect = (code: string, table: number, hatching: number, reject: number) =>
    eggs.recordCollection({
      companyId: fixture.companyId,
      sourceGroupId: layersId,
      code,
      collectedOn: new Date('2026-01-10'),
      hatchingCount: hatching,
      tableCount: table,
      rejectCount: reject,
      recordedById: fixture.makerId,
      idempotencyKey: `collect-${code}`,
    });

  it('waits with a reason until a value is set, then posts from the backlog', async () => {
    const batch = await collect('E-1', 30, 0, 0);
    expect(await eggPostings.postCollection(batch.id, actor)).toMatchObject({ posted: false, reason: expect.stringMatching(/No egg value is set/) });

    await eggPostings.setPolicy({
      companyId: fixture.companyId, itemId, eggsPerUnit: 30, valuePerUnitKobo: 150_000n, effectiveFrom: new Date('2026-01-01'), actor,
    });
    expect(await eggPostings.postPending(fixture.companyId, actor)).toMatchObject({ posted: 1, failed: 0 });
  });

  it('collects, sets and hatches, carrying the value through to the chicks', async () => {
    await eggPostings.setPolicy({
      companyId: fixture.companyId, itemId, eggsPerUnit: 30, valuePerUnitKobo: 150_000n, effectiveFrom: new Date('2026-01-01'), actor,
    });

    // 30 table + 30 hatching = 2 crates at ₦1,500; the 5 rejects are worth nothing.
    const batch = await collect('E-2', 30, 30, 5);
    expect(await eggPostings.postCollection(batch.id, actor)).toEqual({ posted: true });
    const valued = await prisma.eggCollectionBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(valued.valueKobo).toBe(300_000n);

    const incubation = await eggs.setIncubation({
      companyId: fixture.companyId, eggBatchId: batch.id, code: 'INC-1', setOn: new Date('2026-01-11'),
      setQuantity: 30, recordedById: fixture.makerId, idempotencyKey: 'inc-1',
    });
    expect(await eggPostings.postIncubation(incubation.id, actor)).toEqual({ posted: true });
    expect((await prisma.incubationBatch.findUniqueOrThrow({ where: { id: incubation.id } })).valueKobo).toBe(150_000n);

    const hatch = await eggs.recordHatch({
      companyId: fixture.companyId, incubationBatchId: incubation.id, hatchedOn: new Date('2026-01-31'),
      hatchedCount: 25, unhatchedCount: 5, damagedCount: 0, chickGroupCode: 'C-1', recordedById: fixture.makerId, idempotencyKey: 'hatch-1',
    });
    expect(await eggPostings.postHatch(hatch.id, actor)).toEqual({ posted: true });
    const chicks = await prisma.livestockGroup.findUniqueOrThrow({ where: { id: hatch.chickGroupId! } });
    expect(chicks.acquisitionCostKobo).toBe(150_000n);

    const balance = async (id: string) => {
      const sums = await prisma.journalLine.aggregate({ where: { glAccountId: id }, _sum: { debitKobo: true, creditKobo: true } });
      return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
    };
    expect(await balance(account['420210']!)).toBe(-300_000n); // the gain
    expect(await balance(account['130215']!)).toBe(150_000n); // one crate still in stock
    expect(await balance(account['130216']!)).toBe(0n); // incubation cleared
    expect(await balance(account['130210']!)).toBe(150_000n); // the chicks

    // The eggs account agrees with the eggs in stock.
    const eggsRow = (await reconciliation.reconcile(fixture.companyId)).find((r) => r.accountNumber === '130215')!;
    expect(eggsRow.reconciled).toBe(true);
  });
});

describe('Machine depreciation to its processing line (PCR-031)', () => {
  it('posts a marked machine to the line overhead and the rest to depreciation expense', async () => {
    const make = (assetNumber: string) =>
      prisma.fixedAsset.create({
        data: {
          companyId: fixture.companyId, assetNumber, name: assetNumber, assetClass: 'Plant', acquisitionDate: new Date('2025-12-01'),
          costKobo: 1_200_000n, usefulLifeMonths: 12, status: 'POSTED', createdById: fixture.makerId,
        },
      });
    const plucker = await make('FA-PLUCKER');
    const tractor = await make('FA-TRACTOR');
    await assets.setProcessingCycle({ companyId: fixture.companyId, assetId: plucker.id, processingCycle: 'POULTRYPRO', actor });

    const run = await prisma.depreciationRun.create({
      data: {
        companyId: fixture.companyId, financialPeriodId: fixture.periodIds[JANUARY]!, totalAmountKobo: 200_000n, createdById: fixture.makerId,
        entries: { create: [{ assetId: plucker.id, amountKobo: 100_000n }, { assetId: tractor.id, amountKobo: 100_000n }] },
      },
    });
    const { journalEntryId } = await prisma.$transaction((tx) => assets.postApprovedDepreciation({ runId: run.id, actor, tx }));

    const lines = await prisma.journalLine.findMany({ where: { journalEntryId } });
    expect(lines.find((l) => l.glAccountId === account['622100'])?.debitKobo).toBe(100_000n);
    expect(lines.find((l) => l.glAccountId === account['5501'])?.debitKobo).toBe(100_000n);
    expect(lines.filter((l) => l.glAccountId === account['1702']).reduce((s, l) => s + l.creditKobo, 0n)).toBe(200_000n);
  });
});
