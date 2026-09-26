import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { ProfitLossService } from '../../src/reporting/profit-loss.service';
import { CashFlowService } from '../../src/reporting/cash-flow.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * The cash-flow statement on a livestock farm (IAS 7 with IAS 41): a
 * fair-value gain and eggs valued at collection are income that is not cash,
 * shown as their own line and not mistaken for working capital — and the
 * statement still ends at the bank balance.
 */

let prisma: PrismaService;
let posting: PostingService;
let cashFlow: CashFlowService;
let fixture: TestFixture;
const account: Record<string, string> = {};

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  cashFlow = new CashFlowService(prisma, new ProfitLossService(new TrialBalanceService(prisma)));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  for (const [number, name, type, normal] of [
    ['130210', 'BA — Poultry', 'ASSET', 'DEBIT'],
    ['130215', 'BA/Inventory — Eggs', 'ASSET', 'DEBIT'],
    ['420200', 'Fair-Value Gain/Loss — Poultry', 'REVENUE', 'CREDIT'],
    ['420210', 'Agricultural Produce Gain — Eggs', 'REVENUE', 'CREDIT'],
  ] as const) {
    account[number] = (
      await prisma.gLAccount.create({ data: { companyId: fixture.companyId, accountNumber: number, name, accountType: type, normalBalance: normal } })
    ).id;
  }
  await prisma.biologicalAssetStageAccount.create({
    data: { companyId: fixture.companyId, speciesKey: 'poultry', stage: 'Layer', glAccountId: account['130210']! },
  });
});

async function journal(number: string, period: number, lines: Array<[string, 'debit' | 'credit', bigint]>) {
  await posting.post({
    sourceModule: 'test', sourceDocumentType: 'Test', journalNumber: number,
    journalDate: new Date(Date.UTC(2026, period, 15)), narration: number, ...dims(fixture, period), idempotencyKey: number,
    actor: { userId: fixture.makerId, roles: ['CFO'] },
    lines: lines.map(([id, side, amount]) => ({ glAccountId: id, description: number, [side]: kobo(amount), dimensions: dims(fixture, period) })),
  });
}

