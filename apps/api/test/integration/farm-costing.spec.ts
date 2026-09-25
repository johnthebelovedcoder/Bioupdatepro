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
import { TimesheetService } from '../../src/cost-allocation/timesheet.service';
import { PoultryEggService } from '../../src/poultry-egg/poultry-egg.service';
import { EggPostingService } from '../../src/poultry-egg/egg-posting.service';
import { FixedAssetService } from '../../src/fixed-assets/fixed-asset.service';
import type { WorkflowService } from '../../src/workflow/workflow.service';
import { PoultryEggController } from '../../src/poultry-egg/poultry-egg.controller';
import { FarmCostAllocationController } from '../../src/cost-allocation/farm-cost-allocation.controller';
import { FixedAssetsController } from '../../src/fixed-assets/fixed-assets.controller';
import { BatchCloseService } from '../../src/operations/batch-close.service';
import { BiologicalAssetService } from '../../src/biological-assets/biological-asset.service';
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
let timesheets: TimesheetService;
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
  timesheets = new TimesheetService(prisma);
  allocation = new FarmCostAllocationService(prisma, posting, audit, timesheets);
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
    const rows = ['A', 'B', 'C'].map((code) => ({ groupId: code, code, speciesKey: 'poultry', animalDays: new Decimal(1), hours: null, weight: new Decimal(1) }));
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

/*
 * Through the controllers, with the bodies the web forms send. The service
 * tests above never touched the controllers' own input checks — which is how
 * an egg-value check that refused every value (its digit patterns had lost
 * their backslashes) reached production on 2026-09-25.
 */
