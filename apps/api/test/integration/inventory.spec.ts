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
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ControlAccountReconciliationService } from '../../src/reporting/control-account-reconciliation.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Inventory control (UAT-006): receive, issue to another store, receive
 * there, count-adjust; the stock subledger posts to the ledger and agrees
 * with it; nothing can take stock below zero.
 */

let prisma: PrismaService;
let posting: PostingService;
let stock: StockMovementService;
let transfers: InventoryTransferService;
let reconciliation: ControlAccountReconciliationService;
let fixture: TestFixture;
let actor: { userId: string; roles: string[] };
let approver: { userId: string; roles: string[] };
let itemId: string;
const store: Record<string, string> = {};

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  stock = new StockMovementService(prisma);
  transfers = new InventoryTransferService(prisma, audit, posting, new PostingControlService(prisma), stock);
  reconciliation = new ControlAccountReconciliationService(prisma, new TrialBalanceService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  actor = { userId: fixture.makerId, roles: ['FARM_MANAGER'] };
  approver = { userId: fixture.financeUserId, roles: ['FINANCE_MANAGER'] };
  // The posting rules and six-digit accounts transfers and write-offs post through.
  await new PostingControlProvisioningService(prisma, new AuditService(prisma)).provision(fixture.companyId, null);
  const rawMaterials = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: '130100' } });
  const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'KG', name: 'Kilogram' } });
  itemId = (
    await prisma.item.create({
      data: { companyId: fixture.companyId, code: 'MAIZE', description: 'Maize', unitOfMeasureId: uom.id, inventoryGlAccountId: rawMaterials.id },
    })
  ).id;
  for (const [code, name] of [['MAIN', 'Main store'], ['MILL', 'Mill store']] as const) {
    store[code] = (await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code, name, type: 'RAW_MATERIAL' } })).id;
  }

  // 1,000 kg received at ₦200/kg into the main store, and posted.
  const d = dims(fixture, 0);
  const received = await posting.post({
    sourceModule: 'test', sourceDocumentType: 'Receipt', journalNumber: 'RCV-1', journalDate: new Date('2026-01-05'), narration: 'Maize received',
    ...d, idempotencyKey: 'rcv-1', actor,
    lines: [
      { glAccountId: rawMaterials.id, description: 'Maize', debit: kobo(200_000_00n), dimensions: d },
      { glAccountId: fixture.accounts['1101']!, description: 'Paid', credit: kobo(200_000_00n), dimensions: d },
    ],
  });
  await prisma.$transaction((tx) =>
    stock.receiveIn({
      tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId, warehouseId: store.MAIN!, quantity: new Decimal(1000), valueKobo: 200_000_00n,
      sourceModule: 'test', sourceDocumentType: 'Receipt', sourceDocumentId: received.journalEntryId, documentReference: 'RCV-1',
      movementDate: new Date('2026-01-05'), journalEntryId: received.journalEntryId,
    }),
  );
});

const onHand = async (warehouseId: string) => (await stock.storeQuantity(prisma, fixture.companyId, itemId, warehouseId)).toNumber();

