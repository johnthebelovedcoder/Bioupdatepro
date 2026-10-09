import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const MFA_ROLES = new Set([
  'ADMINISTRATOR',
  'CFO',
  'FINANCE_MANAGER',
  'FINANCE_CONTROLLER',
  'INTERNAL_AUDITOR',
  'MD_CEO',
  'FARM_ACCOUNTANT',
  'FARM_MANAGER',
  'PRODUCTION_SUPERVISOR',
  'SYSTEM_ADMIN',
]);
const PERIOD_SECONDS = 30;

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  requiredFor(roles: readonly string[]): boolean {
    return roles.some((role) => MFA_ROLES.has(role));
  }

  async beginEnrollment(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, mfaSecret: true, mfaPendingSecret: true, mfaEnabledAt: true },
    });
    if (user.mfaEnabledAt && user.mfaSecret) {
      throw new BadRequestException('Authenticator MFA is already enabled for this account.');
    }
    const secret = user.mfaPendingSecret ? decryptSecret(user.mfaPendingSecret) : base32Encode(randomBytes(20));
    if (!user.mfaPendingSecret) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { mfaPendingSecret: encryptSecret(secret) },
      });
    }
    const label = encodeURIComponent(`BioAssetPro:${user.email}`);
    const issuer = encodeURIComponent('BioAssetPro');
    const otpauthUri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=${PERIOD_SECONDS}`;
    return { secret, otpauthUri };
  }

  async confirmEnrollment(userId: string, suppliedCode: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, companyId: true, active: true, mfaPendingSecret: true, mfaEnabledAt: true },
    });
    if (!user.active) throw new UnauthorizedException('This account is deactivated.');
    if (user.mfaEnabledAt) throw new BadRequestException('Authenticator MFA is already enabled.');
    if (!user.mfaPendingSecret) throw new BadRequestException('Start authenticator setup before confirming it.');
    const secret = decryptSecret(user.mfaPendingSecret);
    const step = matchingTotpStep(secret, suppliedCode, Math.floor(Date.now() / 1000));
    if (step === null) throw new BadRequestException('That code is not valid. Check the authenticator clock and try again.');

    const recoveryCodes = Array.from({ length: 10 }, () => {
      const raw = randomBytes(8).toString('hex').toUpperCase();
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
    });
    await this.prisma.$transaction(async (tx) => {
      const enabled = await tx.user.updateMany({
        where: {
          id: userId,
          companyId: user.companyId,
          mfaEnabledAt: null,
          mfaPendingSecret: user.mfaPendingSecret,
        },
        data: {
          mfaSecret: encryptSecret(secret),
          mfaPendingSecret: null,
          mfaEnabledAt: new Date(),
          mfaLastUsedStep: BigInt(step),
        },
      });
      if (enabled.count !== 1) {
        throw new ConflictException('Authenticator setup changed. Start enrollment again.');
      }
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((code) => ({ userId, codeHash: recoveryCodeHash(code) })),
      });
      await this.audit.write({
        transactionId: userId,
        module: 'AUTH',
        entityType: 'UserMfa',
        entityId: userId,
        status: 'ENABLED',
        action: AuditAction.UPDATE,
        userId,
        comments: 'Authenticator-app MFA enabled; ten one-time recovery codes issued.',
      }, tx);
    });
    return { enabledAt: new Date().toISOString(), recoveryCodes };
  }

  async verifyLogin(userId: string, input: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        companyId: true,
        active: true,
        roles: true,
        mfaSecret: true,
        mfaEnabledAt: true,
        mfaLastUsedStep: true,
      },
    });
    if (!user.active || !user.mfaEnabledAt || !user.mfaSecret || !this.requiredFor(user.roles)) {
      throw new UnauthorizedException('This sign-in challenge is no longer valid. Sign in again.');
    }

    const normalised = input.trim().toUpperCase();
    if (/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/.test(normalised)) {
      const codeHash = recoveryCodeHash(normalised);
      const recovery = await this.prisma.mfaRecoveryCode.findFirst({
        where: { userId, codeHash, usedAt: null },
        select: { id: true },
      });
      if (!recovery) return false;
      const consumed = await this.prisma.mfaRecoveryCode.updateMany({
        where: { id: recovery.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) return false;
      await this.audit.write({
        transactionId: userId,
        module: 'AUTH',
        entityType: 'UserMfa',
        entityId: userId,
        status: 'RECOVERY_CODE_USED',
        action: AuditAction.UPDATE,
        userId,
        comments: 'A one-time MFA recovery code was used to sign in.',
      });
      return true;
    }

    const secret = decryptSecret(user.mfaSecret);
    const step = matchingTotpStep(secret, normalised, Math.floor(Date.now() / 1000));
    if (step === null || (user.mfaLastUsedStep !== null && BigInt(step) <= user.mfaLastUsedStep)) return false;
    const consumed = await this.prisma.user.updateMany({
      where: {
        id: userId,
        companyId: user.companyId,
        mfaEnabledAt: { not: null },
        mfaLastUsedStep: user.mfaLastUsedStep,
      },
      data: { mfaLastUsedStep: BigInt(step) },
    });
    return consumed.count === 1;
  }
}

function encryptionKey(): Buffer {
  const configured = process.env.MFA_ENCRYPTION_KEY?.trim();
  if (!configured || !/^[a-fA-F0-9]{64}$/.test(configured)) {
    throw new InternalServerErrorException(
      'MFA_ENCRYPTION_KEY must be a 32-byte hex key before authenticator MFA can be configured.',
    );
  }
  return Buffer.from(configured, 'hex');
}

function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decryptSecret(value: string): string {
  const [version, ivText, tagText, ciphertextText] = value.split(':');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) {
    throw new InternalServerErrorException('Stored MFA secret is not in a supported encrypted format.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new InternalServerErrorException('MFA_ENCRYPTION_KEY cannot decrypt this account’s authenticator secret.');
  }
}

function matchingTotpStep(secret: string, code: string, nowSeconds: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const currentStep = Math.floor(nowSeconds / PERIOD_SECONDS);
  for (const step of [currentStep - 1, currentStep, currentStep + 1]) {
    if (step < 0) continue;
    const expected = Buffer.from(totp(secret, step));
    const supplied = Buffer.from(code);
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return step;
  }
  return null;
}

function totp(secret: string, step: number): string {
  const digest = createHmac('sha1', base32Decode(secret))
    .update(Buffer.from(BigInt(step).toString(16).padStart(16, '0'), 'hex'))
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function base32Encode(value: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let buffer = 0;
  let output = '';
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(buffer << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new BadRequestException('Stored authenticator secret is invalid.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function recoveryCodeHash(code: string): string {
  return createHash('sha256').update(code.replace(/-/g, '').toUpperCase()).digest('hex');
}
