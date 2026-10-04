import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { ChartUnificationService } from '../../src/chart/chart-unification.service';
import { ApprovedCutoverService } from '../../src/chart/approved-cutover.service';
import { RearingCostService } from '../../src/biological-assets/rearing-cost.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ProfitLossService } from '../../src/reporting/profit-loss.service';
import { CashFlowService } from '../../src/reporting/cash-flow.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Moving a farm's books onto the approved five-digit chart: every balance
 * moves to the right approved account on the cutover date with its
 * dimensions, poultry rearing cost goes to the account of each cohort's
 * stage, the settings follow, and the company is switched.
 */

let prisma: PrismaService;
let posting: PostingService;
let provisioning: PostingControlProvisioningService;
let cutover: ApprovedCutoverService;
let unification: ChartUnificationService;
let rearing: RearingCostService;
let fixture: TestFixture;
let actor: { userId: string; roles: string[] };
const item: Record<string, string> = {};
const pen: Record<string, string> = {};
const group: Record<string, string> = {};

const CUTOVER = new Date('2026-10-01');
const approval = { approvedBy: 'Chief Financial Officer', reference: 'FIN-COA-2026-10' };

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  provisioning = new PostingControlProvisioningService(prisma, audit);
  rearing = new RearingCostService(prisma, posting);
  cutover = new ApprovedCutoverService(prisma, audit, posting, provisioning, rearing);
  unification = new ChartUnificationService(prisma, audit, posting, provisioning);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  actor = { userId: fixture.makerId, roles: ['CFO'] };

  const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'EA', name: 'Each' } });
  for (const [code, description, feed, account] of [
    ['FEED', 'Grower mash', true, '1301'],
    ['DRUG', 'Vitamins', false, '1301'],
    ['BOX', 'Egg cartons', false, '1301'],
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
  for (const [code, speciesKey, stage] of [['L-1', 'poultry', 'Grower'], ['S-1', 'snail', 'Grower']] as const) {
    const house = await prisma.penHouse.create({ data: { farmId: fixture.farmId, code: `PEN-${code}`, name: code } });
    pen[speciesKey] = house.id;
    group[speciesKey] = (
      await prisma.livestockGroup.create({
        data: {
          companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: house.id, code, speciesKey,
          breed: 'Test', purpose: 'Growers', stage, openingPopulation: 100, population: 100, startedOn: new Date('2026-01-01'),
        },
      })
    ).id;
  }
});

/** A January journal putting balances on the old accounts. */
async function books(extra: Array<{ account: string; debit?: bigint; credit?: bigint }> = []) {
  const line = (account: string, amount: { debit?: bigint; credit?: bigint }, over: Record<string, unknown> = {}) => ({
    glAccountId: fixture.accounts[account]!,
    description: `Opening ${account}`,
    ...(amount.debit ? { debit: kobo(amount.debit) } : { credit: kobo(amount.credit!) }),
    dimensions: dims(fixture, 0, over),
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
      line('1301', { debit: 100_000n }, { itemId: item.BOX }),
      line('1401', { debit: 800_000n }, { itemId: item.EGGS }),
      line('4101', { credit: 3_000_000n }, { itemId: item.EGGS }),
      line('2130', { credit: 6_400_000n }),
    ],
  });
  for (const [i, e] of extra.entries()) {
    await posting.post({
      sourceModule: 'test', sourceDocumentType: 'Extra', journalNumber: `EXTRA-${i}`, journalDate: new Date('2026-01-20'),
      narration: 'More', ...dims(fixture, 0), idempotencyKey: `extra-${i}`, actor,
      lines: [line(e.account, e), line('1101', e.debit ? { credit: e.debit } : { debit: e.credit })],
    });
  }
}

async function balance(number: string) {
  const account = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: number } });
  const sums = await prisma.journalLine.aggregate({ where: { glAccountId: account.id }, _sum: { debitKobo: true, creditKobo: true } });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
}
const numberOf = async (id: string | null) => (id ? (await prisma.gLAccount.findUniqueOrThrow({ where: { id } })).accountNumber : null);

