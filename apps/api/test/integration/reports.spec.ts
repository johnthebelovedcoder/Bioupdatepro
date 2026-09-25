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
import { BalanceSheetService } from '../../src/reporting/balance-sheet.service';
import { CashFlowService } from '../../src/reporting/cash-flow.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Financial statements (UAT-022) and report access (UAT-023): the trial
 * balance, balance sheet and profit or loss agree, by farm as for the whole;
 * a report about another company's farm or a period outside its year is
 * refused with a reason, not answered with an empty page.
 */

let prisma: PrismaService;
let posting: PostingService;
let tb: TrialBalanceService;
let pl: ProfitLossService;
let bs: BalanceSheetService;
let cf: CashFlowService;
let fixture: TestFixture;
let otherFarm: string;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  tb = new TrialBalanceService(prisma);
  pl = new ProfitLossService(tb);
  bs = new BalanceSheetService(prisma, tb, pl);
  cf = new CashFlowService(prisma, pl);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  const second = await prisma.farm.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'NORTH', name: 'North farm' } });
  const post = async (n: string, farmId: string, revenue: bigint) => {
    const d = dims(fixture, 0, { farmId });
    await posting.post({
      sourceModule: 'test', sourceDocumentType: 'Test', journalNumber: n, journalDate: new Date('2026-01-15'), narration: n, ...dims(fixture, 0),
      idempotencyKey: n, actor: { userId: fixture.makerId, roles: ['CFO'] },
      lines: [
        { glAccountId: fixture.accounts['1101']!, description: n, debit: kobo(revenue), dimensions: d },
        { glAccountId: fixture.accounts['4101']!, description: n, credit: kobo(revenue), dimensions: d },
      ],
    });
  };
  await post('MAIN-SALE', fixture.farmId, 1_000_000n);
  await post('NORTH-SALE', second.id, 400_000n);

  // Somebody else's farm.
  const other = await prisma.company.create({ data: { code: 'OTHERCO', name: 'Other Co', baseCurrencyId: fixture.currencyId } });
  const otherBranch = await prisma.branch.create({ data: { companyId: other.id, code: 'HQ', name: 'HQ' } });
  otherFarm = (await prisma.farm.create({ data: { companyId: other.id, branchId: otherBranch.id, code: 'THEIRS', name: 'Their farm' } })).id;
});

describe('Financial statements (UAT-022)', () => {
  it('balances: TB debits equal credits, assets equal liabilities and equity, and the P&L is the equity movement', async () => {
    const trial = await tb.build({ companyId: fixture.companyId, financialYearId: fixture.financialYearId });
    expect(trial.balanced).toBe(true);
    const sheet = await bs.build({ companyId: fixture.companyId });
    expect(sheet.balanced).toBe(true);
    expect(sheet.totalAssetsKobo).toBe(sheet.totalLiabilitiesAndEquityKobo);
    const profit = await pl.build({ companyId: fixture.companyId, financialYearId: fixture.financialYearId });
    expect(profit.profitBeforeTaxKobo).toBe('1400000');
    expect(sheet.currentYearEarningsKobo).toBe('1400000');
  });

  it('reports each farm on its own, and the farms add up to the whole', async () => {
    const main = await pl.build({ companyId: fixture.companyId, financialYearId: fixture.financialYearId, farmId: fixture.farmId });
    const north = await prisma.farm.findFirstOrThrow({ where: { code: 'NORTH' } });
    const northPl = await pl.build({ companyId: fixture.companyId, financialYearId: fixture.financialYearId, farmId: north.id });
    expect([main.revenueKobo, northPl.revenueKobo]).toEqual(['1000000', '400000']);
    const cash = await cf.build({ companyId: fixture.companyId, financialPeriodId: fixture.periodIds[0]! });
    expect(cash.reconciled).toBe(true); // closing cash ties to the bank balance
  });
});

describe('Report access (UAT-023)', () => {
  it('refuses a report about another company’s farm', async () => {
    await expect(pl.build({ companyId: fixture.companyId, financialYearId: fixture.financialYearId, farmId: otherFarm })).rejects.toThrow(
      /That farm is not one of this company's/,
    );
    await expect(bs.build({ companyId: fixture.companyId, farmId: otherFarm })).rejects.toThrow(/not one of this company's/);
  });

  it('refuses a period outside the year named, and an id that is not one', async () => {
    const nextYear = await prisma.financialYear.create({
      data: { companyId: fixture.companyId, code: 'FY2027', startDate: new Date('2027-01-01'), endDate: new Date('2027-12-31') },
    });
    await expect(
      tb.build({ companyId: fixture.companyId, financialYearId: nextYear.id, financialPeriodId: fixture.periodIds[0]! }),
    ).rejects.toThrow(/is not in the financial year chosen/);
    await expect(tb.build({ companyId: fixture.companyId, financialPeriodId: 'last-month' })).rejects.toThrow(/That period is not one of this company's/);
    await expect(cf.build({ companyId: fixture.companyId, financialPeriodId: 'nope' })).rejects.toThrow(/period is not one/);
  });
});
