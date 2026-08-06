import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { kobo } from '../../src/common/money';
import {
  dims,
  resetDatabase,
  seedFixture,
  TestFixture,
} from '../helpers/test-db';

let prisma: PrismaService;
let posting: PostingService;
let trialBalance: TrialBalanceService;
let audit: AuditService;
let fixture: TestFixture;

beforeAll(() => {
  prisma = new PrismaService();
  audit = new AuditService(prisma);
  const idempotency = new IdempotencyService(prisma);
  const periods = new PeriodService(prisma);
  const dimensions = new DimensionValidatorService(prisma);
  posting = new PostingService(prisma, audit, idempotency, periods, dimensions);
  trialBalance = new TrialBalanceService(prisma);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
});

/** A well-formed material issue: Dr WIP / Cr Raw Material Inventory. */
function materialIssue(f: TestFixture, amount: bigint, key = 'mi-1') {
  return {
    sourceModule: 'processing',
    sourceDocumentType: 'MaterialIssue',
    sourceDocumentId: 'MI-SN-001',
    journalNumber: `JRN-${key}`,
    journalDate: new Date('2026-01-15'),
    narration: 'Materials issued from inventory to production',
    companyId: f.companyId,
    branchId: f.branchId,
    financialYearId: f.financialYearId,
    financialPeriodId: f.periodIds[0] as string,
    currencyId: f.currencyId,
    exchangeRate: '1.00000000',
    idempotencyKey: key,
    actor: { userId: f.makerId, roles: ['PRODUCTION_SUPERVISOR'] },
    lines: [
      {
        glAccountId: f.accounts['1501'] as string,
        description: 'WIP',
        debit: kobo(amount),
        dimensions: dims(f, 0, {
          costCentreId: f.costCentreId,
          farmId: f.farmId,
        }),
      },
      {
        glAccountId: f.accounts['1301'] as string,
        description: 'Raw material',
        credit: kobo(amount),
        dimensions: dims(f, 0, { farmId: f.farmId }),
      },
    ],
  };
}

describe('PostingService — the balance invariant', () => {
  it('posts a balanced journal and returns both totals', async () => {
    const result = await posting.post(materialIssue(fixture, 195_500_00n));

    expect(result.replayed).toBe(false);
    expect(result.totalDebitKobo).toBe(195_500_00n);
    expect(result.totalCreditKobo).toBe(195_500_00n);

    const stored = await prisma.journalEntry.findUnique({
      where: { id: result.journalEntryId },
      include: { lines: true },
    });
    expect(stored?.status).toBe('POSTED');
    expect(stored?.lines).toHaveLength(2);
  });

  it('rejects an unbalanced journal', async () => {
    const request = materialIssue(fixture, 195_500_00n);
    request.lines[1]!.credit = kobo(195_499_00n); // one naira short

    await expect(posting.post(request)).rejects.toThrow(/does not balance/i);
    expect(await prisma.journalEntry.count()).toBe(0);
  });

  it('rejects a journal with a single line', async () => {
    const request = materialIssue(fixture, 100_00n);
    request.lines = [request.lines[0]!];
    await expect(posting.post(request)).rejects.toThrow(/at least two lines/i);
  });

  it('rejects a line carrying both a debit and a credit', async () => {
    const request = materialIssue(fixture, 100_00n);
    request.lines[0]!.credit = kobo(50_00n);
    await expect(posting.post(request)).rejects.toThrow(
      /both a debit and a credit/i,
    );
  });

  it('rejects negative amounts rather than silently flipping the side', async () => {
    const request = materialIssue(fixture, 100_00n);
    request.lines[0]!.debit = kobo(-100_00n);
    await expect(posting.post(request)).rejects.toThrow(/negative amount/i);
  });

  it('keeps the trial balance balanced after every posting', async () => {
    await posting.post(materialIssue(fixture, 195_500_00n, 'a'));
    await posting.post(materialIssue(fixture, 119_700_00n, 'b'));
    await posting.post(materialIssue(fixture, 1_289_760_00n, 'c'));

    const tb = await trialBalance.build({ companyId: fixture.companyId });
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitKobo).toBe(tb.totalCreditKobo);
    expect(tb.totalDebitKobo).toBe(1_604_960_00n);
  });
});

