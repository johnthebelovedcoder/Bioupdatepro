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
import { FeedQualityService } from '../../src/production/feed-quality.service';
import { VarianceProrationService } from '../../src/production/variance-proration.service';
import { PeriodCloseService } from '../../src/closing/period-close.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { resetDatabase, seedFixture, TestFixture, dims } from '../helpers/test-db';

/**
 * The feed mill on the approved five-digit chart: raw materials out of feed
 * ingredients (12100) into feed mill WIP (13200), standard conversion absorbed
 * to the one feed mill recovery account (54300), finished feed received at
 * standard into 12450, and a settlement that clears WIP and recovery with the
 * yield and formulation variance in 53600. The same order as the standard
 * costing spec, against the workbook's FeedMill_Cost_Model snail-feed order:
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
let posting: PostingService;
let fixture: TestFixture;
let maker: { userId: string; roles: string[] };
let finance: { userId: string; roles: string[] };
const item: Record<string, string> = {};
let versionId: string;
let feedStore: string;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
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
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'APPROVED' } });
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
        inventoryGlAccountId: await acct('12100'), defaultWarehouseId: rawStore.id,
        standardCosts: { create: [{ standardCostKobo: 380_00n, effectiveFrom: new Date('2026-01-01') }] },
      },
    })
  ).id;
  item.FEED = (
    await prisma.item.create({
      data: { companyId: fixture.companyId, code: 'SFD-GROWER-01', description: 'Snail grower mash', unitOfMeasureId: uom.id, inventoryGlAccountId: await acct('12450'), isManufactured: true },
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
    companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, warehouseId: feedStore, recipeVersionId: versionId, plannedOutputQuantity: '1000', speciesKey: 'snail', actor: maker,
  });
  const submitted = await orders.submit({ productionOrderId: id, actor: maker });
  await workflow.approve({ transactionId: submitted.transactionId, actor: { userId: fixture.checkerId, roles: ['FARM_MANAGER'] } });
  await orders.issueMaterials({ productionOrderId: id, actor: maker });
  await orders.confirmConversion({ productionOrderId: id, actualLabourCostKobo: 62_500_00n, actualOverheadCostKobo: 92_000_00n, actor: maker });
  return id;
}

/** Post shared payroll/depreciation actuals to their source ledgers, freeze the
 * period at soft close, then allocate those balances to completed orders. */
