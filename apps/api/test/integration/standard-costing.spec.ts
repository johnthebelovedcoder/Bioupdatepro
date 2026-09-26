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
import { StandardCostService } from '../../src/production/standard-cost.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { RoutingService } from '../../src/routing/routing.service';
import { kobo } from '../../src/common/money';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Standard costing (Costing_Policy_v2 POL-001–004, SOP-049/050, PCR-032–036,
 * AC-MFG-002), against the workbook's FeedMill_Cost_Model snail-feed order:
 * 1,000 kg planned from 1,050 kg of raw material at a ₦380 standard, 24
 * labour hours at ₦2,500, 10 machine hours at ₦5,000 and ₦35 a kg of other
 * overhead — ₦544,000, or ₦544 a kg. 980 kg of good feed come out: ₦533,120
 * at standard, and a total cost variance of ₦26,380 against the ₦559,500 the
 * order actually cost.
 */

let prisma: PrismaService;
let orders: ProductionOrderService;
let standards: StandardCostService;
let workflow: WorkflowService;
let fixture: TestFixture;
let maker: { userId: string; roles: string[] };
let finance: { userId: string; roles: string[] };
const item: Record<string, string> = {};
let versionId: string;
let feedStore: string;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  const recipes = new RecipeService(prisma, audit);
  orders = new ProductionOrderService(prisma, audit, posting, workflow, recipes, new PostingControlService(prisma), new StockMovementService(prisma), new CostAllocationService());
  standards = new StandardCostService(prisma, audit, recipes);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  maker = { userId: fixture.makerId, roles: ['PRODUCTION_LEAD', 'FARM_ACCOUNTANT'] };
  finance = { userId: fixture.financeUserId, roles: ['FINANCE_CONTROLLER', 'CFO'] };
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
  const rawStore = await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'SFM-RM', name: 'Mill raw materials', type: 'RAW_MATERIAL' } });
  feedStore = (await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'SFM-FG', name: 'Released feed', type: 'FINISHED_GOODS' } })).id;
  item.RM = (
    await prisma.item.create({
      data: {
        companyId: fixture.companyId, code: 'SFM-MIX', description: 'Maize bran, soybean and calcium mix', unitOfMeasureId: uom.id,
        inventoryGlAccountId: await acct('130100'), defaultWarehouseId: rawStore.id,
        standardCosts: { create: [{ standardCostKobo: 380_00n, effectiveFrom: new Date('2026-01-01') }] },
      },
    })
  ).id;
  item.FEED = (
    await prisma.item.create({
      data: { companyId: fixture.companyId, code: 'SFD-GROWER-01', description: 'Snail grower mash', unitOfMeasureId: uom.id, inventoryGlAccountId: await acct('130110'), isManufactured: true },
    })
  ).id;
  // 1,050 kg in store that cost ₦405,000 — above the ₦380 standard.
  await prisma.$transaction((tx) =>
    new StockMovementService(prisma).receiveIn({
      tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.RM!, warehouseId: rawStore.id, quantity: new Decimal(1050),
      valueKobo: 405_000_00n, sourceModule: 'test', sourceDocumentType: 'Opening', sourceDocumentId: 'open', documentReference: 'OPEN', movementDate: new Date('2026-01-02'),
    }),
  );

  const recipe = await prisma.productRecipe.create({ data: { companyId: fixture.companyId, code: 'SFD-GROWER', name: 'Snail grower mash v03', outputItemId: item.FEED! } });
  versionId = (
    await prisma.productRecipeVersion.create({
      data: {
        recipeId: recipe.id, version: 3, batchSize: '1000', effectiveFrom: new Date('2026-01-01'),
        components: { create: [{ lineNumber: 1, componentItemId: item.RM!, quantityPerBatch: '1050', unitOfMeasureId: uom.id }] },
      },
    })
  ).id;
  await prisma.productRecipeVersion.update({ where: { id: versionId }, data: { status: 'ACTIVE' } });

  // Routing: grinding/mixing labour, the mixer, and other overhead a kg.
  const routing = new RoutingService(prisma, new AuditService(prisma));
  for (const [code, name, driver, cost, capacity, op, type, setup, run] of [
    ['SFM-LAB', 'Mill labour', 'Labour hours', 250_000_00n, '100', 'Grind and mix', 'LABOUR', '24', '0'],
    ['SFM-MCH', 'Mixer SFM-01', 'Machine hours', 500_000_00n, '100', 'Mixer run', 'MACHINE', '10', '0'],
    ['SFM-OH', 'Mill overhead', 'kg output', 35_000_00n, '1000', 'Other overhead', 'OVERHEAD', '0', '1'],
  ] as const) {
    const pool = await routing.createCostPool({ companyId: fixture.companyId, code, name, driverName: driver, actorId: fixture.makerId });
    await routing.setCostPoolRate({ companyId: fixture.companyId, poolId: pool.id, poolCost: kobo(cost), practicalCapacity: capacity, effectiveFrom: new Date('2026-01-01'), actorId: fixture.makerId });
    await routing.createRoutingOperation({
      companyId: fixture.companyId, recipeVersionId: versionId, costCentreId: fixture.costCentreId, costPoolId: pool.id,
      operationName: op, resourceType: type, setupHours: setup, runHoursPerUnit: run, actorId: fixture.makerId,
    });
  }
});

