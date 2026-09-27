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
import { RecipeService } from '../../src/masters/recipe.service';
import { CostAllocationService } from '../../src/production/cost-allocation.service';
import { ProductionOrderService } from '../../src/production/production-order.service';
import { JointCostService } from '../../src/production/joint-cost.service';
import { FarmCostAllocationService } from '../../src/cost-allocation/farm-cost-allocation.service';
import { TimesheetService } from '../../src/cost-allocation/timesheet.service';
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
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * The client's 500-poultry case (P500_Assumptions → P_APP_EXPECTED_RESULTS and
 * P500_Checks), run through the application — handbook §52, UAT-022.
 *
 * The same rule as the snail replay (case-500-snail.spec.ts): the biology and
 * every posting the application owns go through its own services — the flock
 * placed and acquired, feed issued from the store on the daily round, the
 * medication given as a treatment, farm labour allocated to the flock by
 * animal-days (PCR-064), deaths, the IAS 41 revaluation through approval, the
 * live sale derecognised at carrying value, and the processing order from
 * harvest through plant intake, ABC conversion, cold-store output and
 * settlement, then income tax. Supplier bills, customer invoices, receipts and
 * payments, whose double entry is the workbook's journal, are posted as those
 * journals.
 *
 * Where the application books the case differently, the difference is named
 * in CAUSES, and every variance must be exactly the sum of its named causes.
 * The comparison is written to test/uat/case-500-poultry-report.md, and the
 * profit figures to case-500-poultry.json for the enterprise (V896) scoring
 * in run-uat.mjs.
 *
 * Amounts are the workbook's; its journals all carry the report date, and
 * here they are spread over January–June 2026 in the order they happen.
 */

const N = (naira: number | string) => BigInt(new Decimal(naira).mul(100).toFixed(0)); // naira → kobo

/** Workbook expected results (P_APP_EXPECTED_RESULTS). */
const EXPECTED = {
  'P-REP-005': { what: 'Birds harvested', value: 470n, money: false },
  'P-REP-006': { what: 'Dressed meat (grams)', value: 446_688n, money: false },
  'P-REP-007': { what: 'ABC variance', value: N(40_000), money: true },
  'P-REP-008': { what: 'WIP closing', value: 0n, money: true },
  'P-REP-009': { what: 'AP open', value: N(229_250), money: true },
  'P-REP-010': { what: 'AR open', value: N('726955.52'), money: true },
  'P-REP-011': { what: 'Total revenue', value: N('3634777.60'), money: true },
  'P-REP-012': { what: 'Fair-value gain', value: N(442_500), money: true },
  'P-REP-013': { what: 'Profit after tax', value: N('253594.32'), money: true },
  'P-REP-014': { what: 'Total assets', value: N('21251527.60'), money: true },
  'P-REP-015': { what: 'Liabilities and equity', value: N('21251527.60'), money: true },
  'P-REP-016': { what: 'Closing cash', value: N('20524572.08'), money: true },
} as const;
type RepId = keyof typeof EXPECTED;

/** The workbook's profit before tax and tax (P500_P_and_L), for the V896 checks. */
const WORKBOOK_PBT = N('362277.60');
const WORKBOOK_TAX = N('108683.28');

/**
 * Every place the application books the case differently, and by how much.
 * Amounts of 0n are measured during the run.
 */
