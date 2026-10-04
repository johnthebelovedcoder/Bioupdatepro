import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { PostingControlService } from '../../src/posting-control/posting-control.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { StockMovementService } from '../../src/inventory/stock-movement.service';
import { RecipeService } from '../../src/masters/recipe.service';
import { CostAllocationService } from '../../src/production/cost-allocation.service';
import { ProductionOrderService } from '../../src/production/production-order.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ControlAccountReconciliationService } from '../../src/reporting/control-account-reconciliation.service';
import { JointCostService } from '../../src/production/joint-cost.service';
import { RoutingService } from '../../src/routing/routing.service';
import { RearingCostService } from '../../src/biological-assets/rearing-cost.service';
import { OperationsPostingService } from '../../src/operations/operations-posting.service';
import { kobo } from '../../src/common/money';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Poultry processing on the approved five-digit chart: birds and packaging into
 * 13120, standard conversion absorbed to labour, machine and utility recovery
 * (54000 / 54100 / 54200) by each routing line's resource, dressed birds out to
 * 12420, and a settlement that clears WIP, every recovery account and both
 * actual pools (52120 labour, 52200 overhead) with the variance in 53500.
 */

let prisma: PrismaService;
let orders: ProductionOrderService;
let workflow: WorkflowService;
let stock: StockMovementService;
let fixture: TestFixture;
let maker: { userId: string; roles: string[] };
let approver: { userId: string; roles: string[] };
const item: Record<string, string> = {};
let versionId: string;
let harvestId: string;
let fgStore: string;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  stock = new StockMovementService(prisma);
  orders = new ProductionOrderService(
    prisma, audit, posting, workflow, new RecipeService(prisma, audit), new PostingControlService(prisma), stock, new CostAllocationService(),
  );
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  maker = { userId: fixture.makerId, roles: ['PRODUCTION_LEAD'] };
  approver = { userId: fixture.checkerId, roles: ['FARM_MANAGER'] };
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'APPROVED' } });
  await new PostingControlProvisioningService(prisma, new AuditService(prisma)).provision(fixture.companyId, null);
  await prisma.workflowDefinition.create({
    data: {
      companyId: fixture.companyId, transactionType: 'PRODUCTION_ORDER', name: 'Production order', effectiveFrom: new Date('2026-01-01'),
      steps: { create: [{ level: 1, roleCode: 'FARM_MANAGER', name: 'Farm Manager', maxAmountKobo: null }] },
    },
  });
  await prisma.workflowDefinition.create({
    data: {
      companyId: fixture.companyId, transactionType: 'PRODUCTION_ORDER_ABNORMAL_LOSS', name: 'Abnormal loss', effectiveFrom: new Date('2026-01-01'),
      steps: { create: [{ level: 1, roleCode: 'FARM_MANAGER', name: 'Farm Manager', maxAmountKobo: null }] },
    },
  });
  const acct = async (n: string) => (await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: n } })).id;

  const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'KG', name: 'Kilogram' } });
  for (const [code, description, inventory] of [
    ['PACK', 'Packaging tubs', '12000'],
    ['MEAT', 'Dressed chicken', '12420'],
    ['SHELL', 'Offal and feathers', '12420'],
  ] as const) {
    item[code] = (
      await prisma.item.create({
        data: { companyId: fixture.companyId, code, description, unitOfMeasureId: uom.id, inventoryGlAccountId: await acct(inventory), isManufactured: code !== 'PACK',
          ...(code === 'PACK' ? { standardCosts: { create: [{ standardCostKobo: 500_00n, effectiveFrom: new Date('2026-01-01') }] } } : {}) },
      })
    ).id;
  }
  const rawStore = await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'RAW', name: 'Raw store', type: 'RAW_MATERIAL' } });
  fgStore = (await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'FG', name: 'Cold store', type: 'FINISHED_GOODS' } })).id;
  await prisma.item.update({ where: { id: item.PACK! }, data: { defaultWarehouseId: rawStore.id } });
  // 100 kg of packaging at ₦500/kg in the raw store.
  await prisma.$transaction((tx) =>
    stock.receiveIn({
      tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.PACK!, warehouseId: rawStore.id, quantity: new Decimal(100),
      valueKobo: 50_000_00n, sourceModule: 'test', sourceDocumentType: 'Opening', sourceDocumentId: 'open', documentReference: 'OPEN', movementDate: new Date('2026-01-02'),
    }),
  );

  // The recipe: 10 kg of packaging per batch of 90 kg of meat.
  const recipe = await prisma.productRecipe.create({ data: { companyId: fixture.companyId, code: 'R-MEAT', name: 'Dressed chicken', outputItemId: item.MEAT! } });
  versionId = (
    await prisma.productRecipeVersion.create({
      data: {
        recipeId: recipe.id, version: 1, batchSize: '90', effectiveFrom: new Date('2026-01-01'),
        components: { create: [{ lineNumber: 1, componentItemId: item.PACK!, quantityPerBatch: '10', unitOfMeasureId: uom.id }] },
      },
    })
  ).id;
  // Components are set while a draft; an active version is locked (a database rule).
  await prisma.productRecipeVersion.update({ where: { id: versionId }, data: { status: 'ACTIVE' } });

  // Approved selling prices at split-off (handbook §62.5), from the start of the year.
  const joint = new JointCostService(prisma, new AuditService(prisma));
  for (const [code, price] of [['MEAT', 600000n], ['SHELL', 100000n]] as const) {
    const proposed = await joint.proposePrice({
      companyId: fixture.companyId, itemId: item[code]!, sellingPricePerUnitKobo: price, furtherCostPerUnitKobo: 0n,
      effectiveFrom: new Date('2026-01-01'), evidenceReference: 'Price list 2026', actor: maker,
    });
    await joint.decide({ companyId: fixture.companyId, priceId: proposed.id, approve: true, actor: { userId: fixture.financeUserId, roles: ['FINANCE_CONTROLLER'] } });
  }

  // 500 market-ready birds, last valued at ₦3,000 each, harvested for processing.
  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'P1', name: 'Poultry house 1' } });
  const cohort = await prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: pen.id, code: 'MKT-1', speciesKey: 'poultry',
      breed: 'Ross 308', purpose: 'Broiler', stage: 'Market-ready', openingPopulation: 1000, population: 500,
      startedOn: new Date('2025-06-01'), currentFvlctsPerUnitKobo: 3_000_00n,
    },
  });
  harvestId = (
    await prisma.harvestRecord.create({
      data: {
        companyId: fixture.companyId, groupId: cohort.id, harvestedOn: new Date('2026-01-10'), grade: 'A', weightKg: '90', count: 500,
        populationAtTime: 1000, destination: 'PROCESSING', recordedById: fixture.makerId,
      },
    })
  ).id;

  // The routing: labour ₦10,000/h, machine ₦3,000/h, utilities ₦5,000/h — one operation each.
  const routing = new RoutingService(prisma, new AuditService(prisma));
  for (const [code, name, resource, cost] of [
    ['LAB', 'Dress and eviscerate', 'LABOUR', 1_000_000_00n],
    ['MCH', 'Cut up', 'MACHINE', 300_000_00n],
    ['UTL', 'Chill and pack', 'OVERHEAD', 500_000_00n],
  ] as const) {
    const pool = await routing.createCostPool({ companyId: fixture.companyId, code, name, driverName: 'Hours', actorId: fixture.makerId });
    await routing.setCostPoolRate({ companyId: fixture.companyId, poolId: pool.id, poolCost: kobo(cost), practicalCapacity: '100', effectiveFrom: new Date('2026-01-01'), actorId: fixture.makerId });
    await routing.createRoutingOperation({
      companyId: fixture.companyId, recipeVersionId: versionId, costCentreId: fixture.costCentreId, costPoolId: pool.id,
      operationName: name, resourceType: resource, setupHours: '0', runHoursPerUnit: '1', actorId: fixture.makerId,
    });
  }
});

