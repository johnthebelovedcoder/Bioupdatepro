import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';
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
  it('requires authenticator setup before a privileged account receives application access', async () => {
    expect(new MfaService(prisma, new AuditService(prisma)).requiredFor(['MD_CEO'])).toBe(true);
    expect(new MfaService(prisma, new AuditService(prisma)).requiredFor([
      'HR_MANAGER',
      'HR_OFFICER',
      'TREASURY_OFFICER',
      'FINANCIAL_ACCOUNTANT',
      'AP_OFFICER',
      'AR_OFFICER',
      'PROCUREMENT_OFFICER',
      'SALES_OFFICER',
    ])).toBe(true);

    await prisma.user.update({
      where: { id: fixture.makerId },
      data: { roles: ['FINANCE_MANAGER'] },
    });

    const result = await auth.login('worker@example.com', 'a-good-password-1');
    if (!('accessToken' in result)) throw new Error('Expected an MFA setup session.');
    expect(result.user.mfaRequired).toBe(true);
    expect(result.user.mfaSetupOnly).toBe(true);
    expect(jwt.decode<JwtPayload>(result.accessToken).mfaSetupOnly).toBe(true);
  });

  it('issues a fresh token that keeps the original sign-in time', async () => {
    const result = await auth.login('worker@example.com', 'a-good-password-1');
    if (!('accessToken' in result)) throw new Error('Expected a non-MFA session.');
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

  it('issues a short-lived MFA challenge to an enrolled finance account', async () => {
    await prisma.user.update({
      where: { id: fixture.makerId },
      data: {
        roles: ['FINANCE_MANAGER'],
        mfaSecret: 'v1:invalid-test-ciphertext',
        mfaEnabledAt: new Date(),
      },
    });

    const result = await auth.login('worker@example.com', 'a-good-password-1');
    if (!('challengeToken' in result)) throw new Error('Expected an MFA challenge.');
    expect(result.user.mfaRequired).toBe(true);
    expect(result.user.mfaEnabled).toBe(true);
    const challenge = jwt.decode<JwtPayload>(result.challengeToken);
    expect(challenge.purpose).toBe('MFA_LOGIN');
    expect(challenge.jti).toBeTruthy();
  });

  it('enrolls a finance account, verifies a one-time TOTP challenge, and preserves MFA on refresh', async () => {
    await prisma.user.update({
      where: { id: fixture.makerId },
      data: { roles: ['FINANCE_MANAGER'] },
    });

    const { secret } = await new MfaService(prisma, new AuditService(prisma)).beginEnrollment(fixture.makerId);
    const enrollmentCode = totp(secret, Math.floor(Date.now() / 30_000));
    const enrollment = await new MfaService(prisma, new AuditService(prisma)).confirmEnrollment(
      fixture.makerId,
      enrollmentCode,
    );
    expect(enrollment.recoveryCodes).toHaveLength(10);

    const challenge = await auth.login('worker@example.com', 'a-good-password-1');
    if (!('challengeToken' in challenge)) throw new Error('Expected an MFA challenge.');

    const verified = await auth.verifyMfaLogin(
      challenge.challengeToken,
      totp(secret, Math.floor(Date.now() / 30_000) + 1),
    );
    expect(jwt.decode<JwtPayload>(verified.accessToken).mfaVerified).toBe(true);

    await expect(
      auth.verifyMfaLogin(
        challenge.challengeToken,
        totp(secret, Math.floor(Date.now() / 30_000) + 1),
      ),
    ).rejects.toThrow(/already been used/);

    const renewed = await auth.refresh(verified.accessToken);
    expect(jwt.decode<JwtPayload>(renewed.accessToken).mfaVerified).toBe(true);
  });
});

function totp(secret: string, step: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let buffer = 0;
  const key: number[] = [];
  for (const character of secret) {
    buffer = (buffer << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      key.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const digest = createHmac('sha1', Buffer.from(key))
    .update(Buffer.from(BigInt(step).toString(16).padStart(16, '0'), 'hex'))
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}
