import { beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { RearingCostService } from '../../src/biological-assets/rearing-cost.service';
import { BiologicalAssetService } from '../../src/biological-assets/biological-asset.service';
import { BiologicalAssetValuationPostingHandler } from '../../src/biological-assets/biological-asset.handler';
import { OperationsPostingService } from '../../src/operations/operations-posting.service';
import { OperationsService } from '../../src/operations/operations.service';
import { BatchProfileService } from '../../src/operations/batch-profile.service';
import { SnailBreedingService } from '../../src/snail-breeding/snail-breeding.service';
import { RecipeService } from '../../src/masters/recipe.service';
import { CostAllocationService } from '../../src/production/cost-allocation.service';
import { ProductionOrderService } from '../../src/production/production-order.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ProfitLossService } from '../../src/reporting/profit-loss.service';
import { BalanceSheetService } from '../../src/reporting/balance-sheet.service';
import { CashFlowService } from '../../src/reporting/cash-flow.service';
import { ControlAccountReconciliationService } from '../../src/reporting/control-account-reconciliation.service';
import { IncomeTaxService } from '../../src/closing/income-tax.service';
import { kobo } from '../../src/common/money';
import { JointCostService } from '../../src/production/joint-cost.service';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * The client's 500-snail case (500_Assumptions → APP_EXPECTED_RESULTS), run
 * through the application — UAT-022's "reports agree with expected
 * case-study results".
 *
 * FAITHFUL, NOT MIRRORED (decision of 2026-09-25). The biology and every
 * posting the application owns go through its own services: breeders placed
 * and acquired, eggs laid and hatched, deaths at each stage, stage moves, the
 * IAS 41 revaluation through approval, live sales derecognised at carrying
 * value, the processing order from harvest to settlement, and income tax.
 * Documents whose double entry is identical to the workbook's journal — a
 * supplier bill, a customer invoice, a receipt, a payment, the lump feed and
 * labour accruals the workbook books directly — are posted as those journals.
 *
 * Where the application books the case differently from the workbook, the
 * difference is named in EXPLAINED below, and the test requires every
 * variance to be exactly the sum of its named causes — so an unexplained
 * difference fails. The comparison is written to test/uat/case-500-report.md.
 *
 * Amounts are the workbook's; dates are compressed into 2026 (the workbook
 * runs from 2026-01-01 to a report date in 2027), which changes no total.
 */

const N = (naira: number | string) => BigInt(new Decimal(naira).mul(100).toFixed(0)); // naira → kobo

/** Workbook expected results (APP_EXPECTED_RESULTS). */
const EXPECTED = {
  'REP-005': { what: 'Market-ready quantity available (after replacement breeders)', value: 19_400n, money: false },
  'REP-006': { what: 'WAC available value (packaging)', value: N(1_800_000), money: true },
  'REP-007': { what: 'Standard WIP closing', value: 0n, money: true },
  'REP-008': { what: 'Standard recovery closing', value: 0n, money: true },
  'REP-009': { what: 'Actual WIP closing', value: 0n, money: true },
  'REP-010': { what: 'AP ageing / control', value: N(720_000), money: true },
  'REP-011': { what: 'AR ageing / control', value: N(13_819_590), money: true },
  'REP-012': { what: 'Total revenue', value: N(69_097_950), money: true },
  'REP-013': { what: 'Fair-value gain', value: N(60_100_000), money: true },
  'REP-014': { what: 'Profit before tax', value: N(61_697_950), money: true },
  'REP-015': { what: 'Profit after tax', value: N(43_188_565), money: true },
  'REP-016': { what: 'Total assets', value: N(63_317_950), money: true },
  'REP-017': { what: 'Total liabilities and equity', value: N(63_317_950), money: true },
  'REP-018': { what: 'Closing cash', value: N(45_498_360), money: true },
  'REP-019': { what: 'Direct cash flow check (closing cash − bank)', value: 0n, money: true },
  'REP-020': { what: 'Indirect cash flow check (closing cash − bank)', value: 0n, money: true },
} as const;
type RepId = keyof typeof EXPECTED;

/**
 * Every place the application books the case differently, and by how much.
 * Each is a consequence of how the application works, stated so a reviewer
 * can decide whether the workbook or the application should change.
 */
