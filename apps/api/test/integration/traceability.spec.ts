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
import { InventoryTransferService } from '../../src/inventory/inventory-transfer.service';
import { RecipeService } from '../../src/masters/recipe.service';
import { PartyService } from '../../src/masters/party.service';
import { CostAllocationService } from '../../src/production/cost-allocation.service';
import { ProductionOrderService } from '../../src/production/production-order.service';
import { JointCostService } from '../../src/production/joint-cost.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { TraceabilityService, type TraceNode } from '../../src/traceability/traceability.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Lot traceability (Acceptance_Criteria AC-011): "Sale lot traces to harvest,
 * cohort/flock, GRN/source and inputs — complete chain in one query/export."
 *
 * The chain built here: breeders bought from Agro Farms → breeding cycle →
 * market cohort, fed maize bought on a GRN → harvest → processing order,
 * packed with tubs bought on a GRN (lot PK-LOT-7) → snail meat into the cold
 * store → transferred to the shop → delivered to a customer.
 */

let prisma: PrismaService;
let stock: StockMovementService;
let orders: ProductionOrderService;
let transfers: InventoryTransferService;
let workflow: WorkflowService;
let trace: TraceabilityService;
let fixture: TestFixture;
let maker: { userId: string; roles: string[] };
const item: Record<string, string> = {};
const store: Record<string, string> = {};

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
  stock = new StockMovementService(prisma);
  orders = new ProductionOrderService(prisma, audit, posting, workflow, new RecipeService(prisma, audit), new PostingControlService(prisma), stock, new CostAllocationService());
  transfers = new InventoryTransferService(prisma, audit, posting, new PostingControlService(prisma), stock);
  trace = new TraceabilityService(prisma);
});

const flatten = (node: TraceNode): TraceNode[] => [node, ...node.children.flatMap(flatten)];
const titles = (node: TraceNode) => flatten(node).map((n) => `${n.kind}: ${n.title}`);

