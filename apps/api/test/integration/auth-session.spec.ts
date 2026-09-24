import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuthService, MAX_SESSION_SECONDS, type JwtPayload } from '../../src/auth/auth.service';
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
  prisma = new PrismaService();
  jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '12h' } });
  auth = new AuthService(prisma, jwt);
});

beforeEach(async () => {
  await resetDatabase(prisma as unknown as PrismaClient);
  fixture = await seedFixture(prisma as unknown as PrismaClient);
  await prisma.user.update({
    where: { id: fixture.makerId },
    data: { email: 'worker@example.com', passwordHash: await hashPassword('a-good-password-1'), active: true },
  });
});

describe('Session renewal', () => {
  it('issues a fresh token that keeps the original sign-in time', async () => {
    const { accessToken } = await auth.login('worker@example.com', 'a-good-password-1');
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
    const { accessToken } = await auth.login('worker@example.com', 'a-good-password-1');
    await prisma.user.update({ where: { id: fixture.makerId }, data: { active: false } });
    await expect(auth.refresh(accessToken)).rejects.toThrow(/no longer valid/);
  });
});