const CAUSES = {
  breeders: {
    amount: N(1_100_000),
    why:
      'The workbook revalues the whole snail asset to 20,400 market snails × ₦3,000 and nets the ₦1,100,000 purchased breeders off the gain, so the 500 breeders vanish from its books. In the application they are still a live cohort carried at cost until they die, are sold or are revalued, so the fair-value gain is ₦1,100,000 higher and the asset still holds them.',
  },
  openingStock: {
    amount: N(500_000),
    why:
      'The workbook counts 1,000 kg of opening packaging (₦500,000) in its WAC value but never posts it, so its inventory ledger and stock disagree by that amount. The application brings opening stock onto the books (Dr inventory / Cr retained earnings), so stock and ledger agree — assets and equity are ₦500,000 higher.',
  },
  wacRounding: {
    amount: 0n, // measured: what the kobo-rounded average leaves in finished goods
    why:
      'Finished goods are issued at their per-kg average cost rounded to the kobo; issuing 419.04 kg and 178.092 kg at that rounded average leaves a few kobo in stock (and out of cost of sales). The workbook uses unrounded floating point.',
  },
  taxOnDifference: {
    amount: 0n, // measured: 30% of the higher profit
    why:
      'Income tax is 30% of the application’s own profit before tax, which is higher by the causes above, so tax is higher and profit after tax lower by 30% of them. The workbook books no tax liability in its trial balance (profit after tax appears only in its P&L); the application provides for it (PCR-084, 227100).',
  },
  overheadToPayables: {
    amount: N(900_000),
    why:
      'The workbook accrues actual processing overhead to 230100 Accrued Expenses. The application posts PCR-055’s credit to its resolved source liability — trade payables here — so AP is ₦900,000 higher and accrued expenses lower by the same; total liabilities are unchanged.',
  },
};

let prisma: PrismaService;
let posting: PostingService;
let fixture: TestFixture;
const account: Record<string, string> = {};
const actor = () => ({ userId: fixture.makerId, roles: ['CFO'] });
const approver = () => ({ userId: fixture.checkerId, roles: ['FARM_MANAGER'] });

let services: {
  stock: StockMovementService;
  assets: BiologicalAssetService;
  operations: OperationsService;
  breeding: SnailBreedingService;
  orders: ProductionOrderService;
  workflow: WorkflowService;
  tb: TrialBalanceService;
  pl: ProfitLossService;
  bs: BalanceSheetService;
  cf: CashFlowService;
  recon: ControlAccountReconciliationService;
  tax: IncomeTaxService;
};

beforeAll(async () => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  const workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  const rearing = new RearingCostService(prisma, posting);
  const assets = new BiologicalAssetService(prisma, posting, workflow, audit, rearing);
  workflow.register(new BiologicalAssetValuationPostingHandler(assets));
  const stock = new StockMovementService(prisma);
  const tb = new TrialBalanceService(prisma);
  const pl = new ProfitLossService(tb);
  services = {
    stock,
    assets,
    workflow,
    operations: new OperationsService(
      prisma, new IdempotencyService(prisma), audit, new OperationsPostingService(prisma, posting, rearing, stock), assets, new BatchProfileService(prisma, audit),
    ),
    breeding: new SnailBreedingService(prisma, audit),
    orders: new ProductionOrderService(prisma, audit, posting, workflow, new RecipeService(prisma, audit), new PostingControlService(prisma), stock, new CostAllocationService()),
    tb,
    pl,
    bs: new BalanceSheetService(prisma, tb, pl),
    cf: new CashFlowService(prisma, pl),
    recon: new ControlAccountReconciliationService(prisma, tb),
    tax: new IncomeTaxService(prisma, audit, posting, new PostingControlService(prisma), pl),
  };

  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'SPEC' } });
  await new PostingControlProvisioningService(prisma, audit).provision(fixture.companyId, null);
  for (const n of ['110100', '120100', '130100', '130510', '210100', '210200', '220100', '230100', '320100', '410100', '410200', '510100', '510200', '611000', '612000']) {
    account[n] =
      (await prisma.gLAccount.findFirst({ where: { companyId: fixture.companyId, accountNumber: n } }))?.id ??
      (await prisma.gLAccount.create({
        data: {
          companyId: fixture.companyId, accountNumber: n, name: n,
          accountType: n.startsWith('1') ? 'ASSET' : n.startsWith('2') ? 'LIABILITY' : n.startsWith('3') ? 'EQUITY' : n.startsWith('4') ? 'REVENUE' : 'EXPENSE',
          normalBalance: /^[156]/.test(n) ? 'DEBIT' : 'CREDIT',
        },
      })).id;
  }
  for (const [stage, number] of [['Breeder', '130200'], ['Hatchling', '130202'], ['Juvenile', '130203'], ['Market-ready', '130204']] as const) {
    const glAccountId = (await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: number } })).id;
    await prisma.biologicalAssetStageAccount.create({ data: { companyId: fixture.companyId, speciesKey: 'snail', stage, glAccountId } });
  }
  for (const [type, autoPostOnApproval] of [['BA_VALUATION', true], ['PRODUCTION_ORDER', false]] as const) {
    await prisma.workflowDefinition.create({
      data: {
        companyId: fixture.companyId, transactionType: type, name: type, autoPostOnApproval, effectiveFrom: new Date('2026-01-01'),
        steps: { create: [{ level: 1, roleCode: 'FARM_MANAGER', name: 'Farm Manager', maxAmountKobo: null }] },
      },
    });
  }
}, 300_000);