const wip = async () => {
  const account = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: '13120' } });
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: account.id }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
};
const balanceOf = async (n: string) => {
  const account = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: n } });
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: account.id }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
};

/** Handbook §29: the plant intake — here, every bird caught arrives, none lost. */
const intake = (productionOrderId: string) =>
  orders.recordIntake({
    productionOrderId, plantReceivedCount: 500, plantReceivedWeightKg: '90', deadOnArrivalCount: 0, deadOnArrivalWeightKg: '0',
    condemnedCount: 0, condemnedWeightKg: '0', actor: maker,
  });
/** Cold-store detail for the two outputs (grade, use-by, temperature). */
const coldStore = [
  { grade: 'A', expiryDate: new Date(Date.now() + 30 * 86_400_000), storageTemperatureC: '-18' },
  { grade: 'B', expiryDate: new Date(Date.now() + 30 * 86_400_000), storageTemperatureC: '-18' },
];



/** Standard: labour 60 h × ₦10,000 + machine 100 h × ₦3,000 + utilities 80 h × ₦5,000 = ₦1,300,000. */
const HOURS = { 'Dress and eviscerate': 60, 'Cut up': 100, 'Chill and pack': 80 };

async function throughConversion() {
  const { id } = await orders.createFromHarvest({ harvestRecordId: harvestId, recipeVersionId: versionId, warehouseId: fgStore, plannedOutputQuantity: '90', actor: maker });
  const submitted = await orders.submit({ productionOrderId: id, actor: maker });
  await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
  await orders.issueMaterials({ productionOrderId: id, actor: maker });
  // Actual: labour ₦600,000 and overhead ₦800,000 = ₦1,400,000, ₦100,000 over standard.
  await orders.confirmConversion({ productionOrderId: id, actualHours: HOURS, actualLabourCostKobo: 600_000_00n, actualOverheadCostKobo: 800_000_00n, actor: maker });
  return id;
}

