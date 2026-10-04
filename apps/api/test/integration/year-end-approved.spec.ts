import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { YearEndService } from '../../src/closing/year-end.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Year-end close on the approved chart. Its expense, revenue and inventory
 * control accounts all require a cost centre; the closing and opening
 * journals carry balances as a whole, so they take the company's usable cost
 * centre rather than being refused (found by the cutover rehearsal).
 */

let prisma: PrismaService;
let posting: PostingService;
let yearEnd: YearEndService;
let fixture: TestFixture;
const controller = () => ({ userId: fixture.financeUserId, roles: ['FINANCE_CONTROLLER'] });
const acct = async (n: string) => (await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: n } })).id;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
  yearEnd = new YearEndService(prisma, audit, posting, new TrialBalanceService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'APPROVED' } });
  await new PostingControlProvisioningService(prisma, new AuditService(prisma)).provision(fixture.companyId, null);
});

async function balance(accountNumber: string) {
  const sums = await prisma.journalLine.aggregate({
    where: { glAccountId: await acct(accountNumber), journalEntry: { status: 'POSTED' } },
    _sum: { debitKobo: true, creditKobo: true },
  });
  return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
}

describe('year-end close on the approved chart', () => {
  it('sweeps revenue, expense and recovery, carries cost-centre controls forward, and opens the next year', async () => {
    const d = dims(fixture, 0, { costCentreId: fixture.costCentreId });
    const post = async (n: string, lines: Array<[string, 'debit' | 'credit', bigint]>) =>
      posting.post({
        sourceModule: 'test', sourceDocumentType: 'Test', journalNumber: n, journalDate: new Date('2026-01-15'), narration: n,
        ...d, idempotencyKey: n, actor: controller(),
        lines: await Promise.all(lines.map(async ([account, side, amount]) => ({ glAccountId: await acct(account), description: n, [side]: kobo(amount), dimensions: d }))),
      });
    await post('SALE', [['10100', 'debit', 1_000_000_00n], ['40000', 'credit', 1_000_000_00n]]);
    await post('COST', [['56000', 'debit', 300_000_00n], ['10100', 'credit', 300_000_00n]]);
    // Finished goods held (a cost-centre control), recovered through a contra-expense account.
    await post('HELD', [['12420', 'debit', 100_000_00n], ['54000', 'credit', 100_000_00n]]);

    await prisma.financialPeriod.updateMany({ where: { financialYearId: fixture.financialYearId }, data: { status: 'CLOSED' } });
    const result = await yearEnd.close({ financialYearId: fixture.financialYearId, actor: controller() });

    expect(result.retainedEarningsKobo).toBe('80000000'); // 1,000,000 − 300,000 + 100,000 recovered
    expect(result.openingJournalId).toBeTruthy();
    for (const n of ['40000', '56000', '54000']) expect(await balance(n), n).toBe(0n);
    expect(await balance('30200')).toBe(-80_000_000n);
    // The control carried forward is back where it was after the close/open pair.
    expect(await balance('12420')).toBe(10_000_000n);
    expect(await balance('10100')).toBe(70_000_000n);
  });
});
