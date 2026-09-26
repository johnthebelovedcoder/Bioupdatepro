import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { StockMovementService } from '../../src/inventory/stock-movement.service';
import { LotService } from '../../src/inventory/lot.service';
import { registerLot, lotBalances } from '../../src/inventory/lots';
import { assertNoWithdrawal, runningWithdrawal } from '../../src/operations/withdrawal';
import { PoultryEggService } from '../../src/poultry-egg/poultry-egg.service';
import { IncubationLogService, assertIncubatorRoom, assertReadyToHatch } from '../../src/poultry-egg/incubation-log.service';
import { TimesheetService } from '../../src/cost-allocation/timesheet.service';
import { LabourReconciliationService } from '../../src/cost-allocation/labour-reconciliation.service';
import { gate } from '../../src/notifications/notification-rules';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * The controls built on 26 September: lots, expiry and quarantine (FR-FM-02);
 * treatment withdrawal (§29, §59.5); the incubation log and incubator
 * capacity (FR-LIFE-04, INT-025); shifts and closed orders on timesheets
 * (INT-013); hours against payroll (AC-HR-002); and the WhatsApp consent
 * gate (AC-015).
 */

let prisma: PrismaService;
let audit: AuditService;
let stock: StockMovementService;
let lots: LotService;
let eggs: PoultryEggService;
let log: IncubationLogService;
let timesheets: TimesheetService;
let fixture: TestFixture;
let store: string;
let itemId: string;
const maker = () => ({ userId: fixture.makerId, roles: ['STOREKEEPER', 'FARM_MANAGER', 'FARM_ATTENDANT'] });
const checker = () => ({ userId: fixture.checkerId, roles: ['QA_OFFICER', 'FARM_MANAGER', 'POULTRY_SUPERVISOR'] });

beforeAll(() => {
  prisma = new PrismaService();
  audit = new AuditService(prisma);
  stock = new StockMovementService(prisma);
  lots = new LotService(prisma, audit);
  eggs = new PoultryEggService(prisma, new IdempotencyService(prisma));
  log = new IncubationLogService(prisma, audit);
  timesheets = new TimesheetService(prisma);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'KG', name: 'Kilogram' } });
  store = (await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'ST-1', name: 'Main store' } })).id;
  itemId = (await prisma.item.create({ data: { companyId: fixture.companyId, code: 'VAC', description: 'Vaccine', unitOfMeasureId: uom.id } })).id;
});

const receive = (lot: string | null, qty: number, on: string, sourceId = `src-${lot}`) =>
  prisma.$transaction((tx) =>
    stock.receiveIn({
      tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId, warehouseId: store, quantity: new Decimal(qty), valueKobo: BigInt(qty) * 100_00n,
      batchReference: lot, sourceModule: 'test', sourceDocumentType: 'Receipt', sourceDocumentId: sourceId, documentReference: `R-${lot}`, movementDate: new Date(on),
    }),
  );
const issue = (qty: number, sourceDocumentType = 'FeedIssue', batchReference: string | null = null) =>
  prisma.$transaction((tx) =>
    stock.issueOut({
      tx, companyId: fixture.companyId, branchId: fixture.branchId, itemId, warehouseId: store, quantity: new Decimal(qty), batchReference,
      sourceModule: 'test', sourceDocumentType, sourceDocumentId: `iss-${Math.random()}`, documentReference: 'ISSUE', movementDate: new Date(), perStore: true,
    }),
  );
const lot = (ref: string, expiry: string | null, quarantine = false) =>
  registerLot(prisma, {
    companyId: fixture.companyId, itemId, lotReference: ref, expiryDate: expiry ? new Date(expiry) : null, receivedOn: new Date('2026-01-01'),
    quarantine, sourceType: 'Receipt', sourceId: `src-${ref}`, receivedById: fixture.makerId,
  });

