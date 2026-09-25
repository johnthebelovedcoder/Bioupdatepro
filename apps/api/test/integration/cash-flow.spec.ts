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
