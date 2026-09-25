import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { ChartUnificationService, proposeClass } from '../../src/chart/chart-unification.service';
import { kobo } from '../../src/common/money';
import { ProvisioningService } from '../../src/auth/provisioning.service';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Moving a farm's books from the four-digit chart to the six-digit one: every
 * balance moves to the right new account on the cutover date, with its
 * dimensions, and the settings follow.
 */

let prisma: PrismaService;
let posting: PostingService;
let unification: ChartUnificationService;
let fixture: TestFixture;
let actor: { userId: string; roles: string[] };
const item: Record<string, string> = {};
const pen: Record<string, string> = {};

const CUTOVER = new Date('2026-10-01');

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  unification = new ChartUnificationService(prisma, audit, posting, new PostingControlProvisioningService(prisma, audit));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  actor = { userId: fixture.makerId, roles: ['CFO'] };

  const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'EA', name: 'Each' } });
  for (const [code, description, feed, account] of [
    ['FEED', 'Grower mash', true, '1301'],
    ['DRUG', 'Vitamins', false, '1301'],
    ['EGGS', 'Table eggs (crate)', false, '1401'],
  ] as const) {
    item[code] = (
      await prisma.item.create({
        data: {
          companyId: fixture.companyId, code, description, unitOfMeasureId: uom.id, isBiologicalFeed: feed,
          inventoryGlAccountId: fixture.accounts[account]!, revenueGlAccountId: code === 'EGGS' ? fixture.accounts['4101']! : null,
        },
      })
    ).id;
  }
  for (const [code, speciesKey] of [['L-1', 'poultry'], ['S-1', 'snail']] as const) {
    const house = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: `PEN-${code}`, name: code } });
    pen[speciesKey] = house.id;
    await prisma.livestockGroup.create({
      data: {
        companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: house.id, code, speciesKey,
        breed: 'Test', purpose: 'Growers', stage: 'Grower', openingPopulation: 100, population: 100, startedOn: new Date('2026-01-01'),
      },
    });
  }
});

/** A January journal putting balances on the old accounts. */
async function books(extra: Array<{ account: string; debit?: bigint; credit?: bigint; date?: Date; period?: number }> = []) {
  const line = (account: string, amount: { debit?: bigint; credit?: bigint }, over: Record<string, unknown> = {}, period = 0) => ({
    glAccountId: fixture.accounts[account]!,
    description: `Opening ${account}`,
    ...(amount.debit ? { debit: kobo(amount.debit) } : { credit: kobo(amount.credit!) }),
    dimensions: dims(fixture, period, over),
  });
  const cc = { costCentreId: fixture.costCentreId, farmId: fixture.farmId };
  await posting.post({
    sourceModule: 'test', sourceDocumentType: 'Opening', journalNumber: 'OPEN-1', journalDate: new Date('2026-01-15'),
    narration: 'Balances on the old chart', ...dims(fixture, 0), idempotencyKey: 'open-1', actor,
    lines: [
      line('1501', { debit: 5_000_000n }, { ...cc, penHouseId: pen.poultry }),
      line('1501', { debit: 2_000_000n }, { ...cc, penHouseId: pen.snail }),
      line('1301', { debit: 1_000_000n }, { itemId: item.FEED }),
      line('1301', { debit: 500_000n }, { itemId: item.DRUG }),
      line('1401', { debit: 800_000n }, { itemId: item.EGGS }),
      line('4101', { credit: 3_000_000n }, { itemId: item.EGGS }),
      line('2130', { credit: 6_300_000n }),
    ],
  });
  for (const [i, e] of extra.entries()) {
    const period = e.period ?? 0;
    const date = e.date ?? new Date('2026-01-20');
    await posting.post({
      sourceModule: 'test', sourceDocumentType: 'Extra', journalNumber: `EXTRA-${i}`, journalDate: date,
      narration: 'More', ...dims(fixture, period), idempotencyKey: `extra-${i}`, actor,
      lines: [line(e.account, e, {}, period), line('1101', e.debit ? { credit: e.debit } : { debit: e.credit }, {}, period)],
    });
  }
}

async function balance(number: string) {
  const account = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: number } });
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: account.id }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
}