describe('The endpoints the forms call', () => {
  const company = () => fixture.companyId;

  it('accepts ₦4,500 a crate from the egg value form, and refuses what the form cannot send', async () => {
    const crate = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'CRATE', name: 'Crate' } });
    const item = await prisma.item.create({
      data: { companyId: fixture.companyId, code: 'EGG-CRATE', description: 'Table eggs', unitOfMeasureId: crate.id },
    });
    const controller = new PoultryEggController(eggs, prisma, eggPostings);

    const saved = await controller.setValuePolicy(company(), actor, {
      itemId: item.id,
      eggsPerUnit: 30,
      valuePerUnitKobo: '450000',
      effectiveFrom: '2026-09-25',
    });
    expect(saved.valuePerUnitKobo).toBe(450_000n);
    expect(saved.effectiveFrom.toISOString().slice(0, 10)).toBe('2026-09-25');
    expect(await controller.valuePolicies(company())).toHaveLength(1);

    const bad = (body: Partial<{ itemId: string; eggsPerUnit: number; valuePerUnitKobo: string; effectiveFrom: string }>) =>
      controller.setValuePolicy(company(), actor, { itemId: item.id, eggsPerUnit: 30, valuePerUnitKobo: '450000', effectiveFrom: '2026-09-25', ...body });
    await expect(bad({ valuePerUnitKobo: '4500.50' })).rejects.toThrow(/whole-kobo/);
    await expect(bad({ effectiveFrom: '25/09/2026' })).rejects.toThrow(/effectiveFrom/);
    await expect(bad({ valuePerUnitKobo: '0' })).rejects.toThrow(/more than zero/);
    await expect(bad({ eggsPerUnit: 0 })).rejects.toThrow(/at least 1/);
  });

  it('posts an allocation from the form’s string amounts', async () => {
    await population('L-A', 'poultry', 100);
    await salaries(40_000n);
    const controller = new FarmCostAllocationController(allocation, timesheets, prisma);

    expect(await controller.sources(company(), fixture.periodIds[JANUARY]!)).toHaveLength(1);
    const result = await controller.post(company(), actor, {
      financialPeriodId: fixture.periodIds[JANUARY]!,
      sources: [{ glAccountId: account['5101']!, costCentreId: null, amountKobo: '40000' }],
    });
    expect(result.totalKobo).toBe(40_000n);
    await expect(
      controller.post(company(), actor, {
        financialPeriodId: fixture.periodIds[JANUARY]!,
        sources: [{ glAccountId: account['5101']!, amountKobo: '12.5' }],
      }),
    ).rejects.toThrow(/whole number of kobo/);
  });

  it('sets and clears a machine’s processing line from the form', async () => {
    const asset = await prisma.fixedAsset.create({
      data: {
        companyId: fixture.companyId, assetNumber: 'FA-1', name: 'Plucker', assetClass: 'Plant', acquisitionDate: new Date('2025-12-01'),
        costKobo: 1_200_000n, usefulLifeMonths: 12, status: 'POSTED', createdById: fixture.makerId,
      },
    });
    const controller = new FixedAssetsController(assets);

    await controller.setProcessingLine(asset.id, company(), actor, { processingCycle: 'POULTRYPRO' });
    expect((await prisma.fixedAsset.findUniqueOrThrow({ where: { id: asset.id } })).processingCycle).toBe('POULTRYPRO');
    await controller.setProcessingLine(asset.id, company(), actor, { processingCycle: null });
    expect((await prisma.fixedAsset.findUniqueOrThrow({ where: { id: asset.id } })).processingCycle).toBeNull();
    await expect(controller.setProcessingLine(asset.id, company(), actor, { processingCycle: 'BAKERY' })).rejects.toThrow(/must be/);
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

describe('Wages shared by timesheet hours × pay rate (PCR-028)', () => {
  async function employee(number: string) {
    return prisma.employee.create({
      data: { companyId: fixture.companyId, employeeNumber: number, firstName: number, surname: 'Test', employmentDate: new Date('2025-01-01') },
    });
  }

  /** A posted January payroll paying each employee the given gross. */
  async function paid(gross: Array<[string, bigint]>) {
    const run = await prisma.payrollRun.create({
      data: {
        companyId: fixture.companyId, year: 2026, month: 1, reference: 'PAY-2026-01', payrollDate: new Date('2026-01-31'),
        branchId: fixture.branchId, financialYearId: fixture.financialYearId, financialPeriodId: fixture.periodIds[JANUARY]!,
        currencyId: fixture.currencyId, createdById: fixture.makerId,
      },
    });
    const zero = {
      taxableGrossKobo: 0n, pensionableEmolumentsKobo: 0n, annualGrossKobo: 0n, annualPensionReliefKobo: 0n, annualNhfReliefKobo: 0n,
      annualNhisReliefKobo: 0n, annualLifeAssuranceKobo: 0n, annualMortgageInterestKobo: 0n, rentReliefKobo: 0n, totalReliefsKobo: 0n,
      chargeableIncomeKobo: 0n, annualPayeKobo: 0n, monthlyPayeKobo: 0n, employeePensionKobo: 0n, employerPensionKobo: 0n,
      nhfKobo: 0n, nsitfKobo: 0n, itfKobo: 0n, netPayKobo: 0n, calculationSnapshot: {},
    };
    for (const [employeeId, monthlyGrossKobo] of gross) {
      await prisma.payrollRunLine.create({ data: { payrollRunId: run.id, employeeId, monthlyGrossKobo, ...zero } });
    }
    // Posted once its lines are in — a posted run's lines are frozen.
    await prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'POSTED' } });
  }

  /** Hours logged by the test actor and approved by the farm manager — only approved hours count. */
  const log = async (employeeId: string, groupId: string, day: string, hours: string) => {
    const entry = await timesheets.record({ companyId: fixture.companyId, employeeId, groupId, workDate: new Date(day), hours: new Decimal(hours), actor });
    await timesheets.approve({ companyId: fixture.companyId, ids: [entry.id], actor: { userId: fixture.checkerId, roles: ['FARM_MANAGER'] } });
    return entry;
  };

  it('counts only approved hours, and sends a correction back for approval', async () => {
    const flock = await population('L-A', 'poultry', 100);
    const worker = await employee('E-9');
    const pending = await timesheets.record({
      companyId: fixture.companyId, employeeId: worker.id, groupId: flock.id, workDate: new Date('2026-01-12'), hours: new Decimal('6'), actor,
    });
    expect(await allocation.preview(fixture.companyId, fixture.periodIds[JANUARY]!, 1000n, 'HOURS')).toEqual([]);

    // Whoever logged it may not approve it while someone else could.
    await expect(timesheets.approve({ companyId: fixture.companyId, ids: [pending.id], actor })).rejects.toThrow(/someone else approves/);
    await timesheets.approve({ companyId: fixture.companyId, ids: [pending.id], actor: { userId: fixture.checkerId, roles: ['FARM_MANAGER'] } });
    expect(await allocation.preview(fixture.companyId, fixture.periodIds[JANUARY]!, 1000n, 'HOURS')).toHaveLength(1);

    // A correction is unapproved again.
    await timesheets.record({
      companyId: fixture.companyId, employeeId: worker.id, groupId: flock.id, workDate: new Date('2026-01-12'), hours: new Decimal('7'), actor,
    });
    const [corrected] = await timesheets.list(fixture.companyId, new Date('2026-01-01'), new Date('2026-01-31'));
    expect(corrected).toMatchObject({ hours: '7', status: 'PENDING' });
  });

  it('weights each person’s hours by their pay for the month', async () => {
    const flockA = await population('L-A', 'poultry', 100);
    const flockB = await population('L-B', 'poultry', 5000); // far more animals — irrelevant on this basis
    const senior = await employee('E-1');
    const junior = await employee('E-2');
    // Senior earns ₦300,000 over 30 logged hours (₦10,000/h), all on L-A.
    // Junior earns ₦100,000 over 50 logged hours (₦2,000/h), all on L-B.
    await paid([[senior.id, 30_000_000n], [junior.id, 10_000_000n]]);
    await log(senior.id, flockA.id, '2026-01-05', '10');
    await log(senior.id, flockA.id, '2026-01-06', '20');
    for (const day of ['05', '06', '07', '08', '09']) await log(junior.id, flockB.id, `2026-01-${day}`, '10');

    const shares = await allocation.preview(fixture.companyId, fixture.periodIds[JANUARY]!, 400_000n, 'HOURS');
    const byCode = Object.fromEntries(shares.map((s) => [s.code, s]));
    // Weighted: 30h × ₦10,000 = ₦300,000 vs 50h × ₦2,000 = ₦100,000, so 3 : 1.
    expect(byCode['L-A']!.amountKobo).toBe(300_000n);
    expect(byCode['L-B']!.amountKobo).toBe(100_000n);
    expect(byCode['L-A']!.hours!.toNumber()).toBe(30);
  });

  it('posts on the hours basis and records it', async () => {
    const flock = await population('L-A', 'poultry', 100);
    const worker = await employee('E-1');
    await salaries(50_000n);
    await log(worker.id, flock.id, '2026-01-07', '8');

    const result = await allocation.post({
      companyId: fixture.companyId, financialPeriodId: fixture.periodIds[JANUARY]!, basis: 'HOURS',
      sources: [{ glAccountId: account['5101']!, amountKobo: 50_000n }], actor,
    });
    const saved = await prisma.farmCostAllocation.findUniqueOrThrow({ where: { id: result.id }, include: { lines: true } });
    expect(saved.basis).toBe('HOURS');
    expect(saved.lines[0]!.hours?.toString()).toBe('8');
  });

  it('refuses the hours basis with no hours logged, and more than 24 hours in a day', async () => {
    const flockA = await population('L-A', 'poultry', 100);
    const flockB = await population('L-B', 'poultry', 100);
    await salaries(50_000n);
    await expect(
      allocation.post({
        companyId: fixture.companyId, financialPeriodId: fixture.periodIds[JANUARY]!, basis: 'HOURS',
        sources: [{ glAccountId: account['5101']!, amountKobo: 50_000n }], actor,
      }),
    ).rejects.toThrow(/No approved timesheet hours/);

    const worker = await employee('E-1');
    await log(worker.id, flockA.id, '2026-01-08', '16');
    await expect(log(worker.id, flockB.id, '2026-01-08', '9')).rejects.toThrow(/25 hours on one day/);
    // Logging the same day on the same batch again corrects it.
    await log(worker.id, flockA.id, '2026-01-08', '12');
    const logged = await timesheets.list(fixture.companyId, new Date('2026-01-01'), new Date('2026-01-31'));
    expect(logged.map((e) => e.hours)).toEqual(['12']);
  });
});

