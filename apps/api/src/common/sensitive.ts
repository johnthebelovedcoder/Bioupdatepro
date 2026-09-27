import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Sensitive personal numbers at rest (handbook §security: bank account, TIN,
 * RSA PIN and NHF number are encrypted, hidden by default, and every view is
 * logged).
 *
 * AES-256-GCM with the key in PII_ENCRYPTION_KEY, kept in the host's settings
 * and never in the database, so a copy of the database alone does not give
 * the numbers away. A stored value reads `enc:v1:<iv>:<tag>:<ciphertext>`.
 *
 * With no key configured the value is kept as given, and `open` reads either
 * form, so a deployment can run before its key is set and records written
 * then are sealed when it is (EmployeeSealService). A sealed value with no key
 * to open it fails loudly rather than showing ciphertext as a bank number.
 *
 * Equality checks — "is this account already another employee's?" — cannot
 * compare ciphertexts, which differ every time. They compare a keyed
 * fingerprint (HMAC-SHA256) instead: the same number always gives the same
 * fingerprint, and the fingerprint is useless without the key.
 */

const PREFIX = 'enc:v1:';

/** The four employee numbers treated as sensitive. */
export const SENSITIVE_EMPLOYEE_FIELDS = ['accountNumber', 'tin', 'nhfNumber', 'pensionRsaNumber'] as const;
export type SensitiveEmployeeField = (typeof SENSITIVE_EMPLOYEE_FIELDS)[number];

/** Fields whose fingerprint is stored for the duplicate checks. */
export const FINGERPRINTED = { accountNumber: 'accountNumberHash', tin: 'tinHash' } as const;

function keys(): { enc: Buffer; mac: Buffer } | null {
  const raw = process.env.PII_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  // Any length of secret works; a 32-byte base64 value is what the docs suggest generating.
  const root = createHash('sha256').update(raw, 'utf8').digest();
  return {
    enc: createHash('sha256').update(Buffer.concat([root, Buffer.from('encrypt')])).digest(),
    mac: createHash('sha256').update(Buffer.concat([root, Buffer.from('fingerprint')])).digest(),
  };
}

export function encryptionConfigured(): boolean {
  return keys() !== null;
}

export function isSealed(stored: string | null | undefined): boolean {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

/** Encrypt a value for storage. Blank stays null; with no key, the value is kept as given. */
export function seal(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null;
  if (isSealed(plain)) return plain;
  const k = keys();
  if (!k) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k.enc, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${body.toString('base64')}`;
}

/** The stored value in the clear. A value written before encryption was set up is returned as it is. */
export function open(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null;
  if (!isSealed(stored)) return stored;
  const k = keys();
  if (!k) throw new Error('A sensitive value is encrypted but PII_ENCRYPTION_KEY is not set on this server.');
  const [iv, tag, body] = stored.slice(PREFIX.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', k.enc, Buffer.from(iv!, 'base64'));
  decipher.setAuthTag(Buffer.from(tag!, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body!, 'base64')), decipher.final()]).toString('utf8');
}

/** The keyed fingerprint of a number, for equality checks; null with no key or no value. */
export function fingerprint(plain: string | null | undefined): string | null {
  const value = plain?.replace(/\s+/g, '').toUpperCase();
  if (!value) return null;
  const k = keys();
  return k ? createHmac('sha256', k.mac).update(value, 'utf8').digest('hex') : null;
}

/** What is shown by default: the last four characters. */
export function mask(plain: string | null | undefined): string | null {
  const value = plain?.replace(/\s+/g, '');
  if (!value) return null;
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

/** The stored columns for a set of plain sensitive values: sealed, with their fingerprints. */
export function sealEmployeeFields(values: Partial<Record<SensitiveEmployeeField, string | null>>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of SENSITIVE_EMPLOYEE_FIELDS) {
    if (!(field in values)) continue;
    const plain = values[field] ?? null;
    out[field] = seal(plain);
    if (field in FINGERPRINTED) out[FINGERPRINTED[field as keyof typeof FINGERPRINTED]] = fingerprint(plain);
  }
  return out;
}
