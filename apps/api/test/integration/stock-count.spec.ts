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
import { StockCountService } from '../../src/inventory/stock-count.service';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Stock counts (SYSTEM_INTEGRITY_MATRIX INT-009): "approved count, reason
 * and variance evidence"; never a "silent overwrite of book quantity"; a
 * "count freeze, recount threshold and period check"; "counter ≠ approver";
 * posted "Dr/Cr Inventory Variance and Inventory" (PCR-014).
 */

let prisma: PrismaService;
let stock: StockMovementService;
let counts: StockCountService;
let fixture: TestFixture;
let counter: { userId: string; roles: string[] };
let approver: { userId: string; roles: string[] };
const item: Record<string, string> = {};
let store: string;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  stock = new StockMovementService(prisma);
  counts = new StockCountService(prisma, audit, posting, new PostingControlService(prisma), stock);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  counter = { userId: fixture.makerId, roles: ['STOREKEEPER'] };
  approver = { userId: fixture.financeUserId, roles: ['FINANCE_MANAGER'] };
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'SPEC' } });
  await new PostingControlProvisioningService(prisma, new AuditService(prisma)).provision(fixture.companyId, null);
  const inventory = (await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: '130100' } })).id;
  const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'KG', name: 'Kilogram' } });
  store = (await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'RM-1', name: 'Feed ingredients', type: 'RAW_MATERIAL' } })).id;
  for (const [code, description, qty, value] of [
    ['MAIZE', 'Maize', 100, 50_000_00n], // ₦500 a kg
    ['SOYA', 'Soybean meal', 40, 8_000_00n], // ₦200 a kg
  ] as const) {
    item[code] = (await prisma.item.create({ data: { companyId: fixture.companyId, code, description, unitOfMeasureId: uom.id, inventoryGlAccountId: inventory } })).id;
    await prisma.$transaction((tx) =>
      stock.receiveIn({
        tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: item[code]!, warehouseId: store, quantity: new Decimal(qty), valueKobo: value,
        sourceModule: 'test', sourceDocumentType: 'Opening', sourceDocumentId: code, documentReference: 'OPEN', movementDate: new Date('2026-01-02'),
      }),
    );
  }
});

const inStore = (code: string) => prisma.$transaction((tx) => stock.storeQuantity(tx, fixture.companyId, item[code]!, store));
const balanceOf = async (n: string) => {
  const account = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: n } });
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: account.id }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
};
const receiveMore = () =>
  prisma.$transaction((tx) =>
    stock.receiveIn({
      tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.MAIZE!, warehouseId: store, quantity: new Decimal(1), valueKobo: 500_00n,
      sourceModule: 'test', sourceDocumentType: 'Receipt', sourceDocumentId: `late-${Math.random()}`, documentReference: 'GRN-LATE', movementDate: new Date(),
    }),
  );

