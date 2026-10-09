import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
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
  it('requires MFA for the MD/CEO high-value approval role', () => {
    expect(new MfaService(prisma, new AuditService(prisma)).requiredFor(['MD_CEO'])).toBe(true);
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

  it('requires enrollment and a one-time MFA challenge for a finance-role login', async () => {
    await prisma.user.update({
      where: { id: fixture.makerId },
      data: { roles: ['FINANCE_MANAGER'] },
    });

    const setup = await auth.login('worker@example.com', 'a-good-password-1');
    expect('mfaSetupRequired' in setup && setup.mfaSetupRequired).toBe(true);
    if (!('mfaSetupRequired' in setup)) throw new Error('Expected restricted MFA setup session.');

    const enrollment = await new MfaService(prisma, new AuditService(prisma)).beginEnrollment(fixture.makerId);
    const recoveryCodes = await new MfaService(prisma, new AuditService(prisma))
      .confirmEnrollment(fixture.makerId, codeAtStep(enrollment.secret, Math.floor(Date.now() / 30_000)));
    expect(recoveryCodes.recoveryCodes).toHaveLength(10);

    const challenge = await auth.login('worker@example.com', 'a-good-password-1');
    expect('mfaRequired' in challenge && challenge.mfaRequired).toBe(true);
    if (!('challengeToken' in challenge)) throw new Error('Expected MFA login challenge.');
    const verified = await auth.verifyMfaLogin(challenge.challengeToken, recoveryCodes.recoveryCodes[0]!);
    expect(jwt.decode<JwtPayload>(verified.accessToken).purpose).toBeUndefined();
    await expect(
      auth.verifyMfaLogin(challenge.challengeToken, codeAtStep(enrollment.secret, Math.floor(Date.now() / 30_000) + 1)),
    ).rejects.toThrow(/already been used/);

    const secondChallenge = await auth.login('worker@example.com', 'a-good-password-1');
    if (!('challengeToken' in secondChallenge)) throw new Error('Expected another MFA login challenge.');
    await expect(
      auth.verifyMfaLogin(secondChallenge.challengeToken, recoveryCodes.recoveryCodes[0]!),
    ).rejects.toThrow(/not valid/);
  });
});

function codeAtStep(secret: string, step: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}