describe('ChartUnificationService', () => {
  it('proposes what an item is from its name', () => {
    expect(proposeClass('Table eggs (crate)')).toBe('EGGS');
    expect(proposeClass('Cosmetic Snail Slime 100ml')).toBe('PROCESSED_SNAIL');
    expect(proposeClass('Live snails — jumbo')).toBe('LIVE_SNAIL');
    expect(proposeClass('Dressed broiler, frozen')).toBe('PROCESSED_POULTRY');
    expect(proposeClass('Spent layers')).toBe('LIVE_POULTRY');
    expect(proposeClass('Diesel')).toBeNull();
  });

  it('previews where every balance goes, by item and by species', async () => {
    await books();
    const preview = await unification.preview(fixture.companyId, CUTOVER);

    expect(preview.blockers).toEqual([]);
    expect(preview.canRun).toBe(true);
    const moves = Object.fromEntries(preview.accounts.map((a) => [a.from, a.moves.map((m) => [m.to, m.amountKobo, m.assumed])]));
    expect(moves['1501']).toEqual(expect.arrayContaining([['130210', '5000000', false], ['611000', '2000000', false]]));
    expect(moves['1301']).toEqual(expect.arrayContaining([['130110', '1000000', false], ['130100', '500000', false]]));
    expect(moves['1401']).toEqual([['130215', '800000', false]]);
    expect(moves['4101']).toEqual([['410300', '-3000000', false]]);
    expect(moves['2130']).toEqual([['225100', '-6300000', false]]);
    expect(preview.items.find((i) => i.itemId === item.EGGS)).toMatchObject({ proposed: 'EGGS', chosen: 'EGGS' });
  });

  it('moves the balances, repoints the settings, retires the old accounts and switches the chart', async () => {
    await books();
    const result = await unification.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, actor });
    expect(result.journals).toHaveLength(1);

    for (const old of ['1501', '1301', '1401', '4101', '2130']) expect(await balance(old)).toBe(0n);
    expect(await balance('130210')).toBe(5_000_000n);
    expect(await balance('611000')).toBe(2_000_000n);
    expect(await balance('130110')).toBe(1_000_000n);
    expect(await balance('130100')).toBe(500_000n);
    expect(await balance('130215')).toBe(800_000n);
    expect(await balance('410300')).toBe(-3_000_000n);
    expect(await balance('225100')).toBe(-6_300_000n);

    // Dated the cutover, and each line keeps its item.
    const journal = await prisma.journalEntry.findUniqueOrThrow({ where: { id: result.journals[0]! }, include: { lines: true } });
    expect(journal.journalDate).toEqual(CUTOVER);
    const eggLines = journal.lines.filter((l) => l.itemId === item.EGGS);
    expect(eggLines).toHaveLength(4); // 1401 → 130215 and 4101 → 410300, two lines each

    const company = await prisma.company.findUniqueOrThrow({ where: { id: fixture.companyId } });
    expect(company.chartVersion).toBe('SPEC');
    const retired = await prisma.gLAccount.findMany({ where: { companyId: fixture.companyId, accountNumber: { in: ['1501', '1301', '4101'] } } });
    expect(retired.every((a) => !a.active)).toBe(true);

    const number = async (id: string | null) => (id ? (await prisma.gLAccount.findUniqueOrThrow({ where: { id } })).accountNumber : null);
    const eggs = await prisma.item.findUniqueOrThrow({ where: { id: item.EGGS } });
    expect(await number(eggs.inventoryGlAccountId)).toBe('130215');
    expect(await number(eggs.revenueGlAccountId)).toBe('410300');
    expect(await number(eggs.costOfSalesGlAccountId)).toBe('510300');
    const feed = await prisma.item.findUniqueOrThrow({ where: { id: item.FEED } });
    expect(await number(feed.inventoryGlAccountId)).toBe('130110');

    // Refuses a second run.
    await expect(unification.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, actor })).rejects.toThrow(/already on the six-digit chart/);
  });

  it('refuses while the clearing account holds a balance', async () => {
    await books([{ account: '5205', credit: 10_000n }]);
    const preview = await unification.preview(fixture.companyId, CUTOVER);
    expect(preview.canRun).toBe(false);
    expect(preview.blockers.join()).toMatch(/5205/);
    await expect(unification.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, actor })).rejects.toThrow(/5205/);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: fixture.companyId } })).chartVersion).toBe('LEGACY');
  });

  it('refuses when the old accounts already have entries on or after the cutover', async () => {
    await books([{ account: '1301', debit: 10_000n, date: new Date('2026-10-05'), period: 9 }]);
    const preview = await unification.preview(fixture.companyId, CUTOVER);
    expect(preview.blockers.join()).toMatch(/on or after 2026-10-01/);
  });

  it('refuses a cutover that is not the first day of a month', async () => {
    const preview = await unification.preview(fixture.companyId, new Date('2026-10-15'));
    expect(preview.blockers.join()).toMatch(/first day of a month/);
  });

  it('starts a newly registered farm on the six-digit chart, every setting pointing at it', async () => {
    const { companyId } = await prisma.$transaction((tx) => new ProvisioningService().provisionCompany(tx, { farmName: 'New Farm' }), { timeout: 60_000 });
    const first = await prisma.financialPeriod.findFirstOrThrow({ where: { financialYear: { companyId } }, orderBy: { startDate: 'asc' } });

    const result = await unification.run({ companyId, cutoverDate: first.startDate, actor });
    expect(result.journals).toEqual([]); // nothing to move

    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).chartVersion).toBe('SPEC');
    const active = await prisma.gLAccount.findMany({ where: { companyId, active: true }, select: { accountNumber: true } });
    expect(active.filter((a) => !/^\d{6}$/.test(a.accountNumber))).toEqual([]);

    // Every setting that names an account names a six-digit one.
    const number = (a: { accountNumber: string } | null) => a?.accountNumber ?? null;
    const sales = await prisma.salesConfiguration.findFirstOrThrow({
      where: { companyId },
      include: { receivableAccount: true, revenueAccount: true, costOfSalesAccount: true, inventoryAccount: true },
    });
    expect([sales.receivableAccount, sales.revenueAccount, sales.costOfSalesAccount, sales.inventoryAccount].map(number)).toEqual([
      '120100', '410300', '510300', '130520',
    ]);
    const procurement = await prisma.procurementConfiguration.findFirstOrThrow({ where: { companyId }, include: { grniAccount: true, payablesAccount: true } });
    expect([number(procurement.grniAccount), number(procurement.payablesAccount)]).toEqual(['210200', '210100']);
    const components = await prisma.salaryComponent.findMany({ where: { companyId }, include: { payableGlAccount: true, expenseGlAccount: true } });
    for (const c of components) {
      for (const a of [c.payableGlAccount, c.expenseGlAccount]) if (a) expect(a.accountNumber).toMatch(/^\d{6}$/);
    }
  });
});
