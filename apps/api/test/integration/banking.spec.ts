import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { BankingService } from '../../src/banking/banking.service';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Bank reconciliation: statement lines matched to posted ledger lines, and
 * the identity statement closing = ledger − uncleared + not-in-ledger.
 */

let prisma: PrismaService;
let posting: PostingService;
let banking: BankingService;
let fixture: TestFixture;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const idempotency = new IdempotencyService(prisma);
  const periods = new PeriodService(prisma);
  const dimensions = new DimensionValidatorService(prisma);
  posting = new PostingService(prisma, audit, idempotency, periods, dimensions);
  banking = new BankingService(prisma, audit);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
});

let seq = 0;
/** Post a bank movement: positive is money in (Dr Bank / Cr Revenue), negative money out. */
async function bankMovement(amountKobo: bigint, on: string) {
  seq += 1;
  const bank = fixture.accounts['1101']!;
  const other = fixture.accounts['4101']!;
  const abs = amountKobo < 0n ? -amountKobo : amountKobo;
  const line = (glAccountId: string, side: 'debit' | 'credit') => ({
    glAccountId,
    description: `Movement ${seq}`,
    [side]: kobo(abs),
    dimensions: dims(fixture, 0),
  });
  return posting.post({
    sourceModule: 'test',
    sourceDocumentType: 'BankMovement',
    sourceDocumentId: `BM-${seq}`,
    journalNumber: `BM-${seq}`,
    journalDate: new Date(on),
    narration: `Bank movement ${seq}`,
    companyId: fixture.companyId,
    branchId: fixture.branchId,
    financialYearId: fixture.financialYearId,
    financialPeriodId: fixture.periodIds[0]!,
    currencyId: fixture.currencyId,
    exchangeRate: '1',
    idempotencyKey: `bm-${seq}-${Date.now()}`,
    actor: { userId: fixture.makerId, roles: ['FINANCE_MANAGER'] },
    lines: amountKobo > 0n ? [line(bank, 'debit'), line(other, 'credit')] : [line(other, 'debit'), line(bank, 'credit')],
  });
}

async function account() {
  const { id } = await banking.createAccount({
    companyId: fixture.companyId,
    actorId: fixture.makerId,
    glAccountId: fixture.accounts['1101']!,
    name: 'Operating',
    bankName: 'Test Bank',
    accountNumber: '0123456789',
  });
  return id;
}

const CSV = [
  'Date,Description,Reference,Debit,Credit',
  '10/01/2026,Egg sales,,,"50,000.00"',
  '12/01/2026,Feed supplier,CHQ1,"20,000.00",',
  '14/01/2026,Bank charge,,52.50,',
].join('\n');

describe('BankingService — reconciliation', () => {
  it('refuses a second bank account on the same ledger account', async () => {
    await account();
    await expect(account()).rejects.toThrow(/already the ledger account/);
  });

  it('refuses a statement whose lines do not add up to its closing balance', async () => {
    const id = await account();
    await expect(
      banking.importStatement({
        companyId: fixture.companyId, actorId: fixture.makerId, bankAccountId: id,
        csv: CSV, openingBalance: '0', closingBalance: '30,000.00',
      }),
    ).rejects.toThrow(/do not add up/);
  });

  it('auto-matches what is unambiguous and reconciles to the kobo once the charge is set aside', async () => {
    await bankMovement(5_000_000n, '2026-01-09'); // egg sales, a day before the bank
    await bankMovement(-2_000_000n, '2026-01-12'); // the feed cheque
    await bankMovement(-1_000_000n, '2026-01-20'); // written after the statement closed
    const id = await account();

    const imported = await banking.importStatement({
      companyId: fixture.companyId, actorId: fixture.makerId, bankAccountId: id,
      csv: CSV, openingBalance: '0.00', closingBalance: '29,947.50',
    });
    expect(imported).toMatchObject({ lines: 3, autoMatched: 2 });

    let rec = await banking.reconciliation(fixture.companyId, id);
    // Ledger as at 14 Jan: +50,000 −20,000 = 30,000. The bank charge is on the
    // statement but not in the ledger: 30,000 − 52.50 = 29,947.50. The later
    // payment is after the statement date, so it is not uncleared yet.
    expect(rec.ledgerBalanceKobo).toBe('3000000');
    expect(rec.notInLedgerKobo).toBe('-5250');
    expect(rec.unclearedKobo).toBe('0');
    expect(rec.differenceKobo).toBe('0');
    expect(rec.reconciled).toBe(true);

    const charge = rec.lines.find((l) => l.description === 'Bank charge')!;
    expect(charge.status).toBe('UNMATCHED');
    await banking.ignore({
      companyId: fixture.companyId, actorId: fixture.makerId, lineId: charge.id, reason: 'To journal',
    });
    rec = await banking.reconciliation(fixture.companyId, id);
    expect(rec.lines.find((l) => l.id === charge.id)?.status).toBe('IGNORED');
    expect(rec.reconciled).toBe(true);
  });

  it('leaves two identical payments for a person to tell apart', async () => {
    await bankMovement(-2_000_000n, '2026-01-11');
    await bankMovement(-2_000_000n, '2026-01-13');
    const id = await account();

    const imported = await banking.importStatement({
      companyId: fixture.companyId, actorId: fixture.makerId, bankAccountId: id,
      csv: 'Date,Description,Amount\n12/01/2026,Payment,-20000.00',
      openingBalance: '0', closingBalance: '-20000.00',
    });
    expect(imported.autoMatched).toBe(0);
  });

  it('refuses a manual match whose amounts differ, and one ledger line claimed twice', async () => {
    const posted = await bankMovement(-2_000_000n, '2026-01-12');
    const id = await account();
    await banking.importStatement({
      companyId: fixture.companyId, actorId: fixture.makerId, bankAccountId: id,
      csv: 'Date,Description,Amount\n12/01/2026,Payment,-20000.00\n25/01/2026,Short,-19999.00',
      openingBalance: '0', closingBalance: '-39999.00',
    });
    const rec = await banking.reconciliation(fixture.companyId, id);
    const short = rec.lines.find((l) => l.description === 'Short')!;
    const bankLine = await prisma.journalLine.findFirstOrThrow({
      where: { journalEntryId: posted.journalEntryId, glAccountId: fixture.accounts['1101']! },
    });

    await expect(
      banking.match({ companyId: fixture.companyId, actorId: fixture.makerId, lineId: short.id, journalLineId: bankLine.id }),
    ).rejects.toThrow(/Amounts differ/);
  });
});