async function grn(number: string, supplierId: string, itemId: string, quantity: number, valueKobo: bigint, lot: string | null, on: string) {
  const po = await prisma.purchaseOrder.create({
    data: {
      companyId: fixture.companyId, orderNumber: `PO-${number}`, supplierId, orderDate: new Date(on), currencyId: fixture.currencyId, exchangeRate: 1,
      branchId: fixture.branchId, warehouseId: store.RAW!, createdById: fixture.makerId,
    },
  });
  const note = await prisma.goodsReceiptNote.create({
    data: {
      companyId: fixture.companyId, grnNumber: number, purchaseOrderId: po.id, supplierId, receiptDate: new Date(on), warehouseId: store.RAW!,
      branchId: fixture.branchId, financialYearId: fixture.financialYearId, financialPeriodId: fixture.periodIds[0]!, currencyId: fixture.currencyId, createdById: fixture.makerId,
    },
  });
  await prisma.$transaction((tx) =>
    stock.receiveIn({
      tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId, warehouseId: store.RAW!, quantity: new Decimal(quantity), valueKobo, batchReference: lot,
      sourceModule: 'procurement', sourceDocumentType: 'GoodsReceiptNote', sourceDocumentId: note.id, documentReference: number, movementDate: new Date(on),
    }),
  );
}

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  maker = { userId: fixture.makerId, roles: ['PRODUCTION_LEAD', 'FARM_MANAGER'] };
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
  for (const [code, name, type] of [['RAW', 'Raw store', 'RAW_MATERIAL'], ['COLD', 'Cold room', 'FINISHED_GOODS'], ['SHOP', 'Farm shop', 'FINISHED_GOODS']] as const) {
    store[code] = (await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code, name, type } })).id;
  }
  for (const [code, description, inventory] of [
    ['FEED', 'Snail grower mash', '130100'],
    ['PACK', 'Packaging tubs', '130100'],
    ['MEAT', 'Snail meat', '130510'],
    ['SHELL', 'Snail shell', '130510'],
  ] as const) {
    item[code] = (
      await prisma.item.create({
        data: {
          companyId: fixture.companyId, code, description, unitOfMeasureId: uom.id, inventoryGlAccountId: await acct(inventory), isManufactured: code === 'MEAT' || code === 'SHELL',
          ...(code === 'PACK' ? { defaultWarehouseId: store.RAW!, standardCosts: { create: [{ standardCostKobo: 500_00n, effectiveFrom: new Date('2026-01-01') }] } } : {}),
        },
      })
    ).id;
  }
  const parties = new PartyService(prisma, new AuditService(prisma));
  const feedCo = await parties.createSupplier({ companyId: fixture.companyId, code: 'SUP-FEED', name: 'FeedCo Nigeria', defaultCurrencyId: fixture.currencyId, actorId: fixture.makerId });
  const packCo = await parties.createSupplier({ companyId: fixture.companyId, code: 'SUP-PACK', name: 'PackRight Ltd', defaultCurrencyId: fixture.currencyId, actorId: fixture.makerId });
  await grn('GRN-FEED-1', feedCo.id, item.FEED!, 100, 30_000_00n, null, '2026-01-03');
  await grn('GRN-PACK-1', packCo.id, item.PACK!, 20, 10_000_00n, 'PK-LOT-7', '2026-01-04');

  // Breeders bought in, a breeding cycle, and the market cohort it hatched.
  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: 'S1', name: 'Snailery 1' } });
  const cohort = (code: string, purpose: string, extra: Record<string, unknown>) =>
    prisma.livestockGroup.create({
      data: {
        companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: pen.id, code, speciesKey: 'snail',
        breed: 'Archachatina marginata', purpose, stage: purpose === 'Breeders' ? 'Breeder' : 'Market', openingPopulation: 500, population: 500,
        startedOn: new Date('2025-06-01'), currentFvlctsPerUnitKobo: 3_000_00n, ...extra,
      },
    });
  const breeders = await cohort('BRD-1', 'Breeders', { source: 'Agro Farms Ltd, Ibadan', acquisitionCostKobo: 1_100_000_00n });
  const market = await cohort('MKT-1', 'Market', {});
  await prisma.snailBreedingCycle.create({
    data: {
      companyId: fixture.companyId, code: 'CYC-1', breederGroupId: breeders.id, setOn: new Date('2025-05-01'), breeders: 500, eggsLaid: 40_000,
      status: 'HATCHED', hatchedOn: new Date('2025-06-01'), hatchedCount: 30_000, hatchlingGroupId: market.id, recordedById: fixture.makerId,
    },
  });

  // 30 kg of the maize fed to the cohort.
  const daily = await prisma.dailyRecord.create({ data: { companyId: fixture.companyId, groupId: market.id, recordedOn: new Date('2026-01-06'), recordedById: fixture.makerId } });
  const feed = await prisma.feedIssue.create({ data: { dailyRecordId: daily.id, itemId: item.FEED!, feedName: 'Snail grower mash', quantityKg: 30 } });
  await prisma.$transaction((tx) =>
    stock.issueOut({
      tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.FEED!, warehouseId: store.RAW!, quantity: new Decimal(30),
      sourceModule: 'operations', sourceDocumentType: 'FEED_ISSUE', sourceDocumentId: feed.id, documentReference: 'FEED-1', movementDate: new Date('2026-01-06'),
    }),
  );

  // Harvest → processing order → meat and shell into the cold room.
  const recipe = await prisma.productRecipe.create({ data: { companyId: fixture.companyId, code: 'R-MEAT', name: 'Snail meat', outputItemId: item.MEAT! } });
  const version = await prisma.productRecipeVersion.create({
    data: {
      recipeId: recipe.id, version: 1, batchSize: '90', effectiveFrom: new Date('2026-01-01'),
      components: { create: [{ lineNumber: 1, componentItemId: item.PACK!, quantityPerBatch: '10', unitOfMeasureId: uom.id }] },
    },
  });
  await prisma.productRecipeVersion.update({ where: { id: version.id }, data: { status: 'ACTIVE' } });
  const joint = new JointCostService(prisma, new AuditService(prisma));
  for (const [code, price] of [['MEAT', 1_800_000n], ['SHELL', 250_000n]] as const) {
    const proposed = await joint.proposePrice({ companyId: fixture.companyId, itemId: item[code]!, sellingPricePerUnitKobo: price, furtherCostPerUnitKobo: 0n, effectiveFrom: new Date('2026-01-01'), evidenceReference: 'Price list', actor: maker });
    await joint.decide({ companyId: fixture.companyId, priceId: proposed.id, approve: true, actor: { userId: fixture.financeUserId, roles: ['FINANCE_CONTROLLER'] } });
  }
  const harvest = await prisma.harvestRecord.create({
    data: { companyId: fixture.companyId, groupId: market.id, harvestedOn: new Date('2026-01-10'), grade: 'A', weightKg: '90', count: 500, populationAtTime: 500, destination: 'PROCESSING', recordedById: fixture.makerId },
  });
  const { id: orderId } = await orders.createFromHarvest({ harvestRecordId: harvest.id, recipeVersionId: version.id, warehouseId: store.COLD!, plannedOutputQuantity: '90', actor: maker });
  const submitted = await orders.submit({ productionOrderId: orderId, actor: maker });
  await workflow.approve({ transactionId: submitted.transactionId, actor: { userId: fixture.checkerId, roles: ['FARM_MANAGER'] } });
  await orders.issueMaterials({ productionOrderId: orderId, actor: maker });
  await orders.confirmConversion({ productionOrderId: orderId, standardConversionCostKobo: 300_000_00n, actualLabourCostKobo: 110_000_00n, actualOverheadCostKobo: 216_000_00n, actor: maker });
  await orders.recordOutputs({
    productionOrderId: orderId, warehouseId: store.COLD!, actor: maker, normalLossQuantity: '38',
    outputs: [
      { itemId: item.MEAT!, outputType: 'MAIN', quantity: '36', weight: '36' },
      { itemId: item.SHELL!, outputType: 'BY_PRODUCT', quantity: '16', weight: '16' },
    ],
  });

  // 20 kg of meat to the farm shop, and 12 kg of it delivered to a customer.
  const sent = await transfers.issueTransfer({ companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.MEAT!, fromWarehouseId: store.COLD!, toWarehouseId: store.SHOP!, quantity: 20, actor: maker });
  await transfers.receiveTransfer({ transferId: sent.id, actor: maker });
  const customer = await parties.createCustomer({ companyId: fixture.companyId, code: 'CUS-SUN', name: 'Sunrise Foods', currencyId: fixture.currencyId, actorId: fixture.makerId });
  const order = await prisma.salesOrder.create({
    data: {
      companyId: fixture.companyId, orderNumber: 'SO-1', customerId: customer.id, orderDate: new Date(), currencyId: fixture.currencyId, exchangeRate: 1,
      branchId: fixture.branchId, warehouseId: store.SHOP!, createdById: fixture.makerId,
      lines: { create: [{ lineNumber: 1, itemId: item.MEAT!, description: 'Snail meat', quantity: 12, unitPriceKobo: 18_000_00n, netAmountKobo: 216_000_00n }] },
    },
    include: { lines: true },
  });
  const delivery = await prisma.deliveryNote.create({
    data: {
      companyId: fixture.companyId, deliveryNumber: 'DN-TRACE-1', salesOrderId: order.id, customerId: customer.id, deliveryDate: new Date(), warehouseId: store.SHOP!,
      branchId: fixture.branchId, financialYearId: fixture.financialYearId, financialPeriodId: fixture.periodIds[0]!, currencyId: fixture.currencyId, createdById: fixture.makerId,
      lines: { create: [{ lineNumber: 1, salesOrderLineId: order.lines[0]!.id, itemId: item.MEAT!, quantity: 12, unitCostKobo: 0n, costKobo: 0n }] },
    },
  });
  await prisma.$transaction((tx) =>
    stock.issueOut({
      tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.MEAT!, warehouseId: store.SHOP!, quantity: new Decimal(12),
      sourceModule: 'sales', sourceDocumentType: 'DeliveryNote', sourceDocumentId: delivery.id, documentReference: 'DN-TRACE-1', movementDate: new Date(),
    }),
  );
}, 60_000);

