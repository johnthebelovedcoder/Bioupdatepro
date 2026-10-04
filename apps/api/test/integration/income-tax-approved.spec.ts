import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { PostingControlService } from '../../src/posting-control/posting-control.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ProfitLossService } from '../../src/reporting/profit-loss.service';
import { BalanceSheetService } from '../../src/reporting/balance-sheet.service';
import { CashFlowService } from '../../src/reporting/cash-flow.service';
import { IncomeTaxService } from '../../src/closing/income-tax.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Company income tax (PCR-084) on the approved chart: provided to 58000 income
 * tax expense against 20900 current income tax payable, shown below profit
 * before tax, with the balance sheet balanced and the cash flow at the bank.
 */

let prisma: PrismaService;
let posting: PostingService;
let tax: IncomeTaxService;
let pl: ProfitLossService;
let bs: BalanceSheetService;
let cf: CashFlowService;
let fixture: TestFixture;
const cfo = () => ({ userId: fixture.makerId, roles: ['CFO'] });
const acct = async (n: string) => (await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: n } })).id;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  const tb = new TrialBalanceService(prisma);
  pl = new ProfitLossService(tb);
  bs = new BalanceSheetService(prisma, tb, pl);
  cf = new CashFlowService(prisma, pl);
  tax = new IncomeTaxService(prisma, audit, posting, new PostingControlService(prisma), pl);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'APPROVED' } });
  await new PostingControlProvisioningService(prisma, new AuditService(prisma)).provision(fixture.companyId, null);
});

/** A sale for cash (Dr bank / Cr revenue) or, when negative, a cost (Dr depreciation expense / Cr bank). */
async function trade(n: string, period: number, amount: bigint) {
  const d = dims(fixture, period, { costCentreId: fixture.costCentreId });
  const [dr, cr] = amount > 0n ? ['10100', '40000'] : ['52400', '10100'];
  const abs = amount > 0n ? amount : -amount;
  await posting.post({
    sourceModule: 'test', sourceDocumentType: 'Test', journalNumber: n, journalDate: new Date(Date.UTC(2026, period, 15)), narration: n,
    ...d, idempotencyKey: n, actor: cfo(),
    lines: [
      { glAccountId: await acct(dr), description: n, debit: kobo(abs), dimensions: d },
      { glAccountId: await acct(cr), description: n, credit: kobo(abs), dimensions: d },
    ],
  });
}

async function balance(accountNumber: string) {
  const sums = await prisma.journalLine.aggregate({
    where: { glAccountId: await acct(accountNumber), journalEntry: { status: 'POSTED' } },
    _sum: { debitKobo: true, creditKobo: true },
  });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
}

describe('income tax on the approved chart (PCR-084)', () => {
  it('provides 30% of the year-to-date profit to 58000 against 20900, once, below profit before tax', async () => {
    await trade('JAN', 0, 1_000_000_00n);
    const first = await tax.provide({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]!, actor: cfo() });
    expect(first).toMatchObject({ ratePercent: '30', profitBeforeTaxYtdKobo: '100000000', taxDueYtdKobo: '30000000', postedKobo: '30000000' });
    expect(await balance('58000')).toBe(30_000_000n);
    expect(await balance('20900')).toBe(-30_000_000n);
    expect((await tax.provide({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]!, actor: cfo() })).postedKobo).toBe('0');

    const january = await pl.build({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]! });
    expect(january).toMatchObject({ profitBeforeTaxKobo: '100000000', incomeTaxKobo: '30000000', profitAfterTaxKobo: '70000000', operatingExpenseKobo: '0' });
    expect((await bs.build({ companyId: fixture.companyId })).balanced).toBe(true);
    const cash = await cf.build({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]! });
    expect(cash.netIncomeKobo).toBe('70000000');
    expect(cash.reconciled, JSON.stringify(cash)).toBe(true);
  });

  it('reverses what a later loss no longer justifies', async () => {
    await trade('JAN', 0, 1_000_000_00n);
    await tax.provide({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]!, actor: cfo() });
    await trade('FEB-LOSS', 1, -400_000_00n); // year to date now ₦600,000
    const feb = await tax.provide({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[1]!, actor: cfo() });
    expect(feb).toMatchObject({ taxDueYtdKobo: '18000000', alreadyProvidedKobo: '30000000', postedKobo: '-12000000' });
    expect(await balance('58000')).toBe(18_000_000n);
    expect(await balance('20900')).toBe(-18_000_000n);
  });
});