describe('Lots, expiry and quarantine (FR-FM-02)', () => {
  it('issues the earliest-expiring usable lot first and refuses stock that has expired', async () => {
    const future = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const sooner = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await lot('OLD', '2026-01-15');
    await lot('LATE', future);
    await lot('SOON', sooner);
    await receive('OLD', 5, '2026-01-02');
    await receive('LATE', 10, '2026-01-03');
    await receive('SOON', 10, '2026-01-04');

    // 25 on hand, but 5 of it expired: 20 can be used.
    await expect(issue(21)).rejects.toThrow(/only 20\.000 is fit to use.*lot OLD \(expired 2026-01-15\)/);
    await expect(issue(1, 'FeedIssue', 'OLD')).rejects.toThrow(/lot OLD of VAC is expired/);

    // Twelve go out: all ten of SOON (earliest usable expiry), then two of LATE.
    await issue(12);
    const balances = (await lotBalances(prisma, fixture.companyId, itemId, store))!;
    const held = Object.fromEntries(balances.map((b) => [b.lotReference, b.quantity.toString()]));
    expect(held).toEqual({ OLD: '5', LATE: '8' });

    // The expired lot can still be written off by name.
    await issue(5, 'InventoryWriteOff', 'OLD');
    const after = (await lotBalances(prisma, fixture.companyId, itemId, store))!;
    expect(after.map((b) => b.lotReference)).toEqual(['LATE']);
  });

  it('holds a quarantined lot until someone other than the receiver releases it', async () => {
    await lot('Q1', null, true);
    await receive('Q1', 10, '2026-01-02');
    await expect(issue(1)).rejects.toThrow(/lot Q1 \(in quarantine\)/);

    const [row] = await lots.report(fixture.companyId);
    expect(row!.status).toBe('QUARANTINE');
    await expect(lots.decide({ companyId: fixture.companyId, lotId: row!.lotId!, decision: 'RELEASE', actor: { userId: fixture.makerId, roles: ['QA_OFFICER'] } })).rejects.toThrow(
      /You received this lot, so someone else releases/,
    );
    await expect(lots.decide({ companyId: fixture.companyId, lotId: row!.lotId!, decision: 'REJECT', actor: checker() })).rejects.toThrow(/Say why/);
    await lots.decide({ companyId: fixture.companyId, lotId: row!.lotId!, decision: 'RELEASE', note: 'Cold chain verified', actor: checker() });
    await issue(4);
    const balances = (await lotBalances(prisma, fixture.companyId, itemId, store))!;
    expect(balances[0]!.quantity.toString()).toBe('6');
  });

  it('leaves items with no lots exactly as before', async () => {
    await receive(null, 3, '2026-01-02', 'plain');
    expect(await lotBalances(prisma, fixture.companyId, itemId)).toBeNull();
    await issue(3);
  });
});

async function poultryGroup(code = 'LAY-1') {
  const pen = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: `P-${code}`, name: `House ${code}` } });
  return prisma.livestockGroup.create({
    data: {
      companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: pen.id, code, speciesKey: 'poultry',
      breed: 'Isa Brown', purpose: 'Layer', stage: 'Laying', openingPopulation: 100, population: 100, startedOn: new Date('2025-06-01'),
    },
  });
}

describe('Treatment withdrawal (§29, §59.5)', () => {
  it('stops birds and table eggs leaving for food until the withdrawal has run', async () => {
    const group = await poultryGroup();
    await prisma.treatmentRecord.create({
      data: {
        companyId: fixture.companyId, groupId: group.id, name: 'Enrofloxacin', givenOn: new Date('2026-03-01'), route: 'Water', givenBy: 'Vet',
        treatedCount: 100, populationAtTime: 100, withdrawalDays: 10, recordedById: fixture.makerId,
      },
    });
    const running = await runningWithdrawal(prisma, fixture.companyId, group.id, new Date('2026-03-05'));
    expect(running?.until.toISOString().slice(0, 10)).toBe('2026-03-11');
    await expect(
      assertNoWithdrawal(prisma, { companyId: fixture.companyId, groupId: group.id, groupCode: group.code, on: new Date('2026-03-05'), doing: 'sold' }),
    ).rejects.toThrow(/LAY-1 cannot be sold on 2026-03-05: it was given Enrofloxacin on 2026-03-01 and its withdrawal period runs until 2026-03-11/);
    await assertNoWithdrawal(prisma, { companyId: fixture.companyId, groupId: group.id, groupCode: group.code, on: new Date('2026-03-12'), doing: 'sold' });

    const collect = (on: string, table: number, key: string) =>
      eggs.recordCollection({
        companyId: fixture.companyId, sourceGroupId: group.id, code: key, collectedOn: new Date(on), hatchingCount: 0, tableCount: table, rejectCount: 10 - table,
        recordedById: fixture.makerId, idempotencyKey: key,
      });
    await expect(collect('2026-03-05', 10, 'E1')).rejects.toThrow(/cannot be table eggs until then/);
    await collect('2026-03-05', 0, 'E2'); // discarded as rejects
    await collect('2026-03-12', 10, 'E3');
  });
});

