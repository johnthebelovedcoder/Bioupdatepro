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
import { InventoryTransferService } from '../../src/inventory/inventory-transfer.service';
import { ControlAccountReconciliationService } from '../../src/reporting/control-account-reconciliation.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Inventory movements on the approved five-digit chart. A transfer passes
 * through goods in transit (12500) and relieves and restores the inventory
 * control the item is actually held in (feed ingredients 12100, packaging
 * 12200), not one raw-materials account; a write-off or a count shortage is
 * inventory write-down expense (51200); a count surplus is a gain (41000).
 */

let prisma: PrismaService;
let posting: PostingService;
let stock: StockMovementService;
let transfers: InventoryTransferService;
let counts: StockCountService;
let reconciliation: ControlAccountReconciliationService;
let fixture: TestFixture;
let actor: { userId: string; roles: string[] };
let approver: { userId: string; roles: string[] };
let counter: { userId: string; roles: string[] };
const item: Record<string, string> = {};
const store: Record<string, string> = {};

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  stock = new StockMovementService(prisma);
  const control = new PostingControlService(prisma);
  transfers = new InventoryTransferService(prisma, audit, posting, control, stock);
  counts = new StockCountService(prisma, audit, posting, control, stock);
  reconciliation = new ControlAccountReconciliationService(prisma, new TrialBalanceService(prisma));
});

const acct = async (n: string) => (await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: n } })).id;

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  actor = { userId: fixture.makerId, roles: ['FARM_MANAGER'] };
  counter = { userId: fixture.makerId, roles: ['STOREKEEPER'] };
  approver = { userId: fixture.financeUserId, roles: ['FINANCE_MANAGER'] };
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'APPROVED' } });
  await new PostingControlProvisioningService(prisma, new AuditService(prisma)).provision(fixture.companyId, null);

  const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'KG', name: 'Kilogram' } });
  for (const [code, name] of [['MAIN', 'Main store'], ['MILL', 'Mill store']] as const) {
    store[code] = (await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code, name, type: 'RAW_MATERIAL' } })).id;
  }
  // Maize is a feed ingredient (12100) and bags are packaging (12200): different controls.
  for (const [code, account, qty, value] of [
    ['MAIZE', '12100', 1000, 200_000_00n], // ₦200 a kg
    ['BAG', '12200', 100, 15_000_00n], // ₦150 each
  ] as const) {
    const inventory = await acct(account);
    item[code] = (await prisma.item.create({ data: { companyId: fixture.companyId, code, description: code, unitOfMeasureId: uom.id, inventoryGlAccountId: inventory } })).id;
    const d = dims(fixture, 0, { costCentreId: fixture.costCentreId });
    const received = await posting.post({
      sourceModule: 'test', sourceDocumentType: 'Receipt', journalNumber: `RCV-${code}`, journalDate: new Date('2026-01-05'), narration: `${code} received`,
      ...d, idempotencyKey: `rcv-${code}`, actor,
      lines: [
        { glAccountId: inventory, description: code, debit: kobo(value), dimensions: d },
        { glAccountId: await acct('10100'), description: 'Paid', credit: kobo(value), dimensions: d },
      ],
    });
    await prisma.$transaction((tx) =>
      stock.receiveIn({
        tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId: item[code]!, warehouseId: store.MAIN!, quantity: new Decimal(qty), valueKobo: value,
        sourceModule: 'test', sourceDocumentType: 'Receipt', sourceDocumentId: received.journalEntryId, documentReference: `RCV-${code}`,
        movementDate: new Date('2026-01-05'), journalEntryId: received.journalEntryId,
      }),
    );
  }
});

async function balance(accountNumber: string) {
  const sums = await prisma.journalLine.aggregate({
    where: { glAccountId: await acct(accountNumber), journalEntry: { status: 'POSTED' } },
    _sum: { debitKobo: true, creditKobo: true },
  });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
}

describe('inventory movements on the approved chart', () => {
  it('moves a transfer through goods in transit and back into the item’s own inventory control', async () => {
    const sent = await transfers.issueTransfer({
      companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.MAIZE!, fromWarehouseId: store.MAIN!, toWarehouseId: store.MILL!, quantity: 400, actor,
    });
    expect(await balance('12500')).toBe(80_000_00n); // 400 kg × ₦200 in transit
    expect(await balance('12100')).toBe(200_000_00n - 80_000_00n); // out of feed ingredients, not raw materials
    expect(await balance('12000')).toBe(0n);

    await transfers.receiveTransfer({ transferId: sent.id, actor });
    expect(await balance('12500')).toBe(0n); // in transit clears
    expect(await balance('12100')).toBe(200_000_00n); // and the control is whole again
    expect(await balance('12000')).toBe(0n);
  });

  it('writes off stock to inventory write-down expense out of the account the item is held in', async () => {
    const requested = await transfers.writeOff({
      companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.BAG!, warehouseId: store.MAIN!, quantity: 5, reason: 'Rat damage, bay 3', actor,
    });
    await transfers.decideWriteOff({ companyId: fixture.companyId, writeOffId: requested.id, approve: true, actor: approver });
    expect(await balance('51200')).toBe(5n * 150_00n);
    expect(await balance('12200')).toBe(15_000_00n - 5n * 150_00n); // packaging control, not raw materials
    expect(await balance('12000')).toBe(0n);
  });

  it('charges a count shortage to write-down expense and credits a surplus to the inventory gain', async () => {
    const count = await counts.start({ companyId: fixture.companyId, warehouseId: store.MAIN!, itemIds: [item.MAIZE!, item.BAG!], recountThresholdPercent: 10, actor: counter });
    await counts.record({
      companyId: fixture.companyId, countId: count.id, actor: counter,
      counts: [
        { itemId: item.MAIZE!, quantity: 997, reason: 'Spillage at the mixer' }, // 3 kg short at ₦200
        { itemId: item.BAG!, quantity: 104, reason: 'Four bags received without a GRN' }, // 4 over at ₦150
      ],
    });
    expect((await counts.submit({ companyId: fixture.companyId, countId: count.id, actor: counter })).status).toBe('SUBMITTED');
    await counts.decide({ companyId: fixture.companyId, countId: count.id, action: 'APPROVE', actor: approver });
    expect(await balance('51200')).toBe(3n * 200_00n); // the shortage
    expect(await balance('41000')).toBe(-(4n * 150_00n)); // the surplus, a gain
    expect(await balance('12100')).toBe(200_000_00n - 3n * 200_00n);
    expect(await balance('12200')).toBe(15_000_00n + 4n * 150_00n);
  });

  it('keeps each inventory control equal to the stock ledger throughout', async () => {
    const sent = await transfers.issueTransfer({
      companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.MAIZE!, fromWarehouseId: store.MAIN!, toWarehouseId: store.MILL!, quantity: 400, actor,
    });
    await transfers.receiveTransfer({ transferId: sent.id, actor });
    const requested = await transfers.writeOff({
      companyId: fixture.companyId, branchId: fixture.branchId, itemId: item.MAIZE!, warehouseId: store.MILL!, quantity: 10, reason: 'Spoilt', actor,
    });
    await transfers.decideWriteOff({ companyId: fixture.companyId, writeOffId: requested.id, approve: true, actor: approver });
    const rows = await reconciliation.reconcile(fixture.companyId);
    for (const account of ['12100', '12200']) {
      const row = rows.find((r) => r.accountNumber === account);
      expect(row, `${account} in ${JSON.stringify(rows)}`).toBeDefined();
      expect(row!.reconciled, account).toBe(true);
    }
  });
});