describe('PostingService — Enterprise Dimensions (§1.1)', () => {
  it('rejects a posting missing a mandatory dimension', async () => {
    const request = materialIssue(fixture, 100_00n);
    // Branch is one of the mandatory six.
    (request.lines[0]!.dimensions as Record<string, unknown>).branchId = '';
    await expect(posting.post(request)).rejects.toThrow(/Branch/);
  });

  it('rejects a posting missing a cost centre the account requires', async () => {
    const request = materialIssue(fixture, 100_00n);
    // 1501 Work in Progress is configured requiresCostCentre.
    delete (request.lines[0]!.dimensions as Record<string, unknown>).costCentreId;
    await expect(posting.post(request)).rejects.toThrow(/Cost Centre/);
  });

  it('accepts a missing cost centre on an account that does not require one', async () => {
    const request = materialIssue(fixture, 100_00n);
    // Line 2 is 1301 Raw Material, which does not require a cost centre.
    expect(
      (request.lines[1]!.dimensions as Record<string, unknown>).costCentreId,
    ).toBeUndefined();
    await expect(posting.post(request)).resolves.toBeDefined();
  });

  it('rejects a line that contradicts the header on a mandatory dimension', async () => {
    const request = materialIssue(fixture, 100_00n);
    (request.lines[0]!.dimensions as Record<string, unknown>).financialPeriodId =
      fixture.periodIds[5];
    await expect(posting.post(request)).rejects.toThrow(
      /contradicts the journal header/i,
    );
  });

  it("rejects another company's cost centre", async () => {
    const otherCurrency = await prisma.currency.create({
      data: { code: 'USD', name: 'US Dollar' },
    });
    const otherCompany = await prisma.company.create({
      data: { code: 'OTHER', name: 'Other Ltd', baseCurrencyId: otherCurrency.id },
    });
    const otherBranch = await prisma.branch.create({
      data: { companyId: otherCompany.id, code: 'B', name: 'B' },
    });
    const foreignCostCentre = await prisma.costCentre.create({
      data: {
        companyId: otherCompany.id,
        code: 'X',
        name: 'X',
        branchId: otherBranch.id,
        effectiveDate: new Date('2026-01-01'),
      },
    });

    const request = materialIssue(fixture, 100_00n);
    (request.lines[0]!.dimensions as Record<string, unknown>).costCentreId =
      foreignCostCentre.id;

    await expect(posting.post(request)).rejects.toThrow(
      /belongs to another company/i,
    );
  });

  it('rejects an inactive cost centre', async () => {
    await prisma.costCentre.update({
      where: { id: fixture.costCentreId },
      data: { active: false },
    });
    await expect(posting.post(materialIssue(fixture, 100_00n))).rejects.toThrow(
      /inactive/i,
    );
  });

  it('rejects posting to a summary account', async () => {
    const request = materialIssue(fixture, 100_00n);
    request.lines[1]!.glAccountId = fixture.accounts['1000'] as string;
    await expect(posting.post(request)).rejects.toThrow(/summary account/i);
  });

  it('rejects posting to an inactive account', async () => {
    const request = materialIssue(fixture, 100_00n);
    request.lines[1]!.glAccountId = fixture.accounts['9999'] as string;
    await expect(posting.post(request)).rejects.toThrow(/inactive/i);
  });
});

