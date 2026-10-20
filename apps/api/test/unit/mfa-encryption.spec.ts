import { afterEach, describe, expect, it, vi } from 'vitest';
import { MfaService } from '../../src/auth/mfa.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

describe('MFA secret encryption key', () => {
  const originalKey = process.env.MFA_ENCRYPTION_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalKey === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = originalKey;
  });

  it.each([
    ['a Render-generated secret', 'render-generated-secret-with-at-least-32-chars'],
    ['a legacy 32-byte hex key', '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'],
  ])('encrypts and decrypts with %s', async (_description, key) => {
    process.env.MFA_ENCRYPTION_KEY = key;
    let pendingSecret: string | null = null;
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn(async () => ({
          email: 'worker@example.com',
          mfaSecret: null,
          mfaPendingSecret: pendingSecret,
          mfaEnabledAt: null,
        })),
        update: vi.fn(async ({ data }: { data: { mfaPendingSecret: string } }) => {
          pendingSecret = data.mfaPendingSecret;
        }),
      },
    } as unknown as PrismaService;
    const service = new MfaService(prisma, {} as never);

    const first = await service.beginEnrollment('user-1');
    const second = await service.beginEnrollment('user-1');

    expect(pendingSecret).toMatch(/^v1:/);
    expect(second.secret).toBe(first.secret);
    expect(second.otpauthUri).toContain(first.secret);
  });

  it('rejects a missing or too-short key', async () => {
    delete process.env.MFA_ENCRYPTION_KEY;
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          email: 'worker@example.com',
          mfaSecret: null,
          mfaPendingSecret: null,
          mfaEnabledAt: null,
        }),
        update: vi.fn(),
      },
    } as unknown as PrismaService;
    const service = new MfaService(prisma, {} as never);

    await expect(service.beginEnrollment('user-1')).rejects.toThrow(/MFA_ENCRYPTION_KEY/);
    process.env.MFA_ENCRYPTION_KEY = 'too-short';
    await expect(service.beginEnrollment('user-1')).rejects.toThrow(/MFA_ENCRYPTION_KEY/);
  });
});
