import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { StockMovementService } from '../../src/inventory/stock-movement.service';
import { PoultryEggService } from '../../src/poultry-egg/poultry-egg.service';
import { EggPostingService } from '../../src/poultry-egg/egg-posting.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ControlAccountReconciliationService } from '../../src/reporting/control-account-reconciliation.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { assignApprovedLifecycleGroups, assignApprovedPostingGroup } from '../helpers/approved-posting';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Eggs on the approved five-digit chart: collected into 12420 against the
 * 42000 recognition gain, set into 13200 (eggs in incubation, an engineering
 * proposal — the workbook has no account for it), and hatched into the
 * immature poultry account 16032, or written off to 51120 when nothing hatches.
 */

let prisma: PrismaService;
let eggs: PoultryEggService;
let eggPostings: EggPostingService;
let reconciliation: ControlAccountReconciliationService;
let fixture: TestFixture;
let actor: { userId: string; roles: string[] };
let itemId: string;
let layersId: string;
const gl = new Map<string, string>();

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  eggs = new PoultryEggService(prisma, new IdempotencyService(prisma));
  eggPostings = new EggPostingService(prisma, posting, new StockMovementService(prisma), audit);
  reconciliation = new ControlAccountReconciliationService(prisma, new TrialBalanceService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  const audit = new AuditService(prisma);
  await new PostingControlProvisioningService(prisma, audit).provision(fixture.companyId, null);
  actor = { userId: fixture.makerId, roles: ['CFO'] };
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'APPROVED' } });

  const accounts: Array<[string, string, 'ASSET' | 'EXPENSE' | 'REVENUE', 'DEBIT' | 'CREDIT', boolean]> = [
    ['12420', 'Finished poultry products inventory control', 'ASSET', 'DEBIT', true],
    ['13200', 'Eggs in incubation', 'ASSET', 'DEBIT', true],
    ['16032', 'Poultry biological assets - immature', 'ASSET', 'DEBIT', true],
    ['42000', 'Fair value gain on biological assets', 'REVENUE', 'CREDIT', false],
    ['40330', 'Revenue - eggs', 'REVENUE', 'CREDIT', false],
    ['50330', 'Cost of sales - eggs', 'EXPENSE', 'DEBIT', false],
    ['51120', 'Abnormal poultry mortality loss', 'EXPENSE', 'DEBIT', false],
  ];
  gl.clear();
  for (const [accountNumber, name, accountType, normalBalance, control] of accounts) {
    const row = await prisma.gLAccount.upsert({
      where: { companyId_accountNumber: { companyId: fixture.companyId, accountNumber } },
      create: { companyId: fixture.companyId, accountNumber, name, accountType, normalBalance, isControlAccount: control, isPostingAccount: !control },
      update: { name, accountType, normalBalance, isControlAccount: control, isPostingAccount: !control },
    });
    gl.set(accountNumber, row.id);
  }

  const crate = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'CRATE', name: 'Crate of 30' } });
  const store = await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'FG-WH', name: 'Produce Store' } });
  itemId = (await prisma.item.create({
    data: { companyId: fixture.companyId, code: 'EGGS', description: 'Table eggs', unitOfMeasureId: crate.id, defaultWarehouseId: store.id },
  })).id;
  await assignApprovedPostingGroup(prisma as unknown as PrismaClient, { companyId: fixture.companyId, masterType: 'Item', masterId: itemId, application: 'YifrehPoultry', postingGroup: 'PLP-FG-EGG', assignedById: fixture.financeUserId });
  await prisma.speciesBreed.create({ data: { companyId: fixture.companyId, speciesKey: 'poultry', code: 'TEST-EGG', name: 'Test layers', openingStage: 'Layer', stages: { create: [
    { stageName: 'Chick', minDay: 0, sortOrder: 1, maturityClass: 'IMMATURE' },
    { stageName: 'Layer', minDay: 140, sortOrder: 2, maturityClass: 'MATURE' },
  ] } } });
  await assignApprovedLifecycleGroups(prisma as unknown as PrismaClient, fixture.companyId, fixture.financeUserId);
  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'PEN-L', name: 'Layers' } });
  layersId = (await prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: pen.id, code: 'L-EGG',
      speciesKey: 'poultry', breed: 'Test', purpose: 'Layers', stage: 'Layer', openingPopulation: 500, population: 500, startedOn: new Date('2026-01-01'),
    },
  })).id;
});

async function balance(accountNumber: string) {
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: gl.get(accountNumber)! }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
}

const policy = () =>
  eggPostings.setPolicy({ companyId: fixture.companyId, itemId, eggsPerUnit: 30, valuePerUnitKobo: 150_000n, effectiveFrom: new Date('2026-01-01'), actor });

