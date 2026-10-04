import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { assertBankGlAccount, bankGlAccounts } from '../../src/chart/bank-account';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Cash is paid from, and received into, bank accounts only. Found in the browser
 * walk-through: the payment and receipt forms offered every posting account
 * (revenue, receivables, headings) and the server accepted any of them, and on
 * the approved chart the bank (10100) is a control account the list left out.
 */
let prisma: PrismaService;
let fixture: TestFixture;

beforeAll(() => {
  prisma = new PrismaService();
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
});

describe('bank and cash accounts', () => {
  it('accepts the bank account and refuses revenue, receivables and the like', async () => {
    await expect(assertBankGlAccount(prisma, fixture.companyId, fixture.accounts['1101']!, 'A payment')).resolves.toBeUndefined();
    await expect(assertBankGlAccount(prisma, fixture.companyId, fixture.accounts['4101']!, 'A payment')).rejects.toThrow(/must go through a bank or cash account, not 4101/);
    const listed = (await bankGlAccounts(prisma, fixture.companyId)).map((a) => a.accountNumber);
    expect(listed).toContain('1101');
    expect(listed).not.toContain('4101');
  });

  it('offers the approved chart’s bank control account, which a list of posting accounts leaves out', async () => {
    await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'APPROVED' } });
    await new PostingControlProvisioningService(prisma, new AuditService(prisma)).provision(fixture.companyId, null);
    const bank = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: '10100' } });
    expect(bank.isPostingAccount).toBe(false);
    expect((await bankGlAccounts(prisma, fixture.companyId)).map((a) => a.accountNumber)).toContain('10100');
    await expect(assertBankGlAccount(prisma, fixture.companyId, bank.id, 'A receipt')).resolves.toBeUndefined();
    const heading = await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: '10000' } });
    await expect(assertBankGlAccount(prisma, fixture.companyId, heading.id, 'A receipt')).rejects.toThrow(/not 10000/);
  });
});
