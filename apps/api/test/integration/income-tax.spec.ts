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
 * Company income tax (PCR-084, 500_Assumptions: 30%): provided for on the
 * year's profit to date, re-runnable, reversed by a later loss, shown below
 * profit before tax, and still leaving the balance sheet balanced and the
 * cash flow at the bank balance.
 */

let prisma: PrismaService;
let posting: PostingService;
let tax: IncomeTaxService;
let pl: ProfitLossService;
let bs: BalanceSheetService;
let cf: CashFlowService;
let fixture: TestFixture;
const cfo = () => ({ userId: fixture.makerId, roles: ['CFO'] });

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
  await new PostingControlProvisioningService(prisma, new AuditService(prisma)).provision(fixture.companyId, null);
});

async function trade(n: string, period: number, amount: bigint) {
  const d = dims(fixture, period);
  const [dr, cr] = amount > 0n ? ['1101', '4101'] : ['5501', '1101'];
  const abs = amount > 0n ? amount : -amount;
  if (!fixture.accounts['5501']) {
    fixture.accounts['5501'] = (await prisma.gLAccount.create({ data: { companyId: fixture.companyId, accountNumber: '5501', name: 'Depreciation', accountType: 'EXPENSE', normalBalance: 'DEBIT' } })).id;
  }
  await posting.post({
    sourceModule: 'test', sourceDocumentType: 'Test', journalNumber: n, journalDate: new Date(Date.UTC(2026, period, 15)), narration: n,
    ...d, idempotencyKey: n, actor: cfo(),
    lines: [
      { glAccountId: fixture.accounts[dr]!, description: n, debit: kobo(abs), dimensions: d },
      { glAccountId: fixture.accounts[cr]!, description: n, credit: kobo(abs), dimensions: d },
    ],
  });
}

describe('Income tax (PCR-084)', () => {
  it('provides 30% of the year-to-date profit, once, and shows profit after tax', async () => {
    await trade('JAN', 0, 1_000_000_00n); // ₦1m profit

    const first = await tax.provide({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]!, actor: cfo() });
    expect(first).toMatchObject({ ratePercent: '30', profitBeforeTaxYtdKobo: '100000000', taxDueYtdKobo: '30000000', postedKobo: '30000000' });
    const again = await tax.provide({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]!, actor: cfo() });
    expect(again.postedKobo).toBe('0'); // nothing more to provide

    const january = await pl.build({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]! });
    expect(january).toMatchObject({ profitBeforeTaxKobo: '100000000', incomeTaxKobo: '30000000', profitAfterTaxKobo: '70000000' });
    expect((await bs.build({ companyId: fixture.companyId })).balanced).toBe(true);
    const cash = await cf.build({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]! });
    expect(cash.netIncomeKobo).toBe('70000000');
    expect(cash.reconciled).toBe(true);
  });

  it('reverses what a later loss no longer justifies, and never provides on a loss', async () => {
    await trade('JAN', 0, 1_000_000_00n);
    await tax.provide({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]!, actor: cfo() });
    await trade('FEB-LOSS', 1, -400_000_00n); // year to date now ₦600,000

    const feb = await tax.provide({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[1]!, actor: cfo() });
    expect(feb).toMatchObject({ taxDueYtdKobo: '18000000', alreadyProvidedKobo: '30000000', postedKobo: '-12000000' });

    await trade('MAR-LOSS', 2, -900_000_00n); // year to date now a ₦300,000 loss
    const mar = await tax.provide({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[2]!, actor: cfo() });
    expect(mar).toMatchObject({ taxDueYtdKobo: '0', postedKobo: '-18000000' });
  });

  it('uses the company’s own rate, and refuses one that is not a percentage', async () => {
    await tax.setRate({ companyId: fixture.companyId, ratePercent: 25, actor: cfo() });
    await trade('JAN', 0, 1_000_000_00n);
    expect((await tax.preview(fixture.companyId, fixture.periodIds[0]!)).taxDueYtdKobo).toBe('25000000');
    await expect(tax.setRate({ companyId: fixture.companyId, ratePercent: 130, actor: cfo() })).rejects.toThrow(/from 0 to 100/);
  });
});