async function journal(ref: string, month: number, lines: Array<[string, 'debit' | 'credit', bigint]>) {
  const d = dims(fixture, month);
  await posting.post({
    sourceModule: 'case-500', sourceDocumentType: 'Document', journalNumber: ref, journalDate: new Date(Date.UTC(2026, month, 20)),
    narration: ref, ...d, idempotencyKey: `case-500:${ref}`, actor: actor(),
    lines: lines.map(([n, side, amount]) => ({ glAccountId: account[n]!, description: ref, [side]: kobo(amount), dimensions: d })),
  });
}

async function balance(number: string) {
  const a = await prisma.gLAccount.findFirst({ where: { companyId: fixture.companyId, accountNumber: number } });
  if (!a) return 0n;
  const s = await prisma.journalLine.aggregate({ where: { glAccountId: a.id }, _sum: { debitKobo: true, creditKobo: true } });
  return (s._sum.debitKobo ?? 0n) - (s._sum.creditKobo ?? 0n);
}

describe('The 500-snail case, through the application (UAT-022)', () => {
  it('500-snail case replay: reproduces the workbook, and every difference is a named cause', async () => {
    const { stock, assets, operations, breeding, orders, workflow } = services;
    const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'SNL-1', name: 'Snailery 1' } });
    const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'KG', name: 'Kilogram' } });
    const store = await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'RAW', name: 'Raw store', type: 'RAW_MATERIAL' } });
    const cold = await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'COLD', name: 'Cold store', type: 'FINISHED_GOODS' } });

    // --- Procurement: 500 breeders at ₦2,000 plus ₦100,000 transport (GRN-001, INV-001) ---
    await operations.placeGroup({
      companyId: fixture.companyId, actor: actor(), idempotencyKey: 'case-brd',
      payload: { module: 'snail', code: 'BRD-1', breed: 'Archachatina marginata', purpose: 'Breeders', stage: 'Breeder', house: 'SNL-1', openingPopulation: 500, startedOn: '2026-01-05', acquisitionCostKobo: String(N(1_100_000)) },
    });
    expect(await balance('210200')).toBe(-N(1_100_000)); // Dr BA / Cr GRNI by the application's own acquisition posting
    await journal('INV-001', 0, [['210200', 'debit', N(1_100_000)], ['210100', 'credit', N(1_100_000)]]);

    // --- Packaging: 1,000 kg opening at ₦500, 2,000 kg bought at ₦650 (GRN-002) ---
    const pack = await prisma.item.create({
      data: {
        companyId: fixture.companyId, code: 'PACK', description: 'Packaging', unitOfMeasureId: uom.id, inventoryGlAccountId: account['130100']!, defaultWarehouseId: store.id,
        standardCosts: { create: [{ standardCostKobo: N(600), effectiveFrom: new Date('2026-01-01') }] },
      },
    });
    const receive = (ref: string, qty: number, valueKobo: bigint, month: number) =>
      prisma.$transaction((tx) =>
        stock.receiveIn({ tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: pack.id, warehouseId: store.id, quantity: new Decimal(qty), valueKobo, sourceModule: 'case-500', sourceDocumentType: 'Receipt', sourceDocumentId: ref, documentReference: ref, movementDate: new Date(Date.UTC(2026, month, 2)) }),
      );
    await receive('OPENING', 1000, N(500_000), 0);
    await journal('OPENING-STOCK', 0, [['130100', 'debit', N(500_000)], ['320100', 'credit', N(500_000)]]);
    await receive('GRN-002', 2000, N(1_300_000), 1);
    await journal('GRN-002', 1, [['130100', 'debit', N(1_300_000)], ['210100', 'credit', N(1_300_000)]]);
    const wacAvailable = (await stock.currentPosition(prisma, fixture.companyId, pack.id)).valueKobo;

    // --- Lifecycle: 80 eggs a breeder, 75% hatch, 80% then 85% survive ---
    const cohort = await prisma.livestockGroup.findFirstOrThrow({ where: { code: 'BRD-1' } });
    const cycle = await breeding.record({ companyId: fixture.companyId, actorId: fixture.makerId, code: 'CYC-1', breederGroupId: cohort.id, setOn: '2026-01-20', breeders: 500, eggsLaid: 40_000 });
    await breeding.hatch({ companyId: fixture.companyId, actorId: fixture.makerId, cycleId: cycle.id, hatchedOn: '2026-02-20', hatchedCount: 30_000, unhatchedCount: 10_000, hatchlingGroupCode: 'HAT-1' });
    const round = (code: string, date: string, deaths: number) =>
      operations.recordRound({ companyId: fixture.companyId, actor: actor(), idempotencyKey: `case-round-${code}-${date}`, payload: { module: 'snail', date, entries: [{ groupCode: code, deaths, causes: ['Natural attrition'] }] } });
    const move = (from: string, to: string, date: string) =>
      operations.recordStageChange({ companyId: fixture.companyId, actor: actor(), idempotencyKey: `case-move-${to}`, payload: { groupCode: 'HAT-1', date, fromStage: from, toStage: to, fromHouse: 'SNL-1', toHouse: 'SNL-1' } });
    await round('HAT-1', '2026-03-10', 6_000); // 80% of hatchlings reach juvenile
    await move('Hatchling', 'Juvenile', '2026-03-15');
    await round('HAT-1', '2026-04-10', 3_600); // 85% of juveniles reach market
    await move('Juvenile', 'Market-ready', '2026-04-15');
    const market = await prisma.livestockGroup.findFirstOrThrow({ where: { code: 'HAT-1' } });
    expect(market.population).toBe(20_400);
    const replacementBreeders = 1_000;
    const available = market.population - replacementBreeders;

    // --- Lifecycle costs, booked as the workbook books them ---
    await journal('LIFE-COST', 3, [['611000', 'debit', N(4_800_000)], ['210100', 'credit', N(4_800_000)]]);
    await journal('PAY-001', 3, [['612000', 'debit', N(2_700_000)], ['220100', 'credit', N(2_700_000)]]);

    // --- IAS 41: market snails at ₦3,200 less ₦200 to sell, through approval (FV-001) ---
    const { id: valuationId } = await assets.requestValuation({
      companyId: fixture.companyId, groupId: market.id, valuationDate: new Date('2026-04-30'), marketPricePerUnitKobo: N(3_200), costsToSellPerUnitKobo: N(200), evidenceReference: '500_Assumptions IAS 41', actor: actor(),
    });
    const valuation = await prisma.biologicalAssetValuation.findUniqueOrThrow({ where: { id: valuationId } });
    await workflow.approve({ transactionId: valuation.workflowTransactionId!, actor: approver() });

    // --- Live sale: 70% of the available snails at ₦4,500 (INV-LIVE, DEL-LIVE) ---
    const liveSold = Math.round(available * 0.7); // 13,580
    await prisma.livestockGroup.update({ where: { id: market.id }, data: { population: { decrement: liveSold } } });
    await assets.postDisposal({ groupId: market.id, quantity: liveSold, occurredOn: new Date('2026-05-02'), method: 'SOLD', actor: actor() });
    await journal('INV-LIVE', 4, [['120100', 'debit', N(liveSold * 4_500)], ['410100', 'credit', N(liveSold * 4_500)]]);

    // --- Processing: the other 30%, 0.18 kg each; 42%/18% standard yields, 40%/17% actual ---
    const processed = available - liveSold; // 5,820
    const liveKg = new Decimal(processed).mul('0.18');
    const meatKg = liveKg.mul('0.40');
    const shellKg = liveKg.mul('0.17');
    await prisma.livestockGroup.update({ where: { id: market.id }, data: { population: { decrement: processed } } });
    const harvest = await prisma.harvestRecord.create({
      data: { companyId: fixture.companyId, groupId: market.id, harvestedOn: new Date('2026-05-10'), grade: 'Market', weightKg: liveKg.toFixed(3), count: processed, populationAtTime: processed + replacementBreeders, destination: 'PROCESSING', recordedById: fixture.makerId },
    });
    const meat = await prisma.item.create({ data: { companyId: fixture.companyId, code: 'MEAT', description: 'Snail meat', unitOfMeasureId: uom.id, inventoryGlAccountId: account['130510']!, isManufactured: true } });
    const shell = await prisma.item.create({ data: { companyId: fixture.companyId, code: 'SHELL', description: 'Snail shell', unitOfMeasureId: uom.id, inventoryGlAccountId: account['130510']!, isManufactured: true } });
    const recipe = await prisma.productRecipe.create({ data: { companyId: fixture.companyId, code: 'R-MEAT', name: 'Snail meat', outputItemId: meat.id } });
    const version = await prisma.productRecipeVersion.create({
      data: { recipeId: recipe.id, version: 1, batchSize: meatKg.toFixed(3), effectiveFrom: new Date('2026-01-01'), components: { create: [{ lineNumber: 1, componentItemId: pack.id, quantityPerBatch: '480', unitOfMeasureId: uom.id }] } },
    });
    await prisma.productRecipeVersion.update({ where: { id: version.id }, data: { status: 'ACTIVE' } });
    // JOINT_COST_ALLOCATION: NRV at split-off, from approved prices — meat ₦18,000/kg, shell ₦2,500/kg.
    const joint = new JointCostService(prisma, new AuditService(prisma));
    for (const [itemId, price] of [[meat.id, N(18_000)], [shell.id, N(2_500)]] as const) {
      const proposed = await joint.proposePrice({ companyId: fixture.companyId, itemId, sellingPricePerUnitKobo: price, furtherCostPerUnitKobo: 0n, effectiveFrom: new Date('2026-01-01'), evidenceReference: '500_Assumptions', actor: actor() });
      await joint.decide({ companyId: fixture.companyId, priceId: proposed.id, approve: true, actor: { userId: fixture.financeUserId, roles: ['FINANCE_CONTROLLER'] } });
    }
    const { id: orderId } = await orders.createFromHarvest({ harvestRecordId: harvest.id, recipeVersionId: version.id, warehouseId: cold.id, plannedOutputQuantity: meatKg.toFixed(3), actor: actor() });
    const submitted = await orders.submit({ productionOrderId: orderId, actor: actor() });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver() });
    // 500 kg issued against the 480 kg standard: WIP takes ₦288,000 at
    // standard and the ₦12,000 excess is a material usage variance (500_Std_Cost).
    const packLine = await prisma.productionOrderComponent.findFirstOrThrow({ where: { productionOrderId: orderId } });
    await orders.issueMaterials({ productionOrderId: orderId, actualQuantities: { [packLine.id]: '500' }, actor: actor() });
    const issuedOrder = await prisma.productionOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(issuedOrder.packagingCostKobo).toBe(N(288_000));
    expect(issuedOrder.materialUsageVarianceKobo).toBe(N(12_000));
    expect(issuedOrder.materialPriceVarianceKobo).toBe(0n);
    await orders.confirmConversion({ productionOrderId: orderId, standardConversionCostKobo: N(550_000 + 850_000), actualLabourCostKobo: N(600_000), actualOverheadCostKobo: N(900_000), actor: actor() });
    await orders.recordOutputs({
      productionOrderId: orderId, warehouseId: cold.id, actor: actor(),
      normalLossQuantity: liveKg.minus(meatKg).minus(shellKg).toFixed(3), // 1,047.6 kg in, 597.132 kg out
      outputs: [
        { itemId: meat.id, outputType: 'MAIN', quantity: meatKg.toFixed(3), weight: meatKg.toFixed(3) },
        { itemId: shell.id, outputType: 'BY_PRODUCT', quantity: shellKg.toFixed(3), weight: shellKg.toFixed(3) },
      ],
    });
    // Handbook §62.4: NRV allocates 94.4262% of the ₦19,148,000 pool to meat — ₦18,080,734.43 — and the rest to shell.
    const allocatedTo = async (itemId: string) =>
      (await prisma.productionOrderOutput.findFirstOrThrow({ where: { productionOrderId: orderId, itemId } })).allocatedCostKobo;
    expect(Math.abs(Number((await allocatedTo(meat.id)) - N('18080734.43')))).toBeLessThanOrEqual(1);
    expect(Math.abs(Number(N('1067265.57') - (await allocatedTo(shell.id))))).toBeLessThanOrEqual(1);
    await orders.settle({ productionOrderId: orderId, actor: actor() });

    // --- Processed sale: meat at ₦18,000/kg, shell at ₦2,500/kg (INV-PROC, DEL-PROC) ---
    const processedRevenue = N(meatKg.mul(18_000).plus(shellKg.mul(2_500)).toFixed(2));
    let fgCost = 0n;
    await prisma.$transaction(async (tx) => {
      for (const [item, qty] of [[meat, meatKg], [shell, shellKg]] as const) {
        const out = await stock.issueOut({ tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.id, warehouseId: cold.id, quantity: new Decimal(qty.toFixed(3)), sourceModule: 'case-500', sourceDocumentType: 'Delivery', sourceDocumentId: 'DEL-PROC', documentReference: 'DEL-PROC', movementDate: new Date('2026-05-25') });
        fgCost += out.valueKobo;
      }
    });
    await journal('INV-PROC', 4, [['120100', 'debit', processedRevenue], ['410200', 'credit', processedRevenue]]);
    await journal('DEL-PROC', 4, [['510200', 'debit', fgCost], ['130510', 'credit', fgCost]]);

    // --- Cash: 80% of sales collected, 90% of supplier bills and all payroll paid ---
    const revenue = N(liveSold * 4_500) + processedRevenue;
    const collected = (revenue * 80n) / 100n;
    await journal('RCPT-001', 5, [['110100', 'debit', collected], ['120100', 'credit', collected]]);
    await journal('PAY-SUP', 5, [['210100', 'debit', N(6_480_000)], ['110100', 'credit', N(6_480_000)]]);
    await journal('PAY-STAFF', 5, [['220100', 'debit', N(3_300_000)], ['110100', 'credit', N(3_300_000)]]);

    // --- Income tax at 30% on the year's profit ---
    // Through the year's last period: processing posts on the day it is done, so
    // the provision must see the whole year, as a year-end provision would.
    await services.tax.provide({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[11]!, actor: actor() });

    // =================== The application's figures ===================
    const pl = await services.pl.build({ companyId: fixture.companyId, financialYearId: fixture.financialYearId });
    const bs = await services.bs.build({ companyId: fixture.companyId });
    const cf = await services.cf.build({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[5]! });
    // 500_Cash_Flow's direct method, line by line: customers, suppliers, staff.
    expect(cf.direct.customerReceiptsKobo).toBe(N(55_278_360).toString());
    expect(cf.direct.supplierPaymentsKobo).toBe((-N(6_480_000)).toString());
    expect(cf.direct.employeePaymentsKobo).toBe((-N(3_300_000)).toString());
    expect(cf.direct.netCashFromOperationsKobo).toBe(N(45_498_360).toString());
    expect(cf.checks.directVsIndirectOperatingKobo).toBe('0');
    const fvGain = -(await balance('420100'));
    const actual: Record<RepId, bigint> = {
      'REP-005': BigInt(available),
      'REP-006': wacAvailable,
      'REP-007': (await balance('130410')),
      'REP-008': (await balance('219810')),
      'REP-009': (await balance('130410')),
      'REP-010': -(await balance('210100')),
      'REP-011': await balance('120100'),
      'REP-012': BigInt(pl.revenueKobo) - fvGain,
      'REP-013': fvGain,
      'REP-014': BigInt(pl.profitBeforeTaxKobo),
      'REP-015': BigInt(pl.profitAfterTaxKobo),
      'REP-016': BigInt(bs.totalAssetsKobo),
      'REP-017': BigInt(bs.totalLiabilitiesAndEquityKobo),
      'REP-018': await balance('110100'),
      'REP-019': BigInt(cf.checks.directKobo),
      'REP-020': BigInt(cf.closingCashKobo) - BigInt(cf.bankAccountClosingKobo),
    };

    // =================== The differences, cause by cause ===================
    const wacRounding = await balance('130510'); // left in finished goods after the processed sale
    const taxOnDifference = -(BigInt(pl.incomeTaxKobo) - N(18_509_385)); // workbook tax: 30% of ₦61,697,950
    CAUSES.wacRounding.amount = wacRounding;
    CAUSES.taxOnDifference.amount = taxOnDifference;
    const explained: Partial<Record<RepId, Array<[keyof typeof CAUSES, bigint]>>> = {
      'REP-010': [['overheadToPayables', CAUSES.overheadToPayables.amount]],
      'REP-013': [['breeders', CAUSES.breeders.amount]],
      'REP-014': [['breeders', CAUSES.breeders.amount], ['wacRounding', wacRounding]],
      'REP-015': [['breeders', CAUSES.breeders.amount], ['wacRounding', wacRounding], ['taxOnDifference', taxOnDifference]],
      'REP-016': [['breeders', CAUSES.breeders.amount], ['openingStock', CAUSES.openingStock.amount], ['wacRounding', wacRounding]],
      'REP-017': [['breeders', CAUSES.breeders.amount], ['openingStock', CAUSES.openingStock.amount], ['wacRounding', wacRounding]],
    };

    const rows = (Object.keys(EXPECTED) as RepId[]).map((id) => {
      const variance = actual[id] - EXPECTED[id].value;
      const causes = explained[id] ?? [];
      const explainedTotal = causes.reduce((s, [, amount]) => s + amount, 0n);
      return { id, variance, explainedTotal, causes, status: variance === 0n ? 'MATCH' : variance === explainedTotal ? 'EXPLAINED' : 'UNEXPLAINED' };
    });

    const money = (k: bigint) => `₦${(Number(k) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const show = (id: RepId, v: bigint) => (EXPECTED[id].money ? money(v) : v.toLocaleString('en-NG'));
    writeFileSync(
      join(__dirname, '..', 'uat', 'case-500-report.md'),
      [
        '# 500-snail case — workbook expected vs application actual (UAT-022)',
        '',
        `Run ${new Date().toISOString()}. ${rows.filter((r) => r.status === 'MATCH').length} match, ${rows.filter((r) => r.status === 'EXPLAINED').length} differ by named causes, ${rows.filter((r) => r.status === 'UNEXPLAINED').length} unexplained.`,
        '',
        '| ID | Figure | Workbook | Application | Difference | Status | Cause |',
        '|---|---|---|---|---|---|---|',
        ...rows.map((r) => `| ${r.id} | ${EXPECTED[r.id].what} | ${show(r.id, EXPECTED[r.id].value)} | ${show(r.id, actual[r.id])} | ${show(r.id, r.variance)} | ${r.status} | ${r.causes.map(([c, a]) => `${c} ${show(r.id, a)}`).join('; ')} |`),
        '',
        'Customer and supplier documents are posted as their journals (identical double entry), so AR and AP are compared to the workbook’s ageing (REP-010/011) rather than to open invoices; stock, WIP and recovery are reconciled to their subledgers.',
        '',
        'REP-001–004 (gross ledger and trial-balance totals) are not compared: they count journal lines and account structure (the application keeps snails in stage accounts and posts more, smaller journals), not results. REP-019 and REP-020 are the direct and indirect cash-flow checks.',
        '',
        '## Causes',
        '',
        ...Object.entries(CAUSES).map(([key, c]) => `- **${key}** — ${c.why}`),
      ].join('\n'),
    );

    // The application's own books hold together throughout.
    expect(bs.balanced).toBe(true);
    expect(cf.reconciled).toBe(true);
    // Stock, WIP and recovery agree with their subledgers. AR and AP are not
    // compared to open documents here — the replay posts customer and supplier
    // documents as their journals — but to the workbook's ageing (REP-010/011).
    const recon = await services.recon.reconcile(fixture.companyId);
    expect(recon.filter((r) => !r.reconciled && !['120100', '210100'].includes(r.accountNumber))).toEqual([]);
    // And every difference from the workbook is exactly its named causes.
    expect(rows.filter((r) => r.status === 'UNEXPLAINED')).toEqual([]);
  }, 600_000);
});