describe('Hatching eggs at their own price', () => {
  it('values table and hatching eggs apart, and sets hatching eggs at theirs', async () => {
    const crate = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'CRATE', name: 'Crate' } });
    const store = await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'FG-WH', name: 'Produce' } });
    const item = await prisma.item.create({
      data: { companyId: fixture.companyId, code: 'EGGS', description: 'Eggs', unitOfMeasureId: crate.id, defaultWarehouseId: store.id },
    });
    const layers = await population('L-EGG', 'poultry', 500);
    // Table ₦4,500 a crate; hatching ₦9,000 a crate (₦300 an egg).
    await eggPostings.setPolicy({
      companyId: fixture.companyId, itemId: item.id, eggsPerUnit: 30, valuePerUnitKobo: 450_000n,
      hatchingValuePerUnitKobo: 900_000n, effectiveFrom: new Date('2026-01-01'), actor,
    });

    const batch = await eggs.recordCollection({
      companyId: fixture.companyId, sourceGroupId: layers.id, code: 'E-H', collectedOn: new Date('2026-01-10'),
      hatchingCount: 30, tableCount: 60, rejectCount: 0, recordedById: fixture.makerId, idempotencyKey: 'col-h',
    });
    await eggPostings.postCollection(batch.id, actor);
    const valued = await prisma.eggCollectionBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(valued.valueKobo).toBe(900_000n + 900_000n); // 2 crates of table + 1 crate of hatching
    expect(valued.hatchingValueKobo).toBe(900_000n);

    // Set 20 of the 30 hatching eggs, then the other 10: ₦6,000, then the ₦3,000 left.
    const set = (code: string, n: number) =>
      eggs.setIncubation({
        companyId: fixture.companyId, eggBatchId: batch.id, code, setOn: new Date('2026-01-11'), setQuantity: n,
        recordedById: fixture.makerId, idempotencyKey: code,
      });
    const first = await set('INC-A', 20);
    await eggPostings.postIncubation(first.id, actor);
    const second = await set('INC-B', 10);
    await eggPostings.postIncubation(second.id, actor);
    expect((await prisma.incubationBatch.findUniqueOrThrow({ where: { id: first.id } })).valueKobo).toBe(600_000n);
    expect((await prisma.incubationBatch.findUniqueOrThrow({ where: { id: second.id } })).valueKobo).toBe(300_000n);

    // What is left in stock is exactly the table eggs, at the table price.
    const eggsRow = (await reconciliation.reconcile(fixture.companyId)).find((r) => r.accountNumber === '130215')!;
    expect(eggsRow.reconciled).toBe(true);
    expect(eggsRow.glBalanceKobo).toBe('900000');
  });
});

