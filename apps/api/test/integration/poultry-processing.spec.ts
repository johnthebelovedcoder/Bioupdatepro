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
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Poultry processing and close (UAT-020): birds and packaging into WIP, standard
 * conversion absorbed against the poultry recovery account, dressed birds and
 * by-products out, and a settlement that clears WIP, recovery and the single
 * actual conversion pool (PCR-077/080) — the same engine as snails, its own accounts.
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
    ['MEAT', 'Dressed chicken', '130520'],
    ['SHELL', 'Offal and feathers', '130520'],
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
});

const wip = async () => {
  const account = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: '130420' } });
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

describe('Poultry processing and close (UAT-020)', () => {
  it('runs issue → conversion → output → settle, and closes with WIP and recovery at exactly zero and the variance shown', async () => {
    const id = await throughConversion();
    // In WIP: ₦1.5m of snails + ₦5,000 of packaging + ₦1.4m standard conversion.
    expect(await wip()).toBe(1_500_000_00n + 5_000_00n + 1_400_000_00n);

    await intake(id);
    await orders.recordOutputs({
      productionOrderId: id, warehouseId: fgStore, actor: maker, normalLossQuantity: '38', details: coldStore,
      outputs: [
        { itemId: item.MEAT!, outputType: 'MAIN', quantity: '36', weight: '36' },
        { itemId: item.SHELL!, outputType: 'BY_PRODUCT', quantity: '16', weight: '16' },
      ],
    });
    expect(await wip()).toBe(0n); // everything in WIP went to finished goods

    const settled = await orders.settle({ productionOrderId: id, actor: maker });
    expect(settled.variance).toBe('10000000'); // actual ₦1.5m against ₦1.4m standard: ₦100,000 adverse
    expect(await balanceOf('219820')).toBe(0n); // the recovery account clears
    // …and so do the actual pools the order charged (PCR-058): no residual processing expense.
    expect(await balanceOf('622100')).toBe(0n); // PCR-077's single conversion pool
    expect(await balanceOf('520300')).toBe(100_000_00n); // the variance, and only the variance, in the P&L
    // Finished goods carry exactly the standard cost path: snails + packaging + standard conversion.
    expect((await balanceOf('130520'))).toBe(1_500_000_00n + 5_000_00n + 1_400_000_00n);
    expect(await wip()).toBe(0n);
    const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id } });
    expect(order.settledAt).not.toBeNull();

    // The Controls reconciliation agrees: WIP and recovery tie to the orders (UAT-021/024).
    const rows = await new ControlAccountReconciliationService(prisma, new TrialBalanceService(prisma)).reconcile(fixture.companyId);
    const processing = rows.filter((row) => /^(1304|2198)/.test(row.accountNumber));
    expect(processing.length).toBe(2);
    expect(processing.every((row) => row.reconciled)).toBe(true);
  });

  it('shows the ₦40,000 poultry variance of the sample (AC-MFG-008, STANDARD_COST_CONTROL)', async () => {
    const { id } = await orders.createFromHarvest({ harvestRecordId: harvestId, recipeVersionId: versionId, warehouseId: fgStore, plannedOutputQuantity: '90', actor: maker });
    const submitted = await orders.submit({ productionOrderId: id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.issueMaterials({ productionOrderId: id, actor: maker });
    // Labour ₦220,000 + machine ₦160,000 + overhead ₦240,000 at standard; ₦235,000 + ₦170,000 + ₦255,000 actual.
    await orders.confirmConversion({ productionOrderId: id, standardConversionCostKobo: 620_000_00n, actualLabourCostKobo: 235_000_00n, actualOverheadCostKobo: 425_000_00n, actor: maker });
    await intake(id);
    await orders.recordOutputs({
      productionOrderId: id, warehouseId: fgStore, actor: maker, normalLossQuantity: '38', details: coldStore,
      outputs: [
        { itemId: item.MEAT!, outputType: 'MAIN', quantity: '36', weight: '36' },
        { itemId: item.SHELL!, outputType: 'BY_PRODUCT', quantity: '16', weight: '16' },
      ],
    });
    const settled = await orders.settle({ productionOrderId: id, actor: maker });
    expect(settled.variance).toBe(40_000_00n.toString());
    expect(await balanceOf('520300')).toBe(40_000_00n);
    expect(await balanceOf('219820')).toBe(0n);
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

  it('records the plant intake, and will not receive outputs until dead-on-arrival and condemned birds are claimed as abnormal loss (handbook §29)', async () => {
    const id = await throughConversion();
    const base = { productionOrderId: id, plantReceivedCount: 500, plantReceivedWeightKg: '89', deadOnArrivalCount: 5, deadOnArrivalWeightKg: '1', actor: maker };
    await expect(orders.recordIntake({ ...base, plantReceivedCount: 501, condemnedCount: 0, condemnedWeightKg: '0' })).rejects.toThrow(/501 birds received, but the catch was 500/);
    await expect(orders.recordIntake({ ...base, plantReceivedWeightKg: '91', condemnedCount: 0, condemnedWeightKg: '0' })).rejects.toThrow(/do not gain weight in transit/);
    await expect(orders.recordIntake({ ...base, condemnedCount: 10, condemnedWeightKg: '2' })).rejects.toThrow(/reason and the vet or inspector/);
    const recorded = await orders.recordIntake({ ...base, condemnedCount: 10, condemnedWeightKg: '2', condemnationReason: 'Septicaemia', inspectedBy: 'Dr Bello' });
    expect(recorded).toMatchObject({ transitShrinkKg: '1.000', abnormalLossKgToClaim: '3.000' });

    await expect(
      orders.recordOutputs({
        productionOrderId: id, warehouseId: fgStore, actor: maker, normalLossQuantity: '35', details: coldStore,
        outputs: [
          { itemId: item.MEAT!, outputType: 'MAIN', quantity: '36', weight: '36' },
          { itemId: item.SHELL!, outputType: 'BY_PRODUCT', quantity: '16', weight: '16' },
        ],
      }),
    ).rejects.toThrow(/3.000 kg was dead on arrival or condemned, but only 0.000 kg of abnormal loss is recorded/);
    await expect(
      orders.recordOutputs({
        productionOrderId: id, warehouseId: fgStore, actor: maker, normalLossQuantity: '35', details: [{ grade: 'A' }, coldStore[1]!],
        outputs: [
          { itemId: item.MEAT!, outputType: 'MAIN', quantity: '36', weight: '36' },
          { itemId: item.SHELL!, outputType: 'BY_PRODUCT', quantity: '16', weight: '16' },
        ],
      }),
    ).rejects.toThrow(/./);
  });
});
