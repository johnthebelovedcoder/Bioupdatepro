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
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Snail processing and production-order close (UAT-015, UAT-024; the same
 * engine serves poultry, UAT-020): harvested snails and packaging go into
 * WIP, conversion is absorbed at standard, meat and shell come out, and the
 * order settles with WIP and the recovery account at exactly zero and the
 * variance visible. An order is refused its close while anything is still in
 * WIP, naming why.
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
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'SPEC' } });
  await new PostingControlProvisioningService(prisma, new AuditService(prisma)).provision(fixture.companyId, null);
  await prisma.workflowDefinition.create({
    data: {
      companyId: fixture.companyId, transactionType: 'PRODUCTION_ORDER', name: 'Production order', effectiveFrom: new Date('2026-01-01'),
      steps: { create: [{ level: 1, roleCode: 'FARM_MANAGER', name: 'Farm Manager', maxAmountKobo: null }] },
    },
  });
  const acct = async (n: string) => (await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: n } })).id;

  const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'KG', name: 'Kilogram' } });
  for (const [code, description, inventory] of [
    ['PACK', 'Packaging tubs', '130100'],
    ['MEAT', 'Snail meat', '130510'],
    ['SHELL', 'Snail shell', '130510'],
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
  const recipe = await prisma.productRecipe.create({ data: { companyId: fixture.companyId, code: 'R-MEAT', name: 'Snail meat', outputItemId: item.MEAT! } });
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

  // 500 market snails, last valued at ₦3,000 each, harvested for processing.
  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'S1', name: 'Snailery 1' } });
  const cohort = await prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: pen.id, code: 'MKT-1', speciesKey: 'snail',
      breed: 'Archachatina marginata', purpose: 'Market', stage: 'Market', openingPopulation: 1000, population: 500,
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
});

const wip = async () => {
  const account = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: '130410' } });
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: account.id }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
};
const balanceOf = async (n: string) => {
  const account = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: n } });
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: account.id }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
};

async function throughConversion() {
  const { id, orderNumber } = await orders.createFromHarvest({ harvestRecordId: harvestId, recipeVersionId: versionId, warehouseId: fgStore, plannedOutputQuantity: '90', actor: maker });
  expect(orderNumber).toMatch(/^PRO-/);
  const submitted = await orders.submit({ productionOrderId: id, actor: maker });
  await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
  await orders.issueMaterials({ productionOrderId: id, actor: maker });
  await orders.confirmConversion({
    productionOrderId: id, standardConversionCostKobo: 1_400_000_00n, actualLabourCostKobo: 600_000_00n, actualOverheadCostKobo: 900_000_00n, actor: maker,
  });
  return id;
}

describe('Processing and production-order close (UAT-015 / UAT-024)', () => {
  it('runs issue → conversion → output → settle, and closes with WIP and recovery at exactly zero and the variance shown', async () => {
    const id = await throughConversion();
    // In WIP: ₦1.5m of snails + ₦5,000 of packaging + ₦1.4m standard conversion.
    expect(await wip()).toBe(1_500_000_00n + 5_000_00n + 1_400_000_00n);

    await orders.recordOutputs({
      productionOrderId: id, method: 'WEIGHT', warehouseId: fgStore, actor: maker,
      outputs: [
        { itemId: item.MEAT!, outputType: 'MAIN', quantity: '36', weight: '36' },
        { itemId: item.SHELL!, outputType: 'BY_PRODUCT', quantity: '16', weight: '16' },
      ],
    });
    expect(await wip()).toBe(0n); // everything in WIP went to finished goods

    const settled = await orders.settle({ productionOrderId: id, actor: maker });
    expect(settled.variance).toBe('10000000'); // actual ₦1.5m against ₦1.4m standard: ₦100,000 adverse
    expect(await balanceOf('219810')).toBe(0n); // the recovery account clears
    // …and so do the actual pools the order charged (PCR-058): no residual processing expense.
    expect(await balanceOf('621100')).toBe(0n);
    expect(await balanceOf('621200')).toBe(0n);
    expect(await balanceOf('520100')).toBe(100_000_00n); // the variance, and only the variance, in the P&L
    // Finished goods carry exactly the standard cost path: snails + packaging + standard conversion.
    expect((await balanceOf('130510'))).toBe(1_500_000_00n + 5_000_00n + 1_400_000_00n);
    expect(await wip()).toBe(0n);
    const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id } });
    expect(order.settledAt).not.toBeNull();

    // The Controls reconciliation agrees: WIP and recovery tie to the orders (UAT-021/024).
    const rows = await new ControlAccountReconciliationService(prisma, new TrialBalanceService(prisma)).reconcile(fixture.companyId);
    const processing = rows.filter((row) => /^(1304|2198)/.test(row.accountNumber));
    expect(processing.length).toBe(2);
    expect(processing.every((row) => row.reconciled)).toBe(true);
  });

  it('refuses to close an order while anything is still in WIP, and says why', async () => {
    const id = await throughConversion();
    expect(await wip()).toBeGreaterThan(0n);
    await expect(orders.settle({ productionOrderId: id, actor: maker })).rejects.toThrow(/IN_PRODUCTION; only a completed order can settle/);
  });

  it('refuses a second order against the same harvest', async () => {
    await orders.createFromHarvest({ harvestRecordId: harvestId, recipeVersionId: versionId, warehouseId: fgStore, plannedOutputQuantity: '90', actor: maker });
    await expect(orders.createFromHarvest({ harvestRecordId: harvestId, recipeVersionId: versionId, warehouseId: fgStore, plannedOutputQuantity: '90', actor: maker })).rejects.toThrow(
      /already has a processing order/,
    );
  });
});