describe('Lot traceability (AC-011)', () => {
  it('traces a delivery back to the harvest, the cohort and its breeders, the feed and the packaging, and their receipts', async () => {
    const { resolvedAs, tree } = await trace.trace(fixture.companyId, 'DN-TRACE-1');
    expect(resolvedAs).toBe('Delivery note');
    const chain = titles(tree);
    const expectInOrder = (patterns: RegExp[]) => {
      let from = 0;
      for (const pattern of patterns) {
        const at = chain.findIndex((line, i) => i >= from && pattern.test(line));
        expect(at, `missing ${pattern} after step ${from}: ${chain.join(' | ')}`).toBeGreaterThanOrEqual(0);
        from = at + 1;
      }
    };
    expectInOrder([
      /^DELIVERY: Delivery DN-TRACE-1 to Sunrise Foods/,
      /^LINE: 12 KG MEAT — Snail meat/,
      /^TRANSFER: 12 KG MEAT transferred in on WTR-/,
      /^PRODUCTION: 12 KG MEAT made by processing order PRO-/,
      /^HARVEST: Harvest of 500 \(90 kg, grade A\)/,
      /^POPULATION: Cohort MKT-1/,
      /^BREEDING: Hatched 30000 of 40000 eggs in breeding cycle CYC-1/,
      /^POPULATION: Cohort BRD-1/,
      /^OTHER: Placed from Agro Farms Ltd, Ibadan/,
      /^FEED: Fed 30 KG FEED — Snail grower mash \(1 record\)/,
      /^RECEIPT: 30 KG FEED received on GRN-FEED-1 from FeedCo Nigeria/,
      /^LINE: 10 KG PACK — Packaging tubs/,
      /^RECEIPT: 10 KG PACK received on GRN-PACK-1 from PackRight Ltd/,
    ]);
    const packReceipt = flatten(tree).find((n) => n.kind === 'RECEIPT' && n.reference === 'GRN-PACK-1')!;
    expect(packReceipt.details).toMatchObject({ lot: 'PK-LOT-7', supplier: 'SUP-PACK — PackRight Ltd' });
    expect(flatten(tree).filter((n) => n.kind === 'GAP')).toEqual([]);

    // The same chain as a file, one row per step.
    const rows = TraceabilityService.toRows(tree);
    expect(rows.length).toBe(flatten(tree).length);
    expect(rows[0]).toMatchObject({ depth: 0, kind: 'DELIVERY', reference: 'DN-TRACE-1' });
  });

  it('traces from a lot, a production order or a population too', async () => {
    const lot = await trace.trace(fixture.companyId, 'PK-LOT-7');
    expect(lot.resolvedAs).toBe('Lot');
    expect(titles(lot.tree).some((t) => /GRN-PACK-1 from PackRight Ltd/.test(t))).toBe(true);
    const order = await prisma.productionOrder.findFirstOrThrow({ where: { companyId: fixture.companyId } });
    expect((await trace.trace(fixture.companyId, order.orderNumber)).resolvedAs).toBe('Production order');
    const cohort = await trace.trace(fixture.companyId, 'MKT-1');
    expect(titles(cohort.tree)[0]).toMatch(/^POPULATION: Cohort MKT-1/);
    await expect(trace.trace(fixture.companyId, 'NOPE-404')).rejects.toThrow(/Nothing called NOPE-404 to trace/);
  });

  it('matches an issue to receipts first in, first out — and a named lot first', async () => {
    const packCo = await prisma.supplier.findFirstOrThrow({ where: { companyId: fixture.companyId, code: 'SUP-PACK' } });
    // After the order's 10 kg (issued today), 10 kg of PK-LOT-7 remain; two more receipts,
    // then issues dated after today so they come after the order's.
    await grn('GRN-PACK-2', packCo.id, item.PACK!, 5, 2_500_00n, 'PK-LOT-8', '2026-02-01');
    await grn('GRN-PACK-3', packCo.id, item.PACK!, 5, 2_500_00n, 'PK-LOT-9', '2026-02-02');
    const issue = async (quantity: number, lot: string | null, ref: string) =>
      prisma.$transaction((tx) =>
        stock.issueOut({
          tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.PACK!, warehouseId: store.RAW!, quantity: new Decimal(quantity), batchReference: lot,
          sourceModule: 'test', sourceDocumentType: 'Test', sourceDocumentId: ref, documentReference: ref, movementDate: new Date('2026-12-01'),
        }),
      );
    await issue(5, 'PK-LOT-9', 'ISSUE-LOT9'); // takes the named lot, not the oldest
    await issue(12, null, 'ISSUE-FIFO'); // then the oldest: 10 of LOT-7, 2 of LOT-8
    const fifo = await prisma.stockMovement.findFirstOrThrow({ where: { companyId: fixture.companyId, sourceDocumentId: 'ISSUE-FIFO' } });
    const lotNine = await prisma.stockMovement.findFirstOrThrow({ where: { companyId: fixture.companyId, sourceDocumentId: 'ISSUE-LOT9' } });
    const receiptsOf = (node: TraceNode) => flatten(node).filter((n) => n.kind === 'RECEIPT').map((n) => `${n.quantity}@${n.reference}`);
    expect(receiptsOf(await trace.traceMovement(fixture.companyId, lotNine.id))).toEqual(['5@GRN-PACK-3']);
    expect(receiptsOf(await trace.traceMovement(fixture.companyId, fifo.id))).toEqual(['10@GRN-PACK-1', '2@GRN-PACK-2']);
  });
});