describe('Inventory control (UAT-006)', () => {
  it('writes off only once someone other than the requester approves it (PCR-014)', async () => {
    const requested = await transfers.writeOff({
      companyId: fixture.companyId, branchId: fixture.branchId, itemId, warehouseId: store.MAIN!, quantity: 5, reason: 'Rat damage, bay 3', actor,
    });
    await expect(transfers.decideWriteOff({ companyId: fixture.companyId, writeOffId: requested.id, approve: true, actor })).rejects.toThrow(
      /You requested this write-off, so someone else approves it/,
    );
    await expect(transfers.decideWriteOff({ companyId: fixture.companyId, writeOffId: requested.id, approve: true, actor: { userId: fixture.checkerId, roles: ['STOREKEEPER'] } })).rejects.toThrow(
      /farm manager or finance approver/,
    );
    await expect(prisma.inventoryWriteOff.update({ where: { id: requested.id }, data: { status: 'POSTED', approvedById: fixture.makerId } })).rejects.toThrow(
      /whoever requested it cannot approve it/,
    );

    // Rejected: nothing moves, and it is closed.
    await expect(transfers.decideWriteOff({ companyId: fixture.companyId, writeOffId: requested.id, approve: false, actor: approver })).rejects.toThrow(/Say why/);
    await transfers.decideWriteOff({ companyId: fixture.companyId, writeOffId: requested.id, approve: false, reason: 'Damage not confirmed on inspection', actor: approver });
    expect(await onHand(store.MAIN!)).toBe(1000);
    await expect(transfers.decideWriteOff({ companyId: fixture.companyId, writeOffId: requested.id, approve: true, actor: approver })).rejects.toThrow(/already rejected/);

    // Approved: stock leaves at moving average and PCR-014 posts; the row is then fixed.
    const second = await transfers.writeOff({
      companyId: fixture.companyId, branchId: fixture.branchId, itemId, warehouseId: store.MAIN!, quantity: 5, reason: 'Rat damage, bay 4 (inspected)', actor,
    });
    const posted = await transfers.decideWriteOff({ companyId: fixture.companyId, writeOffId: second.id, approve: true, actor: approver });
    expect(posted.status).toBe('POSTED');
    expect(await onHand(store.MAIN!)).toBe(995);
    const row = await prisma.inventoryWriteOff.findUniqueOrThrow({ where: { id: second.id } });
    expect(row.valueKobo).toBe(5n * 200_00n);
    expect(row.journalEntryId).not.toBeNull();
    await expect(prisma.inventoryWriteOff.update({ where: { id: second.id }, data: { reason: 'edited' } })).rejects.toThrow(/is POSTED; it cannot change/);
  });


  it('issues to another store, receives it there, count-adjusts — and the stock ledger agrees with the GL throughout', async () => {
    const sent = await transfers.issueTransfer({
      companyId: fixture.companyId, branchId: fixture.branchId, itemId, fromWarehouseId: store.MAIN!, toWarehouseId: store.MILL!, quantity: 400, actor,
    });
    expect(sent.transferNumber).toMatch(/^WTR-/);
    expect(await onHand(store.MAIN!)).toBe(600);
    await transfers.receiveTransfer({ transferId: sent.id, actor });
    expect(await onHand(store.MILL!)).toBe(400);

    const requested = await transfers.writeOff({
      companyId: fixture.companyId, branchId: fixture.branchId, itemId, warehouseId: store.MILL!, quantity: 10, reason: 'Count: 390 kg found, 10 kg spoilt', actor,
    });
    expect(requested.status).toBe('PENDING');
    expect(await onHand(store.MILL!)).toBe(400); // nothing leaves until it is approved (PCR-014)
    await transfers.decideWriteOff({ companyId: fixture.companyId, writeOffId: requested.id, approve: true, actor: approver });
    expect(await onHand(store.MILL!)).toBe(390);

    const rows = await reconciliation.reconcile(fixture.companyId);
    const inventory = rows.find((r) => r.accountNumber === '130100')!;
    expect(inventory.reconciled).toBe(true);
    expect(inventory.glBalanceKobo).toBe(String(990n * 200_00n)); // 990 kg left at ₦200
  });

  it('refuses to take stock below zero, in total or in the store named, saying what is on hand', async () => {
    await expect(
      transfers.issueTransfer({
        companyId: fixture.companyId, branchId: fixture.branchId, itemId, fromWarehouseId: store.MAIN!, toWarehouseId: store.MILL!, quantity: 1500, actor,
      }),
    ).rejects.toThrow(/would take Main store negative — 1000\.000 on hand there, 1500 requested/);
    await expect(
      transfers.writeOff({ companyId: fixture.companyId, branchId: fixture.branchId, itemId, warehouseId: store.MILL!, quantity: 1, reason: 'Count', actor }),
    ).rejects.toThrow(/would take Mill store negative — 0.000 on hand there, 1 requested/);
    expect(await onHand(store.MAIN!)).toBe(1000);
  });
});