describe('PostingService — period status gate (§8)', () => {
  it('accepts a posting into an open period', async () => {
    await expect(posting.post(materialIssue(fixture, 100_00n))).resolves.toBeDefined();
  });

  it('rejects a posting into a closed period', async () => {
    await prisma.financialPeriod.update({
      where: { id: fixture.periodIds[0] },
      data: { status: 'CLOSED' },
    });
    await expect(posting.post(materialIssue(fixture, 100_00n))).rejects.toThrow(
      /CLOSED/,
    );
  });

  it('rejects an ordinary user from a soft-closed period', async () => {
    await prisma.financialPeriod.update({
      where: { id: fixture.periodIds[0] },
      data: { status: 'SOFT_CLOSED' },
    });
    await expect(posting.post(materialIssue(fixture, 100_00n))).rejects.toThrow(
      /SOFT_CLOSED/,
    );
  });

  it('accepts a Finance Manager into a soft-closed period', async () => {
    await prisma.financialPeriod.update({
      where: { id: fixture.periodIds[0] },
      data: { status: 'SOFT_CLOSED' },
    });
    const request = materialIssue(fixture, 100_00n);
    request.actor = { userId: fixture.financeUserId, roles: ['FINANCE_MANAGER'] };
    await expect(posting.post(request)).resolves.toBeDefined();
  });

  it('rejects everyone when the financial year itself is closed', async () => {
    await prisma.financialYear.update({
      where: { id: fixture.financialYearId },
      data: { status: 'CLOSED' },
    });
    const request = materialIssue(fixture, 100_00n);
    request.actor = { userId: fixture.financeUserId, roles: ['FINANCE_MANAGER'] };
    await expect(posting.post(request)).rejects.toThrow(/financial year/i);
  });
});

describe('PostingService — idempotency (Rule 6)', () => {
  it('returns the original result on replay instead of posting twice', async () => {
    const request = materialIssue(fixture, 195_500_00n, 'retry-me');

    const first = await posting.post(request);
    const second = await posting.post(materialIssue(fixture, 195_500_00n, 'retry-me'));

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.journalEntryId).toBe(first.journalEntryId);

    expect(await prisma.journalEntry.count()).toBe(1);
    expect(await prisma.journalLine.count()).toBe(2);

    const tb = await trialBalance.build({ companyId: fixture.companyId });
    expect(tb.totalDebitKobo).toBe(195_500_00n);
  });

  it('rejects the same key reused with a different amount', async () => {
    await posting.post(materialIssue(fixture, 195_500_00n, 'same-key'));
    await expect(
      posting.post(materialIssue(fixture, 999_999_00n, 'same-key')),
    ).rejects.toThrow(/different request body/i);
  });

  it('requires an idempotency key', async () => {
    const request = materialIssue(fixture, 100_00n);
    request.idempotencyKey = '';
    await expect(posting.post(request)).rejects.toThrow(/idempotency key/i);
  });
});

