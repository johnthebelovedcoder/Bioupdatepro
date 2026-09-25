import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { nextReference, type DocumentType } from '../../src/numbering/numbering';
import { kobo } from '../../src/common/money';
import { dims, resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/** Controlled references: TYPE-ENTITY-SITE-YYYY-SEQ, atomic, never reused (Numbering_Parameters). */

let prisma: PrismaService;
let posting: PostingService;
let fixture: TestFixture;

beforeAll(() => {
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  await prisma.company.update({ where: { id: fixture.companyId }, data: { referenceCode: 'AGR' } });
});

const next = (type: string, site = 'LAG', date = new Date('2026-03-01')) =>
  nextReference(prisma, { companyId: fixture.companyId, type: type as DocumentType, site, date });

describe('nextReference', () => {
  it('builds TYPE-ENTITY-SITE-YYYY-SEQ, counting per type, site and year', async () => {
    expect(await next('PO')).toBe('PO-AGR-LAG-2026-000001');
    expect(await next('PO')).toBe('PO-AGR-LAG-2026-000002');
    expect(await next('GRN')).toBe('GRN-AGR-LAG-2026-000001'); // its own sequence
    expect(await next('PO', 'OGN')).toBe('PO-AGR-OGN-2026-000001'); // another site
    expect(await next('PO', 'LAG', new Date('2027-01-02'))).toBe('PO-AGR-LAG-2027-000001'); // a new year
  });

  it('never hands the same number to two people at once', async () => {
    const numbers = await Promise.all(Array.from({ length: 20 }, () => prisma.$transaction((tx) => nextReference(tx, {
      companyId: fixture.companyId, type: 'SO', site: 'LAG', date: new Date('2026-03-01'),
    }))));
    expect(new Set(numbers).size).toBe(20);
    expect(numbers.map((n) => Number(n.slice(-6))).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('refuses a prefix that is not approved, and a sequence can never go back', async () => {
    await expect(next('XYZ')).rejects.toThrow(/not an approved document prefix/);
    await next('PO');
    await expect(
      prisma.documentSequence.updateMany({ where: { companyId: fixture.companyId, prefix: 'PO' }, data: { lastValue: 0 } }),
    ).rejects.toThrow(/never reused/);
  });
});

describe('Journal vouchers', () => {
  it('gives every posted journal a controlled voucher number, in date order of posting', async () => {
    const post = (n: string) =>
      posting.post({
        sourceModule: 'test', sourceDocumentType: 'Test', journalNumber: n, journalDate: new Date('2026-01-15'),
        narration: n, ...dims(fixture, 0), idempotencyKey: n, actor: { userId: fixture.makerId, roles: ['CFO'] },
        lines: [
          { glAccountId: fixture.accounts['1101']!, description: n, debit: kobo(100n), dimensions: dims(fixture, 0) },
          { glAccountId: fixture.accounts['4101']!, description: n, credit: kobo(100n), dimensions: dims(fixture, 0) },
        ],
      });
    const first = await post('TEST-1');
    const second = await post('TEST-2');
    const replay = await post('TEST-1'); // idempotent: no new number

    const branch = await prisma.branch.findUniqueOrThrow({ where: { id: fixture.branchId } });
    const site = branch.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const vouchers = await prisma.journalEntry.findMany({ where: { id: { in: [first.journalEntryId, second.journalEntryId] } }, orderBy: { createdAt: 'asc' } });
    expect(vouchers.map((v) => v.voucherNumber)).toEqual([`JV-AGR-${site}-2026-000001`, `JV-AGR-${site}-2026-000002`]);
    expect(replay.replayed).toBe(true);
    expect(await prisma.journalEntry.count({ where: { companyId: fixture.companyId } })).toBe(2);
  });
});
