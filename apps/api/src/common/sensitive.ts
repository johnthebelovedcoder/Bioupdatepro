import { createHash } from 'node:crypto';

/**
 * Sensitive employee values are stored as plaintext for now. Screens continue
 * to mask them by default, and every authorized reveal is audited.
 */
export const SENSITIVE_EMPLOYEE_FIELDS = ['accountNumber', 'tin', 'nhfNumber', 'pensionRsaNumber', 'nin', 'nhiaNumber'] as const;
export type SensitiveEmployeeField = (typeof SENSITIVE_EMPLOYEE_FIELDS)[number];

/** Hashes support normalized duplicate checks; they are not encryption. */
export const FINGERPRINTED = { accountNumber: 'accountNumberHash', tin: 'tinHash', nin: 'ninHash' } as const;

export const IDENTITY_CHECKS = ['BANK', 'TAX_ID', 'NIN', 'PENSION', 'NHF', 'NHIA'] as const;
export const isIdentityCheck = (code: string) => (IDENTITY_CHECKS as readonly string[]).includes(code);

export function isLegacyEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('enc:v1:');
}

/** A deterministic fingerprint for normalized duplicate checks, not a security control. */
export function fingerprint(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, '').toUpperCase();
  return normalized ? createHash('sha256').update(normalized, 'utf8').digest('hex') : null;
}

/** What is shown by default: the last four characters. */
export function mask(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/g, '');
  if (!normalized) return null;
  return normalized.length <= 4 ? '••••' : `••••${normalized.slice(-4)}`;
}

/** Plain sensitive values and their duplicate-check fingerprints for storage. */
export function employeeSensitiveFields(values: Partial<Record<SensitiveEmployeeField, string | null>>): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const field of SENSITIVE_EMPLOYEE_FIELDS) {
    if (!(field in values)) continue;
    const value = values[field] ?? null;
    result[field] = value;
    if (field in FINGERPRINTED) {
      result[FINGERPRINTED[field as keyof typeof FINGERPRINTED]] = fingerprint(value);
    }
  }
  return result;
}