describe('PostingService — immutability (Rule 2)', () => {
  it('refuses to update a posted journal, at the database', async () => {
    const result = await posting.post(materialIssue(fixture, 100_00n));

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE journal_entries SET narration = 'tampered' WHERE id = $1::uuid`,
        result.journalEntryId,
      ),
    ).rejects.toThrow(/posted and cannot be modified/i);
  });

  it('refuses to delete a posted journal, at the database', async () => {
    const result = await posting.post(materialIssue(fixture, 100_00n));

    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM journal_entries WHERE id = $1::uuid`,
        result.journalEntryId,
      ),
    ).rejects.toThrow(/posted and cannot be deleted/i);
  });

  it('refuses to alter a line of a posted journal, at the database', async () => {
    const result = await posting.post(materialIssue(fixture, 100_00n));

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE journal_lines SET debit_kobo = 1 WHERE journal_entry_id = $1::uuid`,
        result.journalEntryId,
      ),
    ).rejects.toThrow(/posted; its lines cannot be modified/i);
  });

  it('refuses a raw journal line carrying both sides (CHECK constraint)', async () => {
    const result = await posting.post(materialIssue(fixture, 100_00n));
    const entry = await prisma.journalEntry.findUnique({
      where: { id: result.journalEntryId },
    });

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO journal_lines
           (id, journal_entry_id, line_number, gl_account_id, description,
            debit_kobo, credit_kobo, company_id, branch_id, financial_year_id,
            financial_period_id, currency_id, exchange_rate, created_at)
         VALUES (gen_random_uuid(), $1::uuid, 99, $2::uuid, 'bad', 500, 500,
                 $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, 1, now())`,
        entry!.id,
        fixture.accounts['1301'],
        fixture.companyId,
        fixture.branchId,
        fixture.financialYearId,
        fixture.periodIds[0],
        fixture.currencyId,
      ),
    ).rejects.toThrow(/single_side/i);
  });

  it('never permits an audit record to be updated or deleted', async () => {
    const result = await posting.post(materialIssue(fixture, 100_00n));
    const records = await audit.findForTransaction(result.journalEntryId);
    expect(records.length).toBeGreaterThan(0);

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE audit_records SET comments = 'tampered' WHERE id = $1::uuid`,
        records[0]!.id,
      ),
    ).rejects.toThrow(/append-only/i);

    await expect(
      prisma.$executeRawUnsafe(
        `DELETE FROM audit_records WHERE id = $1::uuid`,
        records[0]!.id,
      ),
    ).rejects.toThrow(/append-only/i);
  });
});

describe('PostingService — reversal is the only correction path', () => {
  it('reverses a posted journal with a mirror-image document', async () => {
    const original = await posting.post(materialIssue(fixture, 195_500_00n));

    const reversal = await posting.reverse(original.journalEntryId, {
      journalNumber: 'JRN-REV-1',
      journalDate: new Date('2026-01-20'),
      narration: 'Reverse erroneous material issue',
      financialYearId: fixture.financialYearId,
      financialPeriodId: fixture.periodIds[0] as string,
      idempotencyKey: 'rev-1',
      actor: { userId: fixture.financeUserId, roles: ['FINANCE_MANAGER'] },
    });

    // The original is untouched and still posted.
    const stored = await prisma.journalEntry.findUnique({
      where: { id: original.journalEntryId },
    });
    expect(stored?.status).toBe('POSTED');
    expect(stored?.narration).toBe(
      'Materials issued from inventory to production',
    );

    // The reversal points back at it.
    const reversalEntry = await prisma.journalEntry.findUnique({
      where: { id: reversal.journalEntryId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    expect(reversalEntry?.reversalOfId).toBe(original.journalEntryId);

    // Sides are flipped; dimensions carried over.
    expect(reversalEntry?.lines[0]?.creditKobo).toBe(195_500_00n);
    expect(reversalEntry?.lines[0]?.debitKobo).toBe(0n);
    expect(reversalEntry?.lines[0]?.costCentreId).toBe(fixture.costCentreId);

    // Net effect on the ledger is nil.
    const tb = await trialBalance.build({ companyId: fixture.companyId });
    expect(tb.balanced).toBe(true);
    const wip = tb.rows.find((r) => r.accountNumber === '1501');
    expect(wip?.netKobo).toBe(0n);
  });

  it('refuses to reverse the same journal twice', async () => {
    const original = await posting.post(materialIssue(fixture, 100_00n));
    const params = {
      journalNumber: 'JRN-REV-A',
      journalDate: new Date('2026-01-20'),
      narration: 'Reverse',
      financialYearId: fixture.financialYearId,
      financialPeriodId: fixture.periodIds[0] as string,
      idempotencyKey: 'rev-a',
      actor: { userId: fixture.financeUserId, roles: ['FINANCE_MANAGER'] },
    };
    await posting.reverse(original.journalEntryId, params);

    await expect(
      posting.reverse(original.journalEntryId, {
        ...params,
        journalNumber: 'JRN-REV-B',
        idempotencyKey: 'rev-b',
      }),
    ).rejects.toThrow(/already reversed/i);
  });
});

describe('AuditService — Rule 9', () => {
  it('writes an audit record in the same transaction as the posting', async () => {
    const result = await posting.post(materialIssue(fixture, 195_500_00n));
    const records = await audit.findForTransaction(result.journalEntryId);

    expect(records).toHaveLength(1);
    expect(records[0]?.action).toBe('POST');
    expect(records[0]?.module).toBe('processing');
    expect(records[0]?.entityType).toBe('JournalEntry');
    expect(records[0]?.userId).toBe(fixture.makerId);
    expect(records[0]?.status).toBe('POSTED');
  });

  it('writes no audit record when the posting is rejected', async () => {
    const request = materialIssue(fixture, 100_00n);
    request.lines[1]!.credit = kobo(99_00n);

    await expect(posting.post(request)).rejects.toThrow();
    expect(await prisma.auditRecord.count()).toBe(0);
    expect(await prisma.journalEntry.count()).toBe(0);
  });

  it('records a reversal as REVERSE, not POST', async () => {
    const original = await posting.post(materialIssue(fixture, 100_00n));
    const reversal = await posting.reverse(original.journalEntryId, {
      journalNumber: 'JRN-REV-1',
      journalDate: new Date('2026-01-20'),
      narration: 'Reverse',
      financialYearId: fixture.financialYearId,
      financialPeriodId: fixture.periodIds[0] as string,
      idempotencyKey: 'rev-1',
      actor: { userId: fixture.financeUserId, roles: ['FINANCE_MANAGER'] },
    });

    const records = await audit.findForTransaction(reversal.journalEntryId);
    expect(records[0]?.action).toBe('REVERSE');
  });
});

describe('TrialBalanceService — dimensional filtering', () => {
  it('filters by cost centre without joining the journal header', async () => {
    await posting.post(materialIssue(fixture, 195_500_00n, 'cc-1'));

    const filtered = await trialBalance.build({
      companyId: fixture.companyId,
      costCentreId: fixture.costCentreId,
    });

    // Only the WIP line carries the cost centre.
    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0]?.accountNumber).toBe('1501');
    expect(filtered.rows[0]?.totalDebitKobo).toBe(195_500_00n);
  });

  it('signs the displayed balance by the account normal balance', async () => {
    await posting.post(materialIssue(fixture, 195_500_00n));
    const tb = await trialBalance.build({ companyId: fixture.companyId });

    const wip = tb.rows.find((r) => r.accountNumber === '1501');
    const raw = tb.rows.find((r) => r.accountNumber === '1301');

    // WIP is a debit-normal account with a debit balance: positive.
    expect(wip?.displayedBalanceKobo).toBe(195_500_00n);
    // Raw material was credited, so it reads negative against its normal side.
    expect(raw?.displayedBalanceKobo).toBe(-195_500_00n);
  });

  it('excludes draft journals from the trial balance', async () => {
    await prisma.journalEntry.create({
      data: {
        companyId: fixture.companyId,
        journalNumber: 'DRAFT-1',
        journalDate: new Date('2026-01-15'),
        narration: 'Not yet posted',
        status: 'DRAFT',
        sourceModule: 'manual',
        sourceDocumentType: 'Journal',
        branchId: fixture.branchId,
        financialYearId: fixture.financialYearId,
        financialPeriodId: fixture.periodIds[0] as string,
        currencyId: fixture.currencyId,
        exchangeRate: '1',
        createdById: fixture.makerId,
        lines: {
          create: [
            {
              lineNumber: 1,
              glAccountId: fixture.accounts['1101'] as string,
              description: 'draft',
              debitKobo: 500_00n,
              companyId: fixture.companyId,
              branchId: fixture.branchId,
              financialYearId: fixture.financialYearId,
              financialPeriodId: fixture.periodIds[0] as string,
              currencyId: fixture.currencyId,
              exchangeRate: '1',
            },
            {
              lineNumber: 2,
              glAccountId: fixture.accounts['1301'] as string,
              description: 'draft',
              creditKobo: 500_00n,
              companyId: fixture.companyId,
              branchId: fixture.branchId,
              financialYearId: fixture.financialYearId,
              financialPeriodId: fixture.periodIds[0] as string,
              currencyId: fixture.currencyId,
              exchangeRate: '1',
            },
          ],
        },
      },
    });

    const tb = await trialBalance.build({ companyId: fixture.companyId });
    expect(tb.rows).toHaveLength(0);
  });
});