const balanceOf = async (n: string) => {
  const account = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: n } });
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: account.id }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
};

async function releasedStandard() {
  const prepared = await standards.prepare({ companyId: fixture.companyId, recipeVersionId: versionId, effectiveFrom: new Date('2026-01-01'), actor: maker });
  await standards.decide({ companyId: fixture.companyId, versionId: prepared.id, approve: true, actor: finance });
  return prepared;
}

async function throughConversion() {
  const { id } = await orders.createFeedOrder({
    companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, warehouseId: feedStore, recipeVersionId: versionId, plannedOutputQuantity: '1000', actor: maker,
  });
  const submitted = await orders.submit({ productionOrderId: id, actor: maker });
  await workflow.approve({ transactionId: submitted.transactionId, actor: { userId: fixture.checkerId, roles: ['FARM_MANAGER'] } });
  await orders.issueMaterials({ productionOrderId: id, actor: maker });
  await orders.confirmConversion({ productionOrderId: id, actualLabourCostKobo: 62_500_00n, actualOverheadCostKobo: 92_000_00n, actor: maker });
  return id;
}

describe('Standard costing (POL-001–004, SOP-049/050, PCR-032–036)', () => {
  it('rolls the feed standard up from recipe and routing: ₦544 a kg (FeedMill_Cost_Model)', async () => {
    const rolled = await standards.rollUp(fixture.companyId, versionId, new Date('2026-01-01'));
    expect(rolled.materialKobo).toBe(399_000_00n); // 1,050 kg × ₦380
    expect(rolled.labourKobo).toBe(60_000_00n); // 24 h × ₦2,500
    expect(rolled.machineKobo).toBe(50_000_00n); // 10 h × ₦5,000
    expect(rolled.overheadKobo).toBe(35_000_00n); // 1,000 kg × ₦35
    expect(rolled.packagingKobo).toBe(0n);
    expect(rolled.depreciationKobo).toBe(0n);
    expect(rolled.totalKobo).toBe(544_000_00n);
    expect(rolled.unitCostKobo).toBe(544_00n);
  });

  it('reports the six parts of POL-003: material, packaging, labour, machine, overhead, depreciation', async () => {
    const uom = await prisma.unitOfMeasure.findFirstOrThrow({ where: { companyId: fixture.companyId, code: 'KG' } });
    const bags = await prisma.item.create({
      data: {
        companyId: fixture.companyId, code: 'BAG-25', description: '25 kg feed bag', unitOfMeasureId: uom.id,
        inventoryGlAccountId: (await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: '130100' } })).id,
        standardCosts: { create: [{ standardCostKobo: 150_00n, effectiveFrom: new Date('2026-01-01') }] },
      },
    });
    const bagged = await prisma.item.create({
      data: {
        companyId: fixture.companyId, code: 'SFD-GROWER-25', description: 'Snail grower mash, bagged', unitOfMeasureId: uom.id, isManufactured: true,
        inventoryGlAccountId: (await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: '130110' } })).id,
      },
    });
    const recipe = await prisma.productRecipe.create({ data: { companyId: fixture.companyId, code: 'SFD-GROWER-BAG', name: 'Snail grower mash, bagged', outputItemId: bagged.id } });
    const draft = await prisma.productRecipeVersion.create({
      data: { recipeId: recipe.id, version: 1, batchSize: '1000', effectiveFrom: new Date('2026-01-01') },
    });
    const recipes = new RecipeService(prisma, new AuditService(prisma));
    await recipes.addComponent({ companyId: fixture.companyId, recipeVersionId: draft.id, componentItemId: item.RM!, quantityPerBatch: '1050', unitOfMeasureCode: 'KG' });
    await recipes.addComponent({ companyId: fixture.companyId, recipeVersionId: draft.id, componentItemId: bags.id, quantityPerBatch: '40', unitOfMeasureCode: 'KG', componentType: 'PACKAGING' });
    await expect(
      recipes.addComponent({ companyId: fixture.companyId, recipeVersionId: draft.id, componentItemId: bags.id, quantityPerBatch: '1', unitOfMeasureCode: 'KG', componentType: 'BIOLOGICAL' }),
    ).rejects.toThrow(/MATERIAL or PACKAGING/);
    await prisma.productRecipeVersion.update({ where: { id: draft.id }, data: { status: 'ACTIVE' } });

    const routing = new RoutingService(prisma, new AuditService(prisma));
    const pool = await routing.createCostPool({ companyId: fixture.companyId, code: 'SFM-DEP', name: 'Mill depreciation', driverName: 'Machine hours', actorId: fixture.makerId });
    await routing.setCostPoolRate({ companyId: fixture.companyId, poolId: pool.id, poolCost: kobo(120_000_00n), practicalCapacity: '100', effectiveFrom: new Date('2026-01-01'), actorId: fixture.makerId });
    await routing.createRoutingOperation({
      companyId: fixture.companyId, recipeVersionId: draft.id, costCentreId: fixture.costCentreId, costPoolId: pool.id,
      operationName: 'Mixer depreciation', resourceType: 'DEPRECIATION', setupHours: '10', runHoursPerUnit: '0', actorId: fixture.makerId,
    });

    const rolled = await standards.rollUp(fixture.companyId, draft.id, new Date('2026-01-01'));
    expect(rolled.materialKobo).toBe(399_000_00n);
    expect(rolled.packagingKobo).toBe(6_000_00n); // 40 bags × ₦150
    expect(rolled.depreciationKobo).toBe(12_000_00n); // 10 h × ₦1,200
    expect(rolled.labourKobo + rolled.machineKobo + rolled.overheadKobo).toBe(0n);
    expect(rolled.totalKobo).toBe(417_000_00n);

    const prepared = await standards.prepare({ companyId: fixture.companyId, recipeVersionId: draft.id, effectiveFrom: new Date('2026-01-01'), actor: maker });
    expect(prepared.packagingKobo).toBe(6_000_00n);
    expect(prepared.depreciationKobo).toBe(12_000_00n);
    // The total is the six parts, at the database.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO standard_cost_versions (id, company_id, item_id, recipe_version_id, financial_year_id, version_number, effective_from, output_quantity,
          material_kobo, packaging_kobo, labour_kobo, machine_kobo, overhead_kobo, depreciation_kobo, total_kobo, unit_cost_kobo, lines, prepared_by_id)
         SELECT gen_random_uuid(), company_id, item_id, recipe_version_id, financial_year_id, 99, effective_from, output_quantity,
          material_kobo, packaging_kobo, labour_kobo, machine_kobo, overhead_kobo, depreciation_kobo, material_kobo, unit_cost_kobo, lines, prepared_by_id
         FROM standard_cost_versions WHERE id = $1::uuid`,
        prepared.id,
      ),
    ).rejects.toThrow();
  });

  it('receives good feed at standard and shows every variance, WIP and recovery at zero', async () => {
    const id = await throughConversion();

    // Materials went in at standard; what the issue cost above it is a price
    // variance. The workbook's ₦405,000 is ₦404,995.50 here: moving average is
    // kept to the kobo a kg (₦385.71), so the price variance is ₦5,995.50.
    const issued = await prisma.productionOrder.findUniqueOrThrow({ where: { id } });
    const line = await prisma.productionOrderComponent.findFirstOrThrow({ where: { productionOrderId: id } });
    expect(line.issuedCostKobo).toBe(404_995_50n);
    expect(issued.packagingCostKobo).toBe(399_000_00n);
    expect(issued.materialPriceVarianceKobo).toBe(5_995_50n);
    expect(issued.materialUsageVarianceKobo).toBe(0n);
    expect(issued.standardConversionCostKobo).toBe(145_000_00n);

    // No released standard yet: the output cannot be received.
    await expect(
      orders.recordOutputs({ productionOrderId: id, outputs: [{ itemId: item.FEED!, outputType: 'MAIN', quantity: '980' }], warehouseId: feedStore, actor: maker }),
    ).rejects.toThrow(/no released FY2026 standard cost/);

    // Prepared by one person, released by another.
    const prepared = await standards.prepare({ companyId: fixture.companyId, recipeVersionId: versionId, effectiveFrom: new Date('2026-01-01'), actor: maker });
    await expect(standards.decide({ companyId: fixture.companyId, versionId: prepared.id, approve: true, actor: { ...maker, roles: ['FINANCE_CONTROLLER'] } })).rejects.toThrow(
      /someone else must release it/,
    );
    await standards.decide({ companyId: fixture.companyId, versionId: prepared.id, approve: true, actor: finance });
    await expect(prisma.standardCostVersion.update({ where: { id: prepared.id }, data: { unitCostKobo: 1n } })).rejects.toThrow(/cannot be changed once prepared/);
    const itemStandard = await prisma.itemStandardCost.findFirstOrThrow({ where: { itemId: item.FEED! } });
    expect(itemStandard.standardCostKobo).toBe(544_00n);

    await orders.recordOutputs({ productionOrderId: id, outputs: [{ itemId: item.FEED!, outputType: 'MAIN', quantity: '980' }], warehouseId: feedStore, actor: maker });
    const completed = await prisma.productionOrder.findUniqueOrThrow({ where: { id } });
    expect(completed.finishedGoodsCostKobo).toBe(533_120_00n); // 980 kg × ₦544
    expect(completed.yieldVarianceKobo).toBe(10_880_00n); // the 20 kg short, at standard

    const settled = await orders.settle({ productionOrderId: id, actor: maker });
    expect(settled.variance).toBe(9_500_00n.toString()); // ₦154,500 actual conversion vs ₦145,000 absorbed

    expect(await balanceOf('130430')).toBe(0n); // Feed Mill WIP
    expect(await balanceOf('219830')).toBe(0n); // Feed Mill Recovery GL
    // The order's ₦154,500 of actual cost leaves the feed-mill pool, where
    // payroll and depreciation put it at source (not posted in this test).
    expect(await balanceOf('623100')).toBe(-154_500_00n);
    // The workbook's total cost variance, ₦26,380, less the ₦4.50 of moving-average rounding.
    expect(await balanceOf('520500')).toBe(26_375_50n);
    expect(await balanceOf('130110')).toBe(533_120_00n); // finished feed at standard
  });

  it('refuses production in a year with no costing policy, and locks it at the first posting (AC-MFG-002)', async () => {
    await releasedStandard();
    const policy = await prisma.costingPolicy.findFirstOrThrow({ where: { companyId: fixture.companyId } });
    await prisma.costingPolicy.delete({ where: { id: policy.id } });
    await expect(throughConversion()).rejects.toThrow(/has no costing policy/);

    await standards.configurePolicy({ companyId: fixture.companyId, financialYearId: fixture.financialYearId, varianceTolerancePercent: 15, actor: finance });
    await expect(
      standards.configurePolicy({ companyId: fixture.companyId, financialYearId: fixture.financialYearId, actor: maker }),
    ).rejects.toThrow(/Only the CFO or finance controller/);
    const order = await prisma.productionOrder.findFirstOrThrow({ where: { companyId: fixture.companyId } });
    await orders.issueMaterials({ productionOrderId: order.id, actor: maker });

    const locked = await prisma.costingPolicy.findFirstOrThrow({ where: { companyId: fixture.companyId } });
    expect(locked.lockedAt).not.toBeNull();
    await expect(
      standards.configurePolicy({ companyId: fixture.companyId, financialYearId: fixture.financialYearId, varianceTolerancePercent: 25, actor: finance }),
    ).rejects.toThrow(/locked by its first production posting/);
    await expect(prisma.costingPolicy.update({ where: { id: locked.id }, data: { varianceTolerancePercent: 30 } })).rejects.toThrow(/locked/);
    await expect(prisma.$executeRawUnsafe(`UPDATE costing_policies SET method = 'ACTUAL' WHERE id = $1::uuid`, locked.id)).rejects.toThrow();
  });

  it('puts extra material used at standard rate into usage variance (PCR-052)', async () => {
    await releasedStandard();
    const { id } = await orders.createFeedOrder({
      companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, warehouseId: feedStore, recipeVersionId: versionId, plannedOutputQuantity: '1000', actor: maker,
    });
    const submitted = await orders.submit({ productionOrderId: id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: { userId: fixture.checkerId, roles: ['FARM_MANAGER'] } });
    const line = await prisma.productionOrderComponent.findFirstOrThrow({ where: { productionOrderId: id } });
    await orders.issueMaterials({ productionOrderId: id, actualQuantities: { [line.id]: '1000' }, actor: maker }); // 50 kg under standard
    const issued = await prisma.productionOrderComponent.findFirstOrThrow({ where: { id: line.id } });
    expect(issued.issuedQuantity?.toString()).toBe('1000');
    expect(issued.usageVarianceKobo).toBe(-19_000_00n); // 50 kg saved × ₦380
    // 1,000 kg at ₦385.71 moving average = ₦385,714; less standard ₦399,000 and the usage saving: price ₦5,714.
    expect(issued.priceVarianceKobo).toBe(issued.issuedCostKobo! - 399_000_00n + 19_000_00n);
    const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id } });
    expect(order.packagingCostKobo).toBe(399_000_00n);
  });
});