describe('Incubation log and incubator capacity (FR-LIFE-04, INT-025)', () => {
  it('fits sets to registered incubators and holds the hatch for unacknowledged exceptions and candling', async () => {
    const group = await poultryGroup('PS-1');
    const collection = await eggs.recordCollection({
      companyId: fixture.companyId, sourceGroupId: group.id, code: 'EGG-1', collectedOn: new Date('2026-02-01'), hatchingCount: 500, tableCount: 0, rejectCount: 0,
      recordedById: fixture.makerId, idempotencyKey: 'egg-1',
    });

    // With none registered, the incubator is free text and unchecked.
    expect(await assertIncubatorRoom(prisma, { companyId: fixture.companyId, incubator: 'anything', setQuantity: 10_000 })).toBe('anything');
    await log.saveIncubator({ companyId: fixture.companyId, code: 'inc-1', name: 'Setter one', capacityEggs: 300, active: true, actor: checker() });
    const set = (qty: number, key: string, incubator: string | null = 'INC-1') =>
      eggs.setIncubation({
        companyId: fixture.companyId, eggBatchId: collection.id, code: key, setOn: new Date('2026-02-02'), setQuantity: qty, incubator,
        recordedById: fixture.makerId, idempotencyKey: key,
      });
    await expect(set(10, 'S0', null)).rejects.toThrow(/Name the incubator these eggs go into: INC-1/);
    const batch = await set(200, 'S1');
    expect(batch.incubator).toBe('INC-1');
    await expect(set(150, 'S2', 'Setter one')).rejects.toThrow(/INC-1 holds 300 eggs and has 200 in it, so 100 can go in; 150 were asked/);

    await log.setStandard({
      companyId: fixture.companyId, minTemperatureC: '37.2', maxTemperatureC: '37.8', minHumidityPercent: '45', maxHumidityPercent: '60', readingIntervalHours: 6, actor: checker(),
    });
    const hot = await log.record({
      companyId: fixture.companyId, incubationBatchId: batch.id, kind: 'ENVIRONMENT', readAt: new Date('2026-02-03T08:00:00Z'), temperatureC: '38.4', humidityPercent: '55',
      turned: true, actor: maker(),
    });
    expect(hot.exceptions).toEqual(['Temperature 38.4°C outside 37.2–37.8°C.']);
    await log.record({
      companyId: fixture.companyId, incubationBatchId: batch.id, kind: 'CANDLING', readAt: new Date('2026-02-09T08:00:00Z'), fertileCount: 180, clearCount: 15, deadInShellCount: 5,
      actor: maker(),
    });
    const overview = await log.overview(fixture.companyId, new Date('2026-02-10T08:00:00Z'));
    expect(overview.batches[0]).toMatchObject({ overdue: true, openExceptions: 1 });

    const ready = (unhatched: number, damaged: number) =>
      assertReadyToHatch(prisma, { companyId: fixture.companyId, incubationBatchId: batch.id, code: batch.code, unhatchedCount: unhatched, damagedCount: damaged });
    await expect(ready(30, 0)).rejects.toThrow(/1 incubation exception not yet acknowledged/);
    await expect(log.acknowledge({ companyId: fixture.companyId, readingId: hot.id, actionTaken: 'Vent opened', actor: { userId: fixture.makerId, roles: ['FARM_MANAGER'] } })).rejects.toThrow(
      /You took this reading/,
    );
    await log.acknowledge({ companyId: fixture.companyId, readingId: hot.id, actionTaken: 'Vent opened; back in range in 40 minutes', actor: checker() });
    await expect(ready(10, 5)).rejects.toThrow(/Candling found 20 clear or dead-in-shell eggs/);
    await ready(15, 5);
  });
});