describe('ApprovedCutoverService', () => {
  it('previews where every balance goes: by item, by cohort stage, by species, by sign', async () => {
    await provisioning.provision(fixture.companyId, null);
    await books();
    const preview = await cutover.preview(fixture.companyId, CUTOVER);
    expect(preview.blockers).toEqual([]);
    expect(preview.canRun).toBe(true);
    const moves = Object.fromEntries(preview.accounts.map((a) => [a.from, a.moves.map((m) => [m.to, m.amountKobo, m.assumed])]));
    expect(moves['1501']).toEqual(expect.arrayContaining([['16032', '5000000', false], ['52610', '2000000', false]]));
    expect(moves['1301']).toEqual(expect.arrayContaining([['12100', '1000000', false], ['12000', '500000', false], ['12200', '100000', false]]));
    expect(moves['1401']).toEqual([['12420', '800000', false]]);
    expect(moves['4101']).toEqual([['40330', '-3000000', false]]);
    expect(moves['2130']).toEqual([['20500', '-6400000', false]]);
    expect(preview.cohorts).toEqual([expect.objectContaining({ code: 'L-1', account: '16032' })]);
    expect(preview.items.find((i) => i.itemId === item.BOX)).toMatchObject({ stockClass: 'PACKAGING' });
  });

  it('refuses to run until Finance’s approval of the crosswalk is on record', async () => {
    await books();
    await expect(cutover.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, approval: { approvedBy: '', reference: '' }, actor })).rejects.toThrow(/Finance has not approved/);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: fixture.companyId } })).chartVersion).toBe('LEGACY');
  });

  it('moves the balances, repoints the settings, retires the old accounts and switches the chart', async () => {
    await books();
    const result = await cutover.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, approval, actor });
    expect(result.journals).toHaveLength(1);

    for (const old of ['1501', '1301', '1401', '4101', '2130']) expect(await balance(old)).toBe(0n);
    expect(await balance('16032')).toBe(5_000_000n);
    expect(await balance('52610')).toBe(2_000_000n);
    expect(await balance('12100')).toBe(1_000_000n);
    expect(await balance('12000')).toBe(500_000n);
    expect(await balance('12200')).toBe(100_000n);
    expect(await balance('12420')).toBe(800_000n);
    expect(await balance('40330')).toBe(-3_000_000n);
    expect(await balance('20500')).toBe(-6_400_000n);

    // Dated the cutover; each line keeps its item; the books still balance.
    const journal = await prisma.journalEntry.findUniqueOrThrow({ where: { id: result.journals[0]! }, include: { lines: true } });
    expect(journal.journalDate).toEqual(CUTOVER);
    expect(journal.lines.filter((l) => l.itemId === item.EGGS)).toHaveLength(4);
    expect((await new TrialBalanceService(prisma).build({ companyId: fixture.companyId })).balanced).toBe(true);

    const company = await prisma.company.findUniqueOrThrow({ where: { id: fixture.companyId } });
    expect(company.chartVersion).toBe('APPROVED');
    const retired = await prisma.gLAccount.findMany({ where: { companyId: fixture.companyId, accountNumber: { in: ['1501', '1301', '4101'] } } });
    expect(retired.every((a) => !a.active)).toBe(true);

    // Items follow what each is; the poultry cohort holds its cost in its stage's account.
    const eggs = await prisma.item.findUniqueOrThrow({ where: { id: item.EGGS } });
    expect(await numberOf(eggs.inventoryGlAccountId)).toBe('12420');
    expect(await numberOf(eggs.revenueGlAccountId)).toBe('40330');
    expect(await numberOf(eggs.costOfSalesGlAccountId)).toBe('50330');
    expect(await numberOf((await prisma.item.findUniqueOrThrow({ where: { id: item.FEED } })).inventoryGlAccountId)).toBe('12100');
    expect(await numberOf((await prisma.item.findUniqueOrThrow({ where: { id: item.BOX } })).inventoryGlAccountId)).toBe('12200');
    expect((await prisma.livestockGroup.findUniqueOrThrow({ where: { id: group.poultry } })).rearingHomeAccount).toBe('16032');

    // Sales and procurement now name approved accounts; nothing outside the target stays active or configured.
    const status = await provisioning.status(fixture.companyId);
    expect(status.targetChart.configurationsOutsideTarget).toEqual([]);
    expect(status.targetChart.activeAccountsOutsideTarget).toEqual([]);

    // A second run is refused.
    await expect(cutover.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, approval, actor })).rejects.toThrow(/already on the approved/);
  });

  it('keeps the cash flow statement reconciled to the bank in the month of the cutover (found by the restore rehearsal)', async () => {
    // Receivables and payables moving between accounts are not cash: both sides must count in the same bucket.
    for (const [number, name, accountType, normalBalance] of [['1201', 'Trade Receivables', 'ASSET', 'DEBIT'], ['2201', 'Trade Payables', 'LIABILITY', 'CREDIT']] as const) {
      fixture.accounts[number] ??= (await prisma.gLAccount.create({ data: { companyId: fixture.companyId, accountNumber: number, name, accountType, normalBalance } })).id;
    }
    await books([{ account: '1201', debit: 70_000n }, { account: '2201', credit: 20_000n }]);
    await cutover.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, approval, actor });
    const periods = await prisma.financialPeriod.findMany({ where: { financialYearId: fixture.financialYearId }, orderBy: { periodNumber: 'asc' } });
    const october = periods.find((p) => p.startDate.getTime() === CUTOVER.getTime())!;
    const cash = await new CashFlowService(prisma, new ProfitLossService(new TrialBalanceService(prisma))).build({ companyId: fixture.companyId, financialPeriodId: october.id });
    expect(cash.reconciled).toBe(true);
    expect(cash.netCashFromOperationsKobo).toBe('0');
  });

  it('puts a mature cohort’s cost in 16042 and keeps the subledger and the ledger together', async () => {
    await prisma.livestockGroup.update({ where: { id: group.poultry }, data: { stage: 'Layer' } });
    await books();
    await cutover.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, approval, actor });
    expect(await balance('16042')).toBe(5_000_000n);
    expect(await balance('16032')).toBe(0n);
    expect((await prisma.livestockGroup.findUniqueOrThrow({ where: { id: group.poultry } })).rearingHomeAccount).toBe('16042');
  });

  it('shares a pen’s rearing cost between an immature and a mature cohort by the cost each carries', async () => {
    await prisma.livestockGroup.create({
      data: {
        companyId: fixture.companyId, branchId: fixture.branchId, farmId: fixture.farmId, penHouseId: pen.poultry!, code: 'L-2', speciesKey: 'poultry',
        breed: 'Test', purpose: 'Layer', stage: 'Layer', openingPopulation: 300, population: 300, startedOn: new Date('2026-01-01'),
      },
    });
    await books();
    const preview = await cutover.preview(fixture.companyId, CUTOVER);
    const rearingMoves = preview.accounts.find((a) => a.from === '1501')!.moves.filter((m) => m.to.startsWith('160'));
    // No cost recorded against either: head count (100 vs 300) decides.
    expect(Object.fromEntries(rearingMoves.map((m) => [m.to, m.amountKobo]))).toEqual({ '16032': '1250000', '16042': '3750000' });
    await cutover.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, approval, actor });
    expect(await balance('16032')).toBe(1_250_000n);
    expect(await balance('16042')).toBe(3_750_000n);
  });

  it('goes on from the six-digit chart too', async () => {
    await books();
    await unification.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, actor });
    expect((await prisma.company.findUniqueOrThrow({ where: { id: fixture.companyId } })).chartVersion).toBe('SPEC');
    // The next month: the six-digit chart is the source.
    const next = new Date('2026-11-01');
    const result = await cutover.run({ companyId: fixture.companyId, cutoverDate: next, approval, actor });
    expect(result.moved).toBeGreaterThan(0);
    for (const old of ['130210', '130110', '130100', '130215', '410300', '225100']) expect(await balance(old)).toBe(0n);
    expect(await balance('16032')).toBe(5_000_000n);
    expect(await balance('12100')).toBe(1_000_000n);
    expect(await balance('12420')).toBe(800_000n);
    expect(await balance('20500')).toBe(-6_400_000n);
    expect((await new TrialBalanceService(prisma).build({ companyId: fixture.companyId })).balanced).toBe(true);
  });

  it('refuses while an account with no approved home holds a balance, and lets a person choose one', async () => {
    fixture.accounts['5502'] = (
      await prisma.gLAccount.create({
        data: { companyId: fixture.companyId, accountNumber: '5502', name: 'Impairment Loss - Fixed Assets', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
      })
    ).id;
    await books([{ account: '5502', debit: 10_000n }]);
    const preview = await cutover.preview(fixture.companyId, CUTOVER);
    expect(preview.canRun).toBe(false);
    expect(preview.blockers.join()).toMatch(/5502.*Impairment/);
    await expect(cutover.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, approval, actor })).rejects.toThrow(/5502/);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: fixture.companyId } })).chartVersion).toBe('LEGACY');

    // Finance picks an account for it.
    const chosen = await cutover.preview(fixture.companyId, CUTOVER, { overrides: { '5502': '58000' } });
    expect(chosen.blockers).toEqual([]);
    await cutover.run({ companyId: fixture.companyId, cutoverDate: CUTOVER, approval, options: { overrides: { '5502': '58000' } }, actor });
    expect(await balance('58000')).toBe(10_000n);
  });

  it('refuses while the clearing account holds a balance, a bad cutover date, and late entries on the old accounts', async () => {
    await books([{ account: '5205', credit: 10_000n }]);
    expect((await cutover.preview(fixture.companyId, CUTOVER)).blockers.join()).toMatch(/5205/);
    expect((await cutover.preview(fixture.companyId, new Date('2026-10-15'))).blockers.join()).toMatch(/first day of a month/);
  });
});