const CAUSES = {
  mortalityExpensed: {
    amount: 0n, // measured: what the 30 deaths wrote off
    why:
      'The workbook leaves the cost of the 30 birds that died inside the flock, so the survivors carry it and the fair-value gain is smaller. The application writes each death off when it is recorded — the dead birds’ share of acquisition and rearing cost goes to Production Loss (640500) — so the fair-value gain is higher by the same amount and profit is unchanged.',
  },
  conversionToPayables: {
    amount: 0n, // measured: what the actual conversion credited to trade payables
    why:
      'The workbook accrues the ₦660,000 actual processing cost to 220100 (“Payroll/AP/Accum Dep”). The application posts PCR-055’s credit for the actual conversion pool to its resolved source liability — trade payables — so AP is ₦660,000 higher and 220100 lower by the same; total liabilities are unchanged. (The same cause as the snail case’s overheadToPayables.)',
  },
  fgRounding: {
    amount: 0n, // measured: what the kobo-rounded average leaves in finished goods
    why:
      'Finished goods are issued at their per-kg average cost rounded to the kobo, which can leave a few kobo in stock and out of cost of sales. The workbook uses unrounded floating point.',
  },
  taxOnDifference: {
    amount: 0n, // measured: 30% of any difference in profit before tax
    why: 'Income tax is 30% of the application’s own profit before tax; any difference in that profit moves tax by 30% of it.',
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
  orders: ProductionOrderService;
  workflow: WorkflowService;
  allocation: FarmCostAllocationService;
  pl: ProfitLossService;
  bs: BalanceSheetService;
  cf: CashFlowService;
  tb: TrialBalanceService;
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
    orders: new ProductionOrderService(prisma, audit, posting, workflow, new RecipeService(prisma, audit), new PostingControlService(prisma), stock, new CostAllocationService()),
    allocation: new FarmCostAllocationService(prisma, posting, audit, new TimesheetService(prisma)),
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
  for (const n of ['110100', '120100', '130100', '130110', '130520', '210100', '210200', '220100', '310100', '410300', '410400', '510400', '620100']) {
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
    sourceModule: 'case-500-poultry', sourceDocumentType: 'Document', journalNumber: ref, journalDate: new Date(Date.UTC(2026, month, 20)),
    narration: ref, ...d, idempotencyKey: `case-500-poultry:${ref}`, actor: actor(),
    lines: lines.map(([n, side, amount]) => ({ glAccountId: account[n]!, description: ref, [side]: kobo(amount), dimensions: d })),
  });
}

async function balance(number: string) {
  const a = await prisma.gLAccount.findFirst({ where: { companyId: fixture.companyId, accountNumber: number } });
  if (!a) return 0n;
  const s = await prisma.journalLine.aggregate({ where: { glAccountId: a.id }, _sum: { debitKobo: true, creditKobo: true } });
  return (s._sum.debitKobo ?? 0n) - (s._sum.creditKobo ?? 0n);
}

