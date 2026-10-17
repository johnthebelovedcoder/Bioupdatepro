import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuthService } from '../../src/auth/auth.service';
import { MfaService } from '../../src/auth/mfa.service';
import { ProvisioningService } from '../../src/auth/provisioning.service';
import { RegistrationService } from '../../src/auth/registration.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { resetDatabase } from '../helpers/test-db';

/**
 * What a farm's books look like when somebody signs up — through registration,
 * not through the provisioning service on its own.
 *
 * That distinction is the whole reason this file exists. Provisioning gives a
 * new farm the client's 137-account chart, and a test that called it directly
 * said so and passed. Registration then calls posting-control provisioning,
 * which loads the old key table and the 75 six-digit accounts those keys point
 * at — so the farm a person actually registered had 212 accounts, and 75 of
 * the 145 its manual-journal picker offered belonged to a superseded chart.
 *
 * Everything here is asserted on the state registration leaves behind.
 */

let prisma: PrismaService;
let registration: RegistrationService;

const SECRET = 'a-test-secret-that-is-long-enough-for-the-check-0123456789';

beforeAll(() => {
  process.env.MFA_ENCRYPTION_KEY ??= '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  prisma = new PrismaService();
  const audit = new AuditService(prisma);
  const auth = new AuthService(
    prisma,
    new JwtService({ secret: SECRET, signOptions: { expiresIn: '12h' } }),
    new MfaService(prisma, audit),
  );
  registration = new RegistrationService(
    prisma,
    new ProvisioningService(),
    auth,
    new PostingControlProvisioningService(prisma, audit),
  );
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
});

async function registerFarm() {
  await registration.register({
    fullName: 'Adaeze Okonkwo',
    email: 'owner@cleanstart.test',
    password: 'Umuahia-Harmattan-Ledger-7',
    farmName: 'Clean Start Farms',
  });
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: 'owner@cleanstart.test' },
    select: { companyId: true },
  });
  // Registration always provisions a company; the column is nullable only for
  // users who have not been given one.
  if (!user.companyId) throw new Error('Registration left the owner with no company.');
  return user.companyId;
}

describe('The chart a registered farm actually gets', () => {
  it('offers nothing but the client’s own accounts to post to', async () => {
    const companyId = await registerFarm();

    const postable = await prisma.gLAccount.findMany({
      where: { companyId, active: true, isPostingAccount: true },
      select: { accountNumber: true },
    });
    expect(postable.length).toBeGreaterThan(0);
    const notFiveDigit = postable.filter((account) => !/^\d{5}$/.test(account.accountNumber));
    expect(notFiveDigit.map((account) => account.accountNumber)).toEqual([]);

    // The same question the manual-journal picker asks.
    const journalable = await prisma.gLAccount.findMany({
      where: { companyId, active: true, manualJournalAllowed: true },
      select: { accountNumber: true },
    });
    expect(journalable.every((account) => /^\d{5}$/.test(account.accountNumber))).toBe(true);
  });

  it('keeps the superseded accounts only as inert links for the old key table', async () => {
    const companyId = await registerFarm();

    const all = await prisma.gLAccount.findMany({
      where: { companyId },
      select: { accountNumber: true, active: true, isPostingAccount: true, manualJournalAllowed: true },
    });
    const superseded = all.filter((account) => /^\d{6}$/.test(account.accountNumber));
    expect(superseded.length).toBeGreaterThan(0);
    for (const account of superseded) {
      expect(account.active).toBe(false);
      expect(account.isPostingAccount).toBe(false);
      expect(account.manualJournalAllowed).toBe(false);
    }

    // Inert, but still linked: a posting key with nothing to point at cannot
    // be loaded, and the old key table is what these accounts are here for.
    const linked = await prisma.postingKey.count({ where: { companyId, glAccountId: { not: null } } });
    expect(linked).toBeGreaterThan(0);
  });

  it('is on the approved chart, with the workbook’s accounts and cost centres', async () => {
    const companyId = await registerFarm();

    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    expect(company.chartVersion).toBe('APPROVED');

    const approved = await prisma.gLAccount.count({
      where: { companyId, active: true, accountNumber: { startsWith: '1' } },
    });
    expect(approved).toBeGreaterThan(0);
    expect(await prisma.costCentre.count({ where: { companyId, postingAllowed: true, active: true } })).toBeGreaterThan(0);
  });
});