describe('Poultry processing on the approved chart', () => {
  it('credits standard conversion to labour, machine and utility recovery by routing resource', async () => {
    await throughConversion();
    expect(await balanceOf('54000')).toBe(-600_000_00n);
    expect(await balanceOf('54100')).toBe(-300_000_00n);
    expect(await balanceOf('54200')).toBe(-400_000_00n);
    // In processing WIP: ₦1.5m of birds + ₦5,000 of packaging + ₦1.3m standard conversion.
    expect(await wip()).toBe(1_500_000_00n + 5_000_00n + 1_300_000_00n);
    expect(await balanceOf('16042')).toBe(-1_500_000_00n); // the birds left the mature account
    expect(await balanceOf('12000')).toBe(-5_000_00n); // packaging out of raw materials control
    // The actuals: labour against payroll payable, overhead against the accrual.
    expect(await balanceOf('52120')).toBe(600_000_00n);
    expect(await balanceOf('20700')).toBe(-600_000_00n);
    expect(await balanceOf('52200')).toBe(800_000_00n);
    expect(await balanceOf('20200')).toBe(-800_000_00n);
  });

  it('runs to completion and settles with WIP, every recovery account and both pools at exactly zero', async () => {
    const id = await throughConversion();
    await intake(id);
    await orders.recordOutputs({
      productionOrderId: id, warehouseId: fgStore, actor: maker, normalLossQuantity: '38', details: coldStore,
      outputs: [
        { itemId: item.MEAT!, outputType: 'MAIN', quantity: '36', weight: '36' },
        { itemId: item.SHELL!, outputType: 'BY_PRODUCT', quantity: '16', weight: '16' },
      ],
    });
    expect(await wip()).toBe(0n);
    expect(await balanceOf('12420')).toBe(1_500_000_00n + 5_000_00n + 1_300_000_00n);

    const settled = await orders.settle({ productionOrderId: id, actor: maker });
    expect(settled.variance).toBe('10000000'); // ₦1.4m actual against ₦1.3m standard
    for (const recovery of ['54000', '54100', '54200']) expect(await balanceOf(recovery), recovery).toBe(0n);
    expect(await balanceOf('52120')).toBe(0n);
    expect(await balanceOf('52200')).toBe(0n);
    expect(await balanceOf('53500')).toBe(100_000_00n); // the variance, and only the variance, in the P&L
    expect(await wip()).toBe(0n);
    // The payroll payable and accrual keep what was actually incurred, to be settled by payroll and suppliers.
    expect(await balanceOf('20700')).toBe(-600_000_00n);
    expect(await balanceOf('20200')).toBe(-800_000_00n);

    const rows = await new ControlAccountReconciliationService(prisma, new TrialBalanceService(prisma)).reconcile(fixture.companyId);
    const processing = rows.filter((row) => row.accountNumber === '13120' || row.accountNumber.startsWith('54000'));
    expect(processing.length).toBe(2);
    expect(processing.every((row) => row.reconciled), JSON.stringify(processing)).toBe(true);
  });

  it('refuses an order with no routing, since its recovery could not be split by resource', async () => {
    await prisma.routingOperation.deleteMany({ where: { companyId: fixture.companyId } });
    const { id } = await orders.createFromHarvest({ harvestRecordId: harvestId, recipeVersionId: versionId, warehouseId: fgStore, plannedOutputQuantity: '90', actor: maker });
    const submitted = await orders.submit({ productionOrderId: id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.issueMaterials({ productionOrderId: id, actor: maker });
    await expect(
      orders.confirmConversion({ productionOrderId: id, standardConversionCostKobo: 1_300_000_00n, actualLabourCostKobo: 600_000_00n, actualOverheadCostKobo: 800_000_00n, actor: maker }),
    ).rejects.toThrow(/no routing, so its standard conversion cannot be credited to labour, machine or utility recovery/);
  });
  it('writes an approved abnormal processing loss out of WIP to inventory write-down expense (51200)', async () => {
    const id = await throughConversion();
    const claim = await orders.recordAbnormalLoss({ productionOrderId: id, quantity: '4', costKobo: 50_000_00n, reason: 'Contamination at the chiller', actor: maker });
    expect(claim).toMatchObject({ classification: 'ABNORMAL', posted: false });
    await prisma.$transaction((tx) => orders.postApprovedAbnormalLoss({ lossEventId: claim.lossEventId!, actor: approver, tx }));
    expect(await balanceOf('51200')).toBe(50_000_00n);
    expect(await wip()).toBe(1_500_000_00n + 5_000_00n + 1_300_000_00n - 50_000_00n);
  });
  it('moves a harvested flock’s rearing cost into processing out of the stage accounts it was fed into', async () => {
    const audit = new AuditService(prisma);
    const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
    const rearing = new RearingCostService(prisma, posting);
    const operations = new OperationsPostingService(prisma, posting, rearing, stock);
    const harvest = await prisma.harvestRecord.findUniqueOrThrow({ where: { id: harvestId } });
    const feed = async (valueKobo: bigint, on: string) => {
      const record = await prisma.dailyRecord.create({ data: { companyId: fixture.companyId, groupId: harvest.groupId, recordedOn: new Date(on), recordedById: fixture.makerId } });
      await prisma.feedIssue.create({ data: { dailyRecordId: record.id, feedName: 'Mash', quantityKg: '10', valueKobo } });
      expect(await operations.postFeedIssues({ companyId: fixture.companyId, dailyRecordId: record.id, actor: maker })).toEqual({ posted: 1, skipped: [] });
    };
    // ₦100,000 fed while the flock was chicks, ₦300,000 once market-ready.
    await prisma.livestockGroup.update({ where: { id: harvest.groupId }, data: { stage: 'Chick' } });
    await feed(100_000_00n, '2026-01-03');
    await prisma.livestockGroup.update({ where: { id: harvest.groupId }, data: { stage: 'Market-ready' } });
    await feed(300_000_00n, '2026-01-06');
    expect(await balanceOf('16032')).toBe(100_000_00n);
    expect(await balanceOf('16042')).toBe(300_000_00n);

    // The whole flock goes to processing: its rearing cost is relieved across both stage accounts.
    await rearing.relieve({ companyId: fixture.companyId, groupId: harvest.groupId, event: 'HARVEST', sourceId: harvestId, count: 500, populationBefore: 500, occurredOn: new Date('2026-01-10'), actor: maker });
    const id = await throughConversion();
    const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id } });
    expect(order.rearingCostKobo).toBe(400_000_00n);
    expect(await balanceOf('16032')).toBe(0n); // the chick-stage feed left with the birds
    expect(await balanceOf('16042')).toBe(300_000_00n - 300_000_00n - 1_500_000_00n); // …and the market-ready feed and the birds’ own value
    expect(await wip()).toBe(1_500_000_00n + 400_000_00n + 5_000_00n + 1_300_000_00n);
  });
});