describe('CashFlowService — direct method (AC-ENT-001, 500_Cash_Flow)', () => {
  it('classifies every bank movement by what it paid for, and agrees with the indirect method and the bank', async () => {
    const extra: Record<string, string> = {};
    for (const [number, name, type, normal] of [
      ['1201', 'Trade Receivables', 'ASSET', 'DEBIT'],
      ['1701', 'Property, Plant & Equipment', 'ASSET', 'DEBIT'],
      ['110100', 'Bank — second account', 'ASSET', 'DEBIT'],
      ['2201', 'Trade Payables', 'LIABILITY', 'CREDIT'],
      ['2101', 'Salaries Payable', 'LIABILITY', 'CREDIT'],
      ['3100', 'Share Capital', 'EQUITY', 'CREDIT'],
      ['5401', 'Operating Expenses', 'EXPENSE', 'DEBIT'],
    ] as const) {
      extra[number] = (await prisma.gLAccount.create({ data: { companyId: fixture.companyId, accountNumber: number, name, accountType: type, normalBalance: normal } })).id;
    }
    const a = { ...fixture.accounts, ...extra };
    // March.
    await journal('CAPITAL', 2, [[a['1101']!, 'debit', 10_000_000n], [a['3100']!, 'credit', 10_000_000n]]);
    await journal('INVOICE', 2, [[a['1201']!, 'debit', 1_000_000n], [a['4101']!, 'credit', 1_000_000n]]);
    // The customer pays ₦9,000 and deducts ₦1,000 withholding.
    await journal('RECEIPT', 2, [[a['1101']!, 'debit', 900_000n], [a['1602']!, 'debit', 100_000n], [a['1201']!, 'credit', 1_000_000n]]);
    await journal('TRACTOR', 2, [[a['1701']!, 'debit', 3_000_000n], [a['1101']!, 'credit', 3_000_000n]]);
    await journal('FEED-BILL', 2, [[a['1301']!, 'debit', 400_000n], [a['2201']!, 'credit', 400_000n]]);
    await journal('FEED-PAY', 2, [[a['2201']!, 'debit', 400_000n], [a['1101']!, 'credit', 400_000n]]);
    await journal('WAGES', 2, [[a['5401']!, 'debit', 250_000n], [a['2101']!, 'credit', 250_000n]]);
    await journal('WAGES-PAY', 2, [[a['2101']!, 'debit', 250_000n], [a['1101']!, 'credit', 250_000n]]);
    await journal('VAT-DUE', 2, [[a['5401']!, 'debit', 75_000n], [a['2120']!, 'credit', 75_000n]]);
    await journal('VAT-PAY', 2, [[a['2120']!, 'debit', 75_000n], [a['1101']!, 'credit', 75_000n]]);
    await journal('SWEEP', 2, [[a['110100']!, 'debit', 500_000n], [a['1101']!, 'credit', 500_000n]]);

    const march = await cashFlow.build({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[2]! });
    expect(march.direct).toMatchObject({
      customerReceiptsKobo: '900000', // what the customer actually paid, not the invoice
      supplierPaymentsKobo: '-400000',
      employeePaymentsKobo: '-250000',
      taxesPaidKobo: '-75000',
      otherOperatingKobo: '0',
      netCashFromOperationsKobo: '175000',
      investingKobo: '-3000000',
      financingKobo: '10000000',
      netChangeInCashKobo: '7175000',
      closingCashKobo: '7175000',
      journals: 6, // the sweep between banks moves no cash
    });
    expect(march.bankAccountClosingKobo).toBe('7175000');
    // The workbook's three checks.
    expect(march.checks).toEqual({ directKobo: '0', indirectKobo: '0', directVsIndirectOperatingKobo: '0' });
    expect(march.netCashFromFinancingKobo).toBe('10000000');
    expect(march.reconciled).toBe(true);
  });
});

describe('CashFlowService — biological assets', () => {
  it('shows fair-value and egg gains as non-cash, and still ends at the bank balance', async () => {
    // January: the flock bought for cash.
    await journal('BUY', 0, [[account['130210']!, 'debit', 5_000_000n], [fixture.accounts['1101']!, 'credit', 5_000_000n]]);
    // February: eggs collected at value, the flock revalued up, eggs sold for cash.
    await journal('EGGS', 1, [[account['130215']!, 'debit', 900_000n], [account['420210']!, 'credit', 900_000n]]);
    await journal('FV', 1, [[account['130210']!, 'debit', 2_000_000n], [account['420200']!, 'credit', 2_000_000n]]);
    await journal('SALE', 1, [[fixture.accounts['1101']!, 'debit', 1_200_000n], [fixture.accounts['4101']!, 'credit', 1_200_000n]]);

    const february = await cashFlow.build({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[1]! });

    expect(february.netIncomeKobo).toBe('4100000'); // 1.2m sale + 0.9m eggs + 2.0m revaluation
    expect(february.fairValueAdjustmentKobo).toBe('-2900000'); // the gains that were not cash
    expect(february.inventoryChangeKobo).toBe('0'); // nothing bought or used: no working-capital movement
    expect(february.netCashFromOperationsKobo).toBe('1200000'); // the sale, and only the sale
    expect(february.reconciled).toBe(true);
    expect(february.closingCashKobo).toBe(february.bankAccountClosingKobo);
  });

  it('reconciles in the month the flock was bought, with no gain at all', async () => {
    await journal('BUY', 0, [[account['130210']!, 'debit', 5_000_000n], [fixture.accounts['1101']!, 'credit', 5_000_000n]]);
    const january = await cashFlow.build({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]! });
    expect(january.fairValueAdjustmentKobo).toBe('0');
    expect(january.inventoryChangeKobo).toBe('-5000000');
    expect(january.reconciled).toBe(true);
  });
});