async function allocateActualCosts(orderIds: string[]) {
  const converted = await prisma.productionOrder.findMany({
    where: { id: { in: orderIds }, companyId: fixture.companyId },
    include: { conversionJournalEntry: { select: { financialPeriodId: true } } },
  });
  if (converted.length !== orderIds.length || converted.some((order) => !order.conversionJournalEntry)) {
    throw new Error('Every allocation fixture order must have a conversion journal.');
  }
  const periodId = converted[0]!.conversionJournalEntry!.financialPeriodId;
  if (converted.some((order) => order.conversionJournalEntry!.financialPeriodId !== periodId)) {
    throw new Error('One shared actual-cost run can only cover orders in one period.');
  }
  const periodIndex = fixture.periodIds.indexOf(periodId);
  if (periodIndex < 0) throw new Error('Conversion period is outside the fixture financial year.');
  const sourceTotals = converted.reduce(
    (sum, order) => ({ labour: sum.labour + order.actualLabourCostKobo, overhead: sum.overhead + order.actualOverheadCostKobo }),
    { labour: 0n, overhead: 0n },
  );
  const account = async (number: string, name: string) => {
    const existing = await prisma.gLAccount.findFirst({ where: { companyId: fixture.companyId, accountNumber: number } });
    return existing ?? prisma.gLAccount.create({
      data: { companyId: fixture.companyId, accountNumber: number, name, accountType: 'EXPENSE', normalBalance: 'DEBIT', requiresCostCentre: true },
    });
  };
  const [labourAccount, overheadAccount, bankAccount] = await Promise.all([
    account('621100', 'Feed Mill Labour Actual'), account('623100', 'Feed Mill Overhead Actual'),
    prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: '1101' } }),
  ]);
  const routing = new RoutingService(prisma, new AuditService(prisma));
  const pools = await prisma.costPool.findMany({ where: { companyId: fixture.companyId, code: { in: ['SFM-LAB', 'SFM-OH'] } } });
  const labourPool = pools.find((pool) => pool.code === 'SFM-LAB')!;
  const overheadPool = pools.find((pool) => pool.code === 'SFM-OH')!;
  await routing.setPoolSources({ companyId: fixture.companyId, poolId: labourPool.id, sources: [{ glAccountId: labourAccount.id, costCentreId: fixture.costCentreId, resourceType: 'LABOUR' }], actorId: fixture.financeUserId });
  await routing.setPoolSources({ companyId: fixture.companyId, poolId: overheadPool.id, sources: [{ glAccountId: overheadAccount.id, costCentreId: fixture.costCentreId, resourceType: 'OVERHEAD' }], actorId: fixture.financeUserId });

  const dimensions = dims(fixture, periodIndex, { costCentreId: fixture.costCentreId });
  const period = await prisma.financialPeriod.findUniqueOrThrow({ where: { id: periodId } });
  await posting.post({
    sourceModule: 'test-payroll-fixed-assets', sourceDocumentType: 'ActualCostSources', journalNumber: `TEST-FM-ACT-${period.periodNumber}`,
    journalDate: period.startDate, narration: 'Feed mill actual labour and overhead from source ledgers', companyId: fixture.companyId,
    branchId: fixture.branchId, financialYearId: fixture.financialYearId, financialPeriodId: periodId, currencyId: fixture.currencyId,
    exchangeRate: '1.00000000', idempotencyKey: `standard-costing:actual-source:${periodId}`, actor: finance,
    lines: [
      ...(sourceTotals.labour > 0n ? [{ glAccountId: labourAccount.id, description: 'Payroll actuals', debit: kobo(sourceTotals.labour), dimensions }] : []),
      ...(sourceTotals.overhead > 0n ? [{ glAccountId: overheadAccount.id, description: 'Depreciation and operating overhead actuals', debit: kobo(sourceTotals.overhead), dimensions }] : []),
      { glAccountId: bankAccount.id, description: 'Settlement of feed mill actual costs', credit: kobo(sourceTotals.labour + sourceTotals.overhead), dimensions },
    ],
  });
  const audit = new AuditService(prisma);
  const close = new PeriodCloseService(prisma, audit, new TrialBalanceService(prisma), workflow);
  await close.softClose({ financialPeriodId: periodId, actor: finance, reason: 'Freeze actual cost source ledgers for UAT allocation.' });
  return routing.allocateFeedMillActualCosts({ companyId: fixture.companyId, financialPeriodId: periodId, actorId: fixture.financeUserId });
}

describe('Feed mill on the approved chart', () => {
  it('receives good feed at standard and settles with WIP and recovery at exactly zero', async () => {
    const id = await throughConversion();
    expect(await balanceOf('13200')).toBeGreaterThan(0n);
    expect(await balanceOf('54300')).toBe(-145_000_00n); // standard conversion absorbed to the one recovery account
    expect(await balanceOf('12100')).toBe(-405_000_00n); // ingredients out of feed ingredients control

    await releasedStandard();
    await orders.recordOutputs({ productionOrderId: id, outputs: [{ itemId: item.FEED!, outputType: 'MAIN', quantity: '980' }], warehouseId: feedStore, actor: maker });
    const completed = await prisma.productionOrder.findUniqueOrThrow({ where: { id } });
    expect(completed.finishedGoodsCostKobo).toBe(533_120_00n); // 980 kg × ₦544

    await allocateActualCosts([id]);
    const settled = await orders.settle({ productionOrderId: id, actor: finance });
    expect(settled.variance).toBe(9_500_00n.toString()); // ₦154,500 actual conversion vs ₦145,000 absorbed

    expect(await balanceOf('13200')).toBe(0n); // Feed Mill WIP
    expect(await balanceOf('54300')).toBe(0n); // Feed Mill Recovery
    expect(await balanceOf('53600')).toBe(26_380_00n); // the workbook's total cost variance, in the feed mill variance account
    expect(await balanceOf('12450')).toBe(533_120_00n); // finished feed at standard
  });
});