describe('Machine depreciation split by machine hours (PCR-031)', () => {
  it('splits a machine’s depreciation across lines by its hours on each', async () => {
    const feedMill = (
      await prisma.gLAccount.create({
        data: { companyId: fixture.companyId, accountNumber: '623100', name: 'Feed Mill Overhead Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
      })
    ).id;
    const mixer = await prisma.fixedAsset.create({
      data: {
        companyId: fixture.companyId, assetNumber: 'FA-MIX', name: 'Mixer', assetClass: 'Plant', acquisitionDate: new Date('2025-12-01'),
        costKobo: 1_200_000n, usefulLifeMonths: 12, status: 'POSTED', createdById: fixture.makerId,
      },
    });
    // 30 hours on poultry processing, 10 in the feed mill: 3 : 1.
    await new FixedAssetsController(assets).setMachineHours(mixer.id, fixture.companyId, actor, {
      financialPeriodId: fixture.periodIds[JANUARY]!,
      hours: { POULTRYPRO: '30', FEED_MILL: '10' },
    });

    const run = await prisma.depreciationRun.create({
      data: {
        companyId: fixture.companyId, financialPeriodId: fixture.periodIds[JANUARY]!, totalAmountKobo: 100_000n, createdById: fixture.makerId,
        entries: { create: [{ assetId: mixer.id, amountKobo: 100_000n }] },
      },
    });
    const { journalEntryId } = await prisma.$transaction((tx) => assets.postApprovedDepreciation({ runId: run.id, actor, tx }));
    const lines = await prisma.journalLine.findMany({ where: { journalEntryId } });
    expect(lines.find((l) => l.glAccountId === account['622100'])?.debitKobo).toBe(75_000n);
    expect(lines.find((l) => l.glAccountId === feedMill)?.debitKobo).toBe(25_000n);

    // Once posted, the hours behind it cannot change.
    await prisma.depreciationRun.update({ where: { id: run.id }, data: { status: 'POSTED' } }).catch(() => undefined);
    await expect(
      assets.setMachineHours({ companyId: fixture.companyId, assetId: mixer.id, financialPeriodId: fixture.periodIds[JANUARY]!, hours: {}, actor }),
    ).rejects.toThrow(/already posted/);
  });
});

describe('Closing a batch', () => {
  let closer: BatchCloseService;

  beforeAll(() => {
    const audit = new AuditService(prisma);
    closer = new BatchCloseService(prisma, new BiologicalAssetService(prisma, posting, {} as WorkflowService, audit, rearing), audit);
  });

  /** ₦6,000 of feed posted into a population's Work in Progress. */
  async function fedPopulation(code: string, animals: number) {
    const group = await population(code, 'poultry', animals);
    const record = await prisma.dailyRecord.create({
      data: { companyId: fixture.companyId, groupId: group.id, recordedOn: new Date('2026-01-05'), recordedById: fixture.makerId },
    });
    const issue = await prisma.feedIssue.create({ data: { dailyRecordId: record.id, feedName: 'Mash', quantityKg: '10', valueKobo: 600_000n } });
    const journal = await posting.post({
      sourceModule: 'TEST', sourceDocumentType: 'FEED_ISSUE', sourceDocumentId: issue.id, journalNumber: `FEED-${code}`,
      journalDate: new Date('2026-01-05'), narration: 'Feed', companyId: fixture.companyId, branchId: fixture.branchId,
      financialYearId: fixture.financialYearId, financialPeriodId: fixture.periodIds[JANUARY]!, currencyId: fixture.currencyId,
      exchangeRate: '1', idempotencyKey: `feed-${code}`, actor,
      lines: [
        { glAccountId: fixture.accounts['1501']!, description: 'Feed', debit: kobo(600_000n), dimensions: dims(fixture, JANUARY, { costCentreId: fixture.costCentreId, farmId: fixture.farmId }) },
        { glAccountId: fixture.accounts['1301']!, description: 'Feed', credit: kobo(600_000n), dimensions: dims(fixture, JANUARY, { farmId: fixture.farmId }) },
      ],
    });
    await prisma.feedIssue.update({ where: { id: issue.id }, data: { journalEntryId: journal.journalEntryId } });
    return group;
  }

  it('refuses to close a batch that still has animals, unless they are written off', async () => {
    await fedPopulation('L-OPEN', 40);
    await expect(
      closer.close({ companyId: fixture.companyId, groupCode: 'L-OPEN', closedOn: new Date('2026-01-20'), reason: 'Trial batch', writeOffRemaining: false, actor }),
    ).rejects.toThrow(/still has 40 animals/);
  });

  it('writes off what is left as a loss, empties its WIP, and closes it', async () => {
    const group = await fedPopulation('L-TEST', 40);
    const result = await closer.close({
      companyId: fixture.companyId, groupCode: 'L-TEST', closedOn: new Date('2026-01-20'), reason: 'Trial batch, not real stock', writeOffRemaining: true, actor,
    });
    expect(result).toMatchObject({ code: 'L-TEST', writtenOff: 40 });

    const closed = await prisma.livestockGroup.findUniqueOrThrow({ where: { id: group.id } });
    expect(closed).toMatchObject({ status: 'CLOSED', population: 0 });
    expect(closed.closedOn?.toISOString().slice(0, 10)).toBe('2026-01-20');
    // Its feed cost left Work in Progress for Production Loss with the animals.
    expect(await rearing.remaining(group.id)).toBe(0n);
    const loss = await prisma.journalLine.aggregate({ where: { glAccountId: fixture.accounts['5305'] }, _sum: { debitKobo: true } });
    expect(loss._sum.debitKobo).toBe(600_000n);

    await expect(
      closer.close({ companyId: fixture.companyId, groupCode: 'L-TEST', closedOn: new Date('2026-01-21'), reason: 'again', writeOffRemaining: true, actor }),
    ).rejects.toThrow(/already closed/);
  });

  it('never closes another company’s batch', async () => {
    await fedPopulation('L-MINE', 10);
    const other = await prisma.company.create({ data: { code: 'OTHER', name: 'Other', baseCurrencyId: fixture.currencyId } });
    await expect(
      closer.close({ companyId: other.id, groupCode: 'L-MINE', closedOn: new Date('2026-01-20'), reason: 'x', writeOffRemaining: true, actor }),
    ).rejects.toThrow(/No such batch/);
  });
});