describe('Timesheets (INT-013) and hours against pay (AC-HR-002)', () => {
  it('refuses overlapping shifts and time on a closed order, and reconciles hours to pay', async () => {
    const group = await poultryGroup('BRL-1');
    const employee = await prisma.employee.create({
      data: { companyId: fixture.companyId, employeeNumber: 'E-001', firstName: 'Ada', surname: 'Obi', employmentDate: new Date('2025-01-01') },
    });
    const shift = (from: string, to: string, day = '2026-02-10') =>
      timesheets.record({
        companyId: fixture.companyId, employeeId: employee.id, groupId: group.id, workDate: new Date(day), startsAt: new Date(from), endsAt: new Date(to), actor: maker(),
      });
    const first = await shift('2026-02-10T07:00:00Z', '2026-02-10T15:00:00Z');
    expect(first.hours.toString()).toBe('8');
    const other = await poultryGroup('BRL-2');
    await expect(
      timesheets.record({
        companyId: fixture.companyId, employeeId: employee.id, groupId: other.id, workDate: new Date('2026-02-10'),
        startsAt: new Date('2026-02-10T14:00:00Z'), endsAt: new Date('2026-02-10T18:00:00Z'), actor: maker(),
      }),
    ).rejects.toThrow(/overlaps another one already booked/);
    await expect(
      timesheets.record({ companyId: fixture.companyId, employeeId: employee.id, groupId: group.id, productionOrderId: 'x', workDate: new Date('2026-02-10'), hours: new Decimal(1), actor: maker() }),
    ).rejects.toThrow(/one of the two/);

    await prisma.livestockGroup.update({ where: { id: other.id }, data: { status: 'CLOSED', closedOn: new Date('2026-02-05') } });
    await expect(
      timesheets.record({ companyId: fixture.companyId, employeeId: employee.id, groupId: other.id, workDate: new Date('2026-02-10'), hours: new Decimal(2), actor: maker() }),
    ).rejects.toThrow(/BRL-2 closed on 2026-02-05/);

    // Hours pending, and approved hours with no pay, both stop the reconciliation.
    const recon = () => new LabourReconciliationService(prisma).reconcile(fixture.companyId, fixture.periodIds[0]!);
    const period = await prisma.financialPeriod.findUniqueOrThrow({ where: { id: fixture.periodIds[0]! } });
    await prisma.timesheetEntry.update({ where: { id: first.id }, data: { workDate: period.startDate } });
    let r = await recon();
    expect(r.reconciled).toBe(false);
    expect(r.checks.pendingHours).toBe('8.00');
    await timesheets.approve({ companyId: fixture.companyId, ids: [first.id], actor: { userId: fixture.checkerId, roles: ['FARM_MANAGER'] } });
    r = await recon();
    expect(r.checks.pendingHours).toBe('0.00');
    expect(r.checks.hoursWithoutPay).toBe(1);
    expect(r.employees[0]!.issue).toMatch(/not on a posted payroll run/);
  });
});

describe('WhatsApp only to verified, consenting recipients (AC-015)', () => {
  it('blocks each missing condition by name and lets the message through when all hold', async () => {
    const send = (event: 'APPROVAL' | 'SUBMISSION' = 'APPROVAL') =>
      gate(prisma, { companyId: fixture.companyId, channel: 'WHATSAPP', event, recipientId: fixture.checkerId });
    expect((await send()).reason).toMatch(/APPROVAL is not an event this company sends by WhatsApp/);
    await prisma.notificationPolicy.create({ data: { companyId: fixture.companyId, emailEvents: ['APPROVAL'], whatsappEvents: ['APPROVAL'], updatedById: fixture.makerId } });
    expect((await send()).reason).toMatch(/no WhatsApp number/);
    const contact = await prisma.notificationContact.create({ data: { companyId: fixture.companyId, userId: fixture.checkerId, whatsappNumber: '+2348031234567' } });
    expect((await send()).reason).toMatch(/not been verified/);
    await prisma.notificationContact.update({ where: { id: contact.id }, data: { whatsappVerifiedAt: new Date() } });
    expect((await send()).reason).toMatch(/not consented/);
    await prisma.notificationContact.update({ where: { id: contact.id }, data: { consentedAt: new Date() } });
    expect(await send()).toEqual({ ok: true, reason: null, to: '+2348031234567' });
    expect((await send('SUBMISSION')).ok).toBe(false);
    await prisma.notificationContact.update({ where: { id: contact.id }, data: { withdrawnAt: new Date() } });
    expect((await send()).reason).toMatch(/not consented/);
  });
});