describe('Stock counts (INT-009)', () => {
  it('freezes the store, recounts beyond the threshold, needs reasons, and posts only when someone else approves', async () => {
    const count = await counts.start({ companyId: fixture.companyId, warehouseId: store, actor: counter });
    expect(count.reference).toMatch(/^STA-/);

    // The freeze: nothing moves in or out while the store is being counted.
    await expect(receiveMore()).rejects.toThrow(/being counted \(STA-/);
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO stock_movements (id, company_id, branch_id, item_id, warehouse_id, direction, quantity, unit_cost_kobo, value_kobo, source_module, source_document_type, source_document_id, document_reference, movement_date)
         SELECT gen_random_uuid(), company_id, branch_id, item_id, warehouse_id, 'IN', 1, 500, 500, 'raw', 'Raw', 'raw', 'RAW', now() FROM stock_movements LIMIT 1`,
      ),
    ).rejects.toThrow(/frozen for stock count/);
    await expect(counts.start({ companyId: fixture.companyId, warehouseId: store, actor: counter })).rejects.toThrow(/already being counted/);

    // Maize 97 of 100 (3%, inside 5%); soya 30 of 40 (25%, beyond it).
    await counts.record({ companyId: fixture.companyId, countId: count.id, counts: [{ itemId: item.MAIZE!, quantity: 97 }, { itemId: item.SOYA!, quantity: 30 }], actor: counter });
    const first = await counts.submit({ companyId: fixture.companyId, countId: count.id, actor: counter });
    expect(first.status).toBe('COUNTING');
    expect(first.recount).toEqual(['SOYA']);
    await expect(counts.submit({ companyId: fixture.companyId, countId: count.id, actor: counter })).rejects.toThrow(/not yet counted: SOYA/);

    // The recount finds 36; both differences then need a reason.
    await counts.record({ companyId: fixture.companyId, countId: count.id, counts: [{ itemId: item.SOYA!, quantity: 36 }], actor: counter });
    await expect(counts.submit({ companyId: fixture.companyId, countId: count.id, actor: counter })).rejects.toThrow(/reason for each difference: MAIZE, SOYA/);
    await counts.record({
      companyId: fixture.companyId, countId: count.id, actor: counter,
      counts: [{ itemId: item.MAIZE!, reason: 'Spillage at the mixer' }, { itemId: item.SOYA!, reason: 'Two bags damp and discarded, not recorded' }],
    });
    const submitted = await counts.submit({ companyId: fixture.companyId, countId: count.id, actor: counter });
    expect(submitted.status).toBe('SUBMITTED');

    const detail = await counts.detail(fixture.companyId, count.id);
    const soya = detail.lines.find((l) => l.item.startsWith('SOYA'))!;
    expect(soya.countedQuantity).toBe('30');
    expect(soya.recountQuantity).toBe('36');
    expect(soya.varianceQuantity).toBe('-4');
    expect(detail.netAdjustmentKobo).toBe((-(3n * 500_00n + 4n * 200_00n)).toString());

    // Counter ≠ approver.
    await expect(counts.decide({ companyId: fixture.companyId, countId: count.id, action: 'APPROVE', actor: { ...counter, roles: ['FARM_MANAGER'] } })).rejects.toThrow(
      /You counted this store, so someone else approves/,
    );
    await counts.decide({ companyId: fixture.companyId, countId: count.id, action: 'APPROVE', actor: approver });

    expect((await inStore('MAIZE')).toString()).toBe('97');
    expect((await inStore('SOYA')).toString()).toBe('36');
    expect(await balanceOf('640100')).toBe(2_300_00n); // ₦1,500 + ₦800 written off
    expect(await balanceOf('130100')).toBe(-2_300_00n);

    // The freeze lifts, and a posted count is closed for good.
    await receiveMore();
    await expect(prisma.stockCount.update({ where: { id: count.id }, data: { decisionNote: 'edited' } })).rejects.toThrow(/is POSTED; it cannot change/);
  });

  it('brings a surplus in at the frozen cost: Dr inventory, Cr 640100', async () => {
    const count = await counts.start({ companyId: fixture.companyId, warehouseId: store, itemIds: [item.MAIZE!], recountThresholdPercent: 10, actor: counter });
    await counts.record({ companyId: fixture.companyId, countId: count.id, counts: [{ itemId: item.MAIZE!, quantity: 104, reason: 'Delivery of 4 kg received without a GRN' }], actor: counter });
    expect((await counts.submit({ companyId: fixture.companyId, countId: count.id, actor: counter })).status).toBe('SUBMITTED');
    await counts.decide({ companyId: fixture.companyId, countId: count.id, action: 'APPROVE', actor: approver });
    expect((await inStore('MAIZE')).toString()).toBe('104');
    expect(await balanceOf('130100')).toBe(2_000_00n);
    expect(await balanceOf('640100')).toBe(-2_000_00n);
  });

  it('holds a count for investigation, and cancels one without moving stock', async () => {
    const count = await counts.start({ companyId: fixture.companyId, warehouseId: store, itemIds: [item.MAIZE!], actor: counter });
    await counts.record({ companyId: fixture.companyId, countId: count.id, counts: [{ itemId: item.MAIZE!, quantity: 99, reason: 'Unknown' }], actor: counter });
    await counts.submit({ companyId: fixture.companyId, countId: count.id, actor: counter });
    await expect(counts.decide({ companyId: fixture.companyId, countId: count.id, action: 'HOLD', actor: approver })).rejects.toThrow(/what is being investigated/);
    expect((await counts.decide({ companyId: fixture.companyId, countId: count.id, action: 'HOLD', note: 'CCTV review of the night shift', actor: approver })).status).toBe('ON_HOLD');
    await expect(receiveMore()).rejects.toThrow(/being counted/); // still frozen while held

    expect((await counts.decide({ companyId: fixture.companyId, countId: count.id, action: 'CANCEL', note: 'Bags found in the second bay; recount', actor: approver })).status).toBe(
      'CANCELLED',
    );
    expect((await inStore('MAIZE')).toString()).toBe('100');
    expect(await prisma.journalLine.count({ where: { journalEntry: { sourceDocumentType: 'StockCount' } } })).toBe(0);
    await receiveMore(); // released
  });
});