const collect = (code: string, table: number, hatching: number) =>
  eggs.recordCollection({
    companyId: fixture.companyId, sourceGroupId: layersId, code, collectedOn: new Date('2026-01-10'),
    hatchingCount: hatching, tableCount: table, rejectCount: 0, recordedById: fixture.makerId, idempotencyKey: `collect-${code}`,
  });

describe('eggs on the approved chart', () => {
  it('points an egg item at the workbook’s egg inventory, revenue and cost of sales', async () => {
    await policy();
    const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item).toMatchObject({ inventoryGlAccountId: gl.get('12420'), revenueGlAccountId: gl.get('40330'), costOfSalesGlAccountId: gl.get('50330') });
  });

  it('keeps an account an item already names', async () => {
    await prisma.item.update({ where: { id: itemId }, data: { revenueGlAccountId: gl.get('50330') } });
    await policy();
    expect((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).revenueGlAccountId).toBe(gl.get('50330'));
  });

  it('collects, sets and hatches, carrying the value into the immature poultry account', async () => {
    await policy();
    const batch = await collect('E-1', 30, 30); // 2 crates at ₦1,500
    expect(await eggPostings.postCollection(batch.id, actor)).toEqual({ posted: true });
    expect(await balance('12420')).toBe(300_000n);
    expect(await balance('42000')).toBe(-300_000n);

    const incubation = await eggs.setIncubation({
      companyId: fixture.companyId, eggBatchId: batch.id, code: 'INC-1', setOn: new Date('2026-01-11'),
      setQuantity: 30, recordedById: fixture.makerId, idempotencyKey: 'inc-1',
    });
    expect(await eggPostings.postIncubation(incubation.id, actor)).toEqual({ posted: true });
    const valuedIncubation = await prisma.incubationBatch.findUniqueOrThrow({ where: { id: incubation.id } });
    expect(valuedIncubation.valueKobo, `incubation value/journal: ${JSON.stringify({ value: valuedIncubation.valueKobo.toString(), journalEntryId: valuedIncubation.journalEntryId })}`).toBe(150_000n);
    const incubationJournal = await prisma.journalEntry.findUniqueOrThrow({ where: { id: valuedIncubation.journalEntryId! }, include: { lines: { include: { glAccount: { select: { accountNumber: true } } } } } });
    expect(incubationJournal.lines.map((line) => ({ account: line.glAccount.accountNumber, debit: line.debitKobo.toString(), credit: line.creditKobo.toString() })), 'posted incubation journal').toEqual([
      { account: '13200', debit: '150000', credit: '0' },
      { account: '12420', debit: '0', credit: '150000' },
    ]);
    expect(await balance('13200')).toBe(150_000n);
    expect(await balance('12420')).toBe(150_000n);

    const hatch = await eggs.recordHatch({
      companyId: fixture.companyId, incubationBatchId: incubation.id, hatchedOn: new Date('2026-01-31'),
      hatchedCount: 25, unhatchedCount: 5, damagedCount: 0, chickGroupCode: 'C-1', recordedById: fixture.makerId, idempotencyKey: 'hatch-1',
    });
    expect(await eggPostings.postHatch(hatch.id, actor)).toEqual({ posted: true });
    expect(await balance('13200')).toBe(0n); // incubation cleared
    expect(await balance('16032')).toBe(150_000n); // the chicks, at what the eggs were worth
    const chicks = await prisma.livestockGroup.findUniqueOrThrow({ where: { id: hatch.chickGroupId! } });
    expect(chicks).toMatchObject({ stage: 'Chick', acquisitionCostKobo: 150_000n });

    // The eggs account agrees with the eggs in stock.
    const row = (await reconciliation.reconcile(fixture.companyId)).find((r) => r.accountNumber === '12420')!;
    expect(row.reconciled).toBe(true);
  });

  it('writes the set value off to abnormal poultry mortality loss when nothing hatches', async () => {
    await policy();
    const batch = await collect('E-2', 0, 30);
    await eggPostings.postCollection(batch.id, actor);
    const incubation = await eggs.setIncubation({
      companyId: fixture.companyId, eggBatchId: batch.id, code: 'INC-2', setOn: new Date('2026-01-11'),
      setQuantity: 30, recordedById: fixture.makerId, idempotencyKey: 'inc-2',
    });
    await eggPostings.postIncubation(incubation.id, actor);
    const hatch = await eggs.recordHatch({
      companyId: fixture.companyId, incubationBatchId: incubation.id, hatchedOn: new Date('2026-01-31'),
      hatchedCount: 0, unhatchedCount: 30, damagedCount: 0, recordedById: fixture.makerId, idempotencyKey: 'hatch-2',
    });
    expect(await eggPostings.postHatch(hatch.id, actor)).toEqual({ posted: true });
    expect(await balance('13200')).toBe(0n);
    expect(await balance('51120')).toBe(150_000n);
    expect(await balance('16032')).toBe(0n);
  });
});