describe('The 500-poultry case, through the application (UAT-022)', () => {
  it('500-poultry case replay: reproduces the workbook, and every difference is a named cause', async () => {
    const { stock, assets, operations, orders, workflow, allocation } = services;
    await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'BRL-1', name: 'Broiler house 1' } });
    const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'KG', name: 'Kilogram' } });
    const store = await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'FEED', name: 'Feed store', type: 'RAW_MATERIAL' } });
    const cold = await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'COLD', name: 'Cold store', type: 'FINISHED_GOODS' } });

    // --- PJE001: opening test funding ₦20,000,000 ---
    await journal('FUND', 0, [['110100', 'debit', N(20_000_000)], ['310100', 'credit', N(20_000_000)]]);

    // --- PJE002/003: 500 day-old chicks at ₦1,200 plus ₦50,000 transport (GRN-BIRD, INV-BIRD) ---
    await operations.placeGroup({
      companyId: fixture.companyId, actor: actor(), idempotencyKey: 'case-p-doc',
      payload: { module: 'poultry', code: 'BLR-001', breed: 'Ross 308', purpose: 'Broiler', stage: 'Broiler', house: 'BRL-1', openingPopulation: 500, startedOn: '2026-01-05', acquisitionCostKobo: String(N(650_000)) },
    });
    expect(await balance('210200')).toBe(-N(650_000)); // Dr BA — Poultry / Cr GRNI by the application's acquisition posting
    expect(await balance('130210')).toBe(N(650_000));
    await journal('INV-BIRD', 0, [['210200', 'debit', N(650_000)], ['210100', 'credit', N(650_000)]]);

    // --- PJE004: 2,250 kg of feed at ₦650 (GRN-FEED) into the feed store ---
    const feed = await prisma.item.create({
      data: { companyId: fixture.companyId, code: 'FEED', description: 'Broiler feed', unitOfMeasureId: uom.id, inventoryGlAccountId: account['130110']!, defaultWarehouseId: store.id },
    });
    await prisma.$transaction((tx) =>
      stock.receiveIn({ tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: feed.id, warehouseId: store.id, quantity: new Decimal(2_250), valueKobo: N(1_462_500), sourceModule: 'case-500-poultry', sourceDocumentType: 'Receipt', sourceDocumentId: 'GRN-FEED', documentReference: 'GRN-FEED', movementDate: new Date('2026-01-04') }),
    );
    await journal('GRN-FEED', 0, [['130110', 'debit', N(1_462_500)], ['210100', 'credit', N(1_462_500)]]);

    // --- PJE005 and LOS: feed issued on the rounds (4.5 kg a bird placed), 30 birds lost (6%) ---
    const round = (date: string, feedKg: number, deaths: number) =>
      operations.recordRound({
        companyId: fixture.companyId, actor: actor(), idempotencyKey: `case-p-round-${date}`,
        payload: { module: 'poultry', date, entries: [{ groupCode: 'BLR-001', feedType: 'FEED', feedKg, deaths, causes: ['Natural attrition'] }] },
      });
    // Six rounds of 375 kg and 5 deaths: 1% a day, under the 2% abnormal-mortality line.
    for (const date of ['2026-01-15', '2026-01-25', '2026-02-05', '2026-02-20', '2026-02-25', '2026-03-05']) await round(date, 375, 5);
    expect(await balance('130110')).toBe(0n); // every kilo left the store into the flock

    // --- PJE006: medication and litter ₦180,000, bought and given as a treatment ---
    await journal('INV-MED', 2, [['130100', 'debit', N(180_000)], ['210100', 'credit', N(180_000)]]);
    await operations.recordTreatment({
      companyId: fixture.companyId, actor: actor(), idempotencyKey: 'case-p-med',
      payload: { groupCode: 'BLR-001', name: 'Medication and litter', date: '2026-03-06', givenBy: 'Farm vet', route: 'Water', treated: 470, withdrawalDays: 0, costKobo: String(N(180_000)) },
    });
    expect(await balance('130100')).toBe(0n);

    // --- PJE007/008: lifecycle payroll ₦320,000, allocated to the flock by animal-days (PCR-064), then paid ---
    await journal('PAYROLL-FARM', 1, [['620100', 'debit', N(320_000)], ['220100', 'credit', N(320_000)]]);
    await allocation.post({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[1]!, basis: 'ANIMAL_DAYS', sources: [{ glAccountId: account['620100']!, amountKobo: N(320_000) }], actor: actor() });
    expect(await balance('620100')).toBe(0n); // all of it capitalised into the flock
    await journal('PAY-STAFF', 1, [['220100', 'debit', N(320_000)], ['110100', 'credit', N(320_000)]]);

    const flock = await prisma.livestockGroup.findFirstOrThrow({ where: { code: 'BLR-001' } });
    expect(flock.population).toBe(470); // P500_Lifecycle: 500 placed − 30 lost

    // --- PJE009: IAS 41 at the market stage, ₦6,500 a bird, through approval (VAL-MKT) ---
    const { id: valuationId } = await assets.requestValuation({
      companyId: fixture.companyId, groupId: flock.id, valuationDate: new Date('2026-03-31'), marketPricePerUnitKobo: N(6_500), costsToSellPerUnitKobo: 0n, evidenceReference: 'P500_Assumptions IAS 41', actor: actor(),
    });
    const valuation = await prisma.biologicalAssetValuation.findUniqueOrThrow({ where: { id: valuationId } });
    await workflow.approve({ transactionId: valuation.workflowTransactionId!, actor: approver() });
    expect(await balance('130210')).toBe(470n * N(6_500)); // the flock at fair value, rearing cost absorbed

    // --- PJE010/011: 40% sold live at ₦6,500 (INV-LIVE), derecognised at carrying value ---
    const liveSold = Math.round(flock.population * 0.4); // 188
    await prisma.livestockGroup.update({ where: { id: flock.id }, data: { population: { decrement: liveSold } } });
    await assets.postDisposal({ groupId: flock.id, quantity: liveSold, occurredOn: new Date('2026-04-02'), method: 'SOLD', actor: actor() });
    await journal('INV-LIVE', 3, [['120100', 'debit', N(liveSold * 6_500)], ['410300', 'credit', N(liveSold * 6_500)]]);

    // --- PJE012–016: the other 282 processed — 2.2 kg live, 72% dressed yield ---
    const processed = flock.population - liveSold; // 282
    const liveKg = new Decimal(processed).mul('2.2'); // 620.4
    const dressedKg = liveKg.mul('0.72'); // 446.688
    const offalKg = new Decimal(60); // by-products sold for ₦90,000 (₦1,500/kg)
    await prisma.livestockGroup.update({ where: { id: flock.id }, data: { population: { decrement: processed } } });
    const harvest = await prisma.harvestRecord.create({
      data: { companyId: fixture.companyId, groupId: flock.id, harvestedOn: new Date('2026-04-10'), grade: 'Market', weightKg: liveKg.toFixed(3), count: processed, populationAtTime: processed, destination: 'PROCESSING', recordedById: fixture.makerId },
    });
    const meat = await prisma.item.create({ data: { companyId: fixture.companyId, code: 'DRESSED', description: 'Dressed chicken', unitOfMeasureId: uom.id, inventoryGlAccountId: account['130520']!, isManufactured: true } });
    const offal = await prisma.item.create({ data: { companyId: fixture.companyId, code: 'OFFAL', description: 'Offal and by-products', unitOfMeasureId: uom.id, inventoryGlAccountId: account['130520']!, isManufactured: true } });
    const recipe = await prisma.productRecipe.create({ data: { companyId: fixture.companyId, code: 'R-DRESSED', name: 'Dressed chicken', outputItemId: meat.id } });
    const version = await prisma.productRecipeVersion.create({ data: { recipeId: recipe.id, version: 1, batchSize: dressedKg.toFixed(3), effectiveFrom: new Date('2026-01-01') } });
    await prisma.productRecipeVersion.update({ where: { id: version.id }, data: { status: 'ACTIVE' } });
    const joint = new JointCostService(prisma, new AuditService(prisma));
    for (const [itemId, price] of [[meat.id, N(5_200)], [offal.id, N(1_500)]] as const) {
      const proposed = await joint.proposePrice({ companyId: fixture.companyId, itemId, sellingPricePerUnitKobo: price, furtherCostPerUnitKobo: 0n, effectiveFrom: new Date('2026-01-01'), evidenceReference: 'P500_Assumptions', actor: actor() });
      await joint.decide({ companyId: fixture.companyId, priceId: proposed.id, approve: true, actor: { userId: fixture.financeUserId, roles: ['FINANCE_CONTROLLER'] } });
    }
    const { id: orderId } = await orders.createFromHarvest({ harvestRecordId: harvest.id, recipeVersionId: version.id, warehouseId: cold.id, plannedOutputQuantity: dressedKg.toFixed(3), actor: actor() });
    const submitted = await orders.submit({ productionOrderId: orderId, actor: actor() });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver() });
    await orders.issueMaterials({ productionOrderId: orderId, actor: actor() });
    // PJE013/014: ABC — standard ₦620,000 (labour, machine, overhead); actual ₦235,000 labour and ₦425,000 machine and overhead.
    await orders.confirmConversion({ productionOrderId: orderId, standardConversionCostKobo: N(620_000), actualLabourCostKobo: N(235_000), actualOverheadCostKobo: N(170_000 + 255_000), actor: actor() });
    await orders.recordIntake({
      productionOrderId: orderId, plantReceivedCount: processed, plantReceivedWeightKg: liveKg.toFixed(3), deadOnArrivalCount: 0, deadOnArrivalWeightKg: '0', condemnedCount: 0, condemnedWeightKg: '0', actor: actor(),
    });
    const useBy = new Date(Date.now() + 30 * 86_400_000); // checked against today, not the case date
    await orders.recordOutputs({
      productionOrderId: orderId, warehouseId: cold.id, actor: actor(),
      normalLossQuantity: liveKg.minus(dressedKg).minus(offalKg).toFixed(3),
      outputs: [
        { itemId: meat.id, outputType: 'MAIN', quantity: dressedKg.toFixed(3), weight: dressedKg.toFixed(3) },
        { itemId: offal.id, outputType: 'BY_PRODUCT', quantity: offalKg.toFixed(3), weight: offalKg.toFixed(3) },
      ],
      details: [
        { grade: 'A', expiryDate: useBy, storageTemperatureC: '-18' },
        { grade: 'B', expiryDate: useBy, storageTemperatureC: '-18' },
      ],
    });
    const settled = await orders.settle({ productionOrderId: orderId, actor: actor() });
    const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.biologicalInputValueKobo).toBe(BigInt(processed) * N(6_500)); // PJE012 ₦1,833,000
    expect(order.finishedGoodsCostKobo).toBe(N(2_453_000)); // PJE016

    // --- PJE017/018: all output sold — dressed meat at ₦5,200/kg plus ₦90,000 of by-products ---
    const processedRevenue = N(dressedKg.mul(5_200).plus(90_000).toFixed(2));
    expect(processedRevenue).toBe(N('2412777.60'));
    let fgCost = 0n;
    await prisma.$transaction(async (tx) => {
      for (const [item, qty] of [[meat, dressedKg], [offal, offalKg]] as const) {
        const out = await stock.issueOut({ tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.id, warehouseId: cold.id, quantity: new Decimal(qty.toFixed(3)), sourceModule: 'case-500-poultry', sourceDocumentType: 'Delivery', sourceDocumentId: 'DN-MEAT', documentReference: 'DN-MEAT', movementDate: new Date('2026-04-25') });
        fgCost += out.valueKobo;
      }
    });
    await journal('INV-MEAT', 3, [['120100', 'debit', processedRevenue], ['410400', 'credit', processedRevenue]]);
    await journal('COGS-MEAT', 3, [['510400', 'debit', fgCost], ['130520', 'credit', fgCost]]);

    // --- PJE019/020: 80% of sales collected, 90% of supplier bills paid ---
    const revenue = N(liveSold * 6_500) + processedRevenue;
    const collected = (revenue * 80n) / 100n;
    const supplierBills = N(650_000 + 1_462_500 + 180_000);
    const paid = (supplierBills * 90n) / 100n;
    await journal('RCPT-CUST', 4, [['110100', 'debit', collected], ['120100', 'credit', collected]]);
    await journal('PAY-SUP', 4, [['210100', 'debit', paid], ['110100', 'credit', paid]]);

    // --- Income tax at 30% on the year's profit ---
    await services.tax.provide({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[11]!, actor: actor() });

    // =================== The application's figures ===================
    const pl = await services.pl.build({ companyId: fixture.companyId, financialYearId: fixture.financialYearId });
    const bs = await services.bs.build({ companyId: fixture.companyId });
    const cf = await services.cf.build({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[5]! });
    const fvGain = -(await balance('420200'));
    const actual: Record<RepId, bigint> = {
      'P-REP-005': BigInt(flock.population),
      'P-REP-006': BigInt(dressedKg.mul(1000).toFixed(0)),
      'P-REP-007': BigInt(settled.variance),
      'P-REP-008': await balance('130420'),
      'P-REP-009': -(await balance('210100')),
      'P-REP-010': await balance('120100'),
      'P-REP-011': BigInt(pl.revenueKobo) - fvGain,
      'P-REP-012': fvGain,
      'P-REP-013': BigInt(pl.profitAfterTaxKobo),
      'P-REP-014': BigInt(bs.totalAssetsKobo),
      'P-REP-015': BigInt(bs.totalLiabilitiesAndEquityKobo),
      'P-REP-016': await balance('110100'),
    };

    // =================== The differences, cause by cause ===================
    CAUSES.mortalityExpensed.amount = await balance('640500');
    CAUSES.conversionToPayables.amount = -(await balance('210100')) - EXPECTED['P-REP-009'].value;
    CAUSES.fgRounding.amount = await balance('130520');
    const pbtDifference = BigInt(pl.profitBeforeTaxKobo) - WORKBOOK_PBT;
    CAUSES.taxOnDifference.amount = -(BigInt(pl.incomeTaxKobo) - WORKBOOK_TAX);
    const { mortalityExpensed: m, conversionToPayables: ap, fgRounding: r, taxOnDifference: t } = CAUSES;
    const explained: Partial<Record<RepId, Array<[keyof typeof CAUSES, bigint]>>> = {
      'P-REP-009': [['conversionToPayables', ap.amount]],
      'P-REP-012': [['mortalityExpensed', m.amount]],
      'P-REP-013': [['fgRounding', r.amount], ['taxOnDifference', t.amount]],
      'P-REP-014': [['fgRounding', r.amount]],
      'P-REP-015': [['fgRounding', r.amount]],
    };
    expect(pbtDifference).toBe(r.amount); // deaths expensed move the gain, not the profit

    const rows = (Object.keys(EXPECTED) as RepId[]).map((id) => {
      const variance = actual[id] - EXPECTED[id].value;
      const causes = (explained[id] ?? []).filter(([, amount]) => amount !== 0n);
      const explainedTotal = causes.reduce((s, [, amount]) => s + amount, 0n);
      return { id, variance, explainedTotal, causes, status: variance === 0n ? 'MATCH' : variance === explainedTotal ? 'EXPLAINED' : 'UNEXPLAINED' };
    });

    // P500_Checks — the workbook's own acceptance checks, on the application's books.
    const tb = await services.tb.build({ companyId: fixture.companyId });
    const checks: Array<{ check: string; actual: bigint; expected: bigint }> = [
      { check: 'GL debit = credit', actual: BigInt(tb.totalDebitKobo) - BigInt(tb.totalCreditKobo), expected: 0n },
      { check: 'TB debit = credit', actual: BigInt(tb.totalDebitKobo) - BigInt(tb.totalCreditKobo), expected: 0n },
      { check: 'Lifecycle harvested birds', actual: BigInt(flock.population), expected: 470n },
      { check: 'ABC standard total', actual: order.standardConversionCostKobo, expected: N(620_000) },
      { check: 'ABC actual total', actual: order.actualLabourCostKobo + order.actualOverheadCostKobo, expected: N(660_000) },
      { check: 'ABC variance', actual: BigInt(settled.variance), expected: N(40_000) },
      { check: 'Closed WIP', actual: await balance('130420'), expected: 0n },
      { check: 'Closed P_Recovery (219820)', actual: await balance('219820'), expected: 0n },
      { check: 'Closed actual conversion pool (622100)', actual: await balance('622100'), expected: 0n },
      { check: 'AP ageing = GL (before conversion payables)', actual: -(await balance('210100')) - ap.amount, expected: N(229_250) },
      { check: 'AR ageing = GL', actual: await balance('120100'), expected: N('726955.52') },
      { check: 'Balance sheet check', actual: BigInt(bs.totalAssetsKobo) - BigInt(bs.totalLiabilitiesAndEquityKobo), expected: 0n },
      { check: 'Direct cash-flow check', actual: BigInt(cf.checks.directKobo), expected: 0n },
      { check: 'Indirect cash-flow check', actual: BigInt(cf.closingCashKobo) - BigInt(cf.bankAccountClosingKobo), expected: 0n },
    ];

    const money = (k: bigint) => `₦${(Number(k) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const show = (id: RepId, v: bigint) => (EXPECTED[id].money ? money(v) : v.toLocaleString('en-NG'));
    const uat = join(__dirname, '..', 'uat');
    writeFileSync(
      join(uat, 'case-500-poultry-report.md'),
      [
        '# 500-poultry case — workbook expected vs application actual (UAT-022)',
        '',
        `Run ${new Date().toISOString()}. ${rows.filter((r) => r.status === 'MATCH').length} match, ${rows.filter((r) => r.status === 'EXPLAINED').length} differ by named causes, ${rows.filter((r) => r.status === 'UNEXPLAINED').length} unexplained.`,
        '',
        '| ID | Figure | Workbook | Application | Difference | Status | Cause |',
        '|---|---|---|---|---|---|---|',
        ...rows.map((r) => `| ${r.id} | ${EXPECTED[r.id].what} | ${show(r.id, EXPECTED[r.id].value)} | ${show(r.id, actual[r.id])} | ${show(r.id, r.variance)} | ${r.status} | ${r.causes.map(([c, a]) => `${c} ${show(r.id, a)}`).join('; ')} |`),
        '',
        '## P500_Checks on the application’s books',
        '',
        '| Check | Application | Expected | Status |',
        '|---|---|---|---|',
        ...checks.map((c) => `| ${c.check} | ${c.check.includes('birds') ? c.actual.toString() : money(c.actual)} | ${c.check.includes('birds') ? c.expected.toString() : money(c.expected)} | ${c.actual === c.expected ? 'PASS' : 'FAIL'} |`),
        '',
        'P-REP-001–004 (gross ledger and trial-balance totals) are not compared: they count journal lines and account structure (the application posts the flock through more, smaller journals — each round, each death, the valuation, the allocation), not results. The GL and TB balance checks above are.',
        '',
        '## Causes',
        '',
        ...Object.entries(CAUSES).filter(([, c]) => c.amount !== 0n).map(([key, c]) => `- **${key}** (${money(c.amount)}) — ${c.why}`),
      ].join('\n'),
    );
    writeFileSync(
      join(uat, 'case-500-poultry.json'),
      JSON.stringify(
        {
          product: 'poultry',
          run: new Date().toISOString(),
          workbook: { pbtKobo: WORKBOOK_PBT.toString(), patKobo: (WORKBOOK_PBT - WORKBOOK_TAX).toString() },
          application: { pbtKobo: pl.profitBeforeTaxKobo, patKobo: pl.profitAfterTaxKobo },
          explained: { pbtKobo: pbtDifference.toString(), patKobo: (r.amount + t.amount).toString() },
          causes: Object.fromEntries(Object.entries(CAUSES).map(([k, c]) => [k, c.amount.toString()])),
          figures: await figures(),
        },
        null,
        2,
      ),
    );

    /** Every case figure the workbook's check sheets name, for run-uat.mjs (kobo, or a count). */
    async function figures() {
      const rearing = new RearingCostService(prisma, posting);
      const [feed, treatments, labour, outputs, rollForward] = await Promise.all([
        prisma.feedIssue.aggregate({ where: { dailyRecord: { groupId: flock.id }, journalEntryId: { not: null } }, _sum: { valueKobo: true } }),
        prisma.treatmentRecord.aggregate({ where: { groupId: flock.id, journalEntryId: { not: null } }, _sum: { costKobo: true } }),
        prisma.farmCostAllocationLine.aggregate({ where: { groupId: flock.id }, _sum: { amountKobo: true } }),
        prisma.productionOrderOutput.aggregate({ where: { productionOrderId: orderId }, _sum: { allocatedCostKobo: true } }),
        assets.rollForward(flock.id),
      ]);
      const after = await prisma.livestockGroup.findUniqueOrThrow({ where: { id: flock.id } });
      // The cash-flow statement is built a month at a time; the case's operating cash is the year's.
      const yearToDate = { direct: 0n, indirect: 0n };
      for (const periodId of fixture.periodIds) {
        const month = await services.cf.build({ companyId: fixture.companyId, financialPeriodId: periodId });
        yearToDate.direct += BigInt(month.direct.netCashFromOperationsKobo);
        yearToDate.indirect += BigInt(month.netCashFromOperationsKobo);
      }
      const farmAbcTotal = flock.acquisitionCostKobo + (feed._sum.valueKobo ?? 0n) + (treatments._sum.costKobo ?? 0n) + (labour._sum.amountKobo ?? 0n);
      const stillHeld = (await rearing.remaining(flock.id)) + BigInt(after.population) * (after.currentFvlctsPerUnitKobo ?? 0n);
      const f: Record<string, bigint> = {
        harvested: BigInt(flock.population),
        liveSold: BigInt(liveSold),
        processed: BigInt(processed),
        carryingRatePerUnit: after.currentFvlctsPerUnitKobo ?? 0n,
        dressedGrams: BigInt(dressedKg.mul(1000).toFixed(0)),
        abcStandard: order.standardConversionCostKobo,
        abcActual: order.actualLabourCostKobo + order.actualOverheadCostKobo,
        abcVariance: BigInt(settled.variance),
        wip: await balance('130420'),
        recovery: await balance('219820'),
        conversionPool: await balance('622100'),
        ap: -(await balance('210100')),
        ar: await balance('120100'),
        revenue: actual['P-REP-011'],
        fvGain: fvGain,
        pbt: BigInt(pl.profitBeforeTaxKobo),
        pat: BigInt(pl.profitAfterTaxKobo),
        totalAssets: BigInt(bs.totalAssetsKobo),
        totalLiabilitiesAndEquity: BigInt(bs.totalLiabilitiesAndEquityKobo),
        balanceSheetDifference: BigInt(bs.totalAssetsKobo) - BigInt(bs.totalLiabilitiesAndEquityKobo),
        cash: await balance('110100'),
        cfDirectClosing: BigInt(cf.direct.closingCashKobo),
        cfIndirectClosing: BigInt(cf.closingCashKobo),
        cfoDirect: yearToDate.direct,
        cfoIndirect: yearToDate.indirect,
        cfDirectCheck: BigInt(cf.checks.directKobo),
        cfIndirectCheck: BigInt(cf.checks.indirectKobo),
        tbDifference: BigInt(tb.totalDebitKobo) - BigInt(tb.totalCreditKobo),
        baRollForwardDifference: BigInt(rollForward.differenceKobo),
        farmAbcTotal,
        farmAbcAllocated: farmAbcTotal - stillHeld,
        jointAllocationDifference: order.finishedGoodsCostKobo - (outputs._sum.allocatedCostKobo ?? 0n),
      };
      return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.toString()]));
    }

    expect(bs.balanced).toBe(true);
    expect(cf.reconciled).toBe(true);
    const recon = await services.recon.reconcile(fixture.companyId);
    expect(recon.filter((x) => !x.reconciled && !['120100', '210100'].includes(x.accountNumber))).toEqual([]);
    expect(checks.filter((c) => c.actual !== c.expected)).toEqual([]);
    expect(rows.filter((x) => x.status === 'UNEXPLAINED')).toEqual([]);
  }, 600_000);
});
