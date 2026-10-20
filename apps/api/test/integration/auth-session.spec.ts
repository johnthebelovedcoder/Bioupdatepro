import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService, MAX_SESSION_SECONDS, type JwtPayload } from '../../src/auth/auth.service';
import { MfaService } from '../../src/auth/mfa.service';
import { AuditService } from '../../src/audit/audit.service';
import { hashPassword } from '../../src/auth/password';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Sessions renew while someone is working (the web middleware asks every
 * half hour) instead of ending twelve hours after sign-in, but never outlive
 * seven days from the password that started them.
 */

let prisma: PrismaService;
let jwt: JwtService;
let auth: AuthService;
let fixture: TestFixture;

const SECRET = 'a-test-secret-that-is-long-enough-for-the-check-0123456789';

beforeAll(() => {
  process.env.MFA_ENCRYPTION_KEY ??= '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
  prisma = new PrismaService();
  jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '12h' } });
  auth = new AuthService(prisma, jwt, new MfaService(prisma, new AuditService(prisma)));
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  await prisma.user.update({
    where: { id: fixture.makerId },
    data: {
      email: 'worker@example.com',
      passwordHash: await hashPassword('a-good-password-1'),
      active: true,
      roles: ['FARM_ATTENDANT'],
      mfaSecret: null,
      mfaPendingSecret: null,
      mfaEnabledAt: null,
      mfaLastUsedStep: null,
    },
  });
});

describe('Session renewal', () => {
  it('temporarily allows password-only sign-in for roles that normally require MFA', async () => {
    expect(new MfaService(prisma, new AuditService(prisma)).requiredFor(['MD_CEO'])).toBe(false);

    await prisma.user.update({
      where: { id: fixture.makerId },
      data: { roles: ['FINANCE_MANAGER'] },
    });

    const result = await auth.login('worker@example.com', 'a-good-password-1');
    if (!('accessToken' in result)) throw new Error('Expected password-only sign-in.');
    expect(result.user.mfaRequired).toBe(false);
    expect(jwt.decode<JwtPayload>(result.accessToken).mfaSetupOnly).toBeUndefined();
  });

  it('issues a fresh token that keeps the original sign-in time', async () => {
    const result = await auth.login('worker@example.com', 'a-good-password-1');
    if (!('accessToken' in result)) throw new Error('Expected password-only sign-in.');
    const { accessToken } = result;
    const first = jwt.decode<JwtPayload>(accessToken);
    expect(first.authAt).toBeTypeOf('number');

    const renewed = await auth.refresh(accessToken);
    const second = jwt.decode<JwtPayload>(renewed.accessToken);
    expect(second.sub).toBe(first.sub);
    expect(second.authAt).toBe(first.authAt);
  });

  it('refuses to renew past seven days from sign-in', async () => {
    const eightDaysAgo = Math.floor(Date.now() / 1000) - MAX_SESSION_SECONDS - 86_400;
    const old = await jwt.signAsync({ sub: fixture.makerId, email: 'worker@example.com', name: 'W', roles: [], authAt: eightDaysAgo });
    await expect(auth.refresh(old)).rejects.toThrow(/at most seven days/);
  });

  it('refuses to renew for a deactivated user', async () => {
    const result = await auth.login('worker@example.com', 'a-good-password-1');
    if (!('accessToken' in result)) throw new Error('Expected password-only sign-in.');
    const { accessToken } = result;
    await prisma.user.update({ where: { id: fixture.makerId }, data: { active: false } });
    await expect(auth.refresh(accessToken)).rejects.toThrow(/no longer valid/);
  });

  it('allows a finance-role account to sign in without MFA while enforcement is disabled', async () => {
    await prisma.user.update({
      where: { id: fixture.makerId },
      data: { roles: ['FINANCE_MANAGER'] },
    });

    const result = await auth.login('worker@example.com', 'a-good-password-1');
    if (!('accessToken' in result)) throw new Error('Expected password-only sign-in.');
    expect(result.user.mfaRequired).toBe(false);
    expect(result.user.mfaEnabled).toBe(false);
  });
});
