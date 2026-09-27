import { afterEach, describe, expect, it } from 'vitest';
import { fingerprint, isSealed, mask, open, seal, sealEmployeeFields } from '../../src/common/sensitive';

/** Sensitive numbers at rest: sealed with AES-256-GCM, fingerprinted for equality, masked for display. */
describe('sensitive numbers', () => {
  const original = process.env.PII_ENCRYPTION_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.PII_ENCRYPTION_KEY;
    else process.env.PII_ENCRYPTION_KEY = original;
  });

  it('seals a number so the stored value gives nothing away, and opens it again', () => {
    process.env.PII_ENCRYPTION_KEY = 'unit-test-key';
    const stored = seal('0123456789')!;
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain('0123456789');
    // A fresh IV each time: the same number never gives the same ciphertext.
    expect(seal('0123456789')).not.toBe(stored);
    expect(open(stored)).toBe('0123456789');
  });

  it('refuses a tampered value, or one sealed under a different key', () => {
    process.env.PII_ENCRYPTION_KEY = 'unit-test-key';
    const stored = seal('0123456789')!;
    const body = stored.split(':');
    const flipped = Buffer.from(body[4]!, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => open([...body.slice(0, 4), flipped.toString('base64')].join(':'))).toThrow();
    process.env.PII_ENCRYPTION_KEY = 'another-key';
    expect(() => open(stored)).toThrow();
  });

  it('fingerprints the same number the same way, ignoring spaces and case, and only with a key', () => {
    process.env.PII_ENCRYPTION_KEY = 'unit-test-key';
    expect(fingerprint('0123 456 789')).toBe(fingerprint('0123456789'));
    expect(fingerprint('tin-e1')).toBe(fingerprint('TIN-E1'));
    expect(fingerprint('0123456789')).not.toBe(fingerprint('0123456780'));
    delete process.env.PII_ENCRYPTION_KEY;
    expect(fingerprint('0123456789')).toBeNull();
  });

  it('keeps values as given with no key, reads them either way, and fails loudly on a sealed value it cannot open', () => {
    process.env.PII_ENCRYPTION_KEY = 'unit-test-key';
    const stored = seal('0123456789');
    delete process.env.PII_ENCRYPTION_KEY;
    expect(seal('0123456789')).toBe('0123456789');
    expect(open('0123456789')).toBe('0123456789');
    expect(() => open(stored)).toThrow(/PII_ENCRYPTION_KEY is not set/);
  });

  it('masks to the last four, and seals only the fields it is given', () => {
    expect(mask('0123456789')).toBe('••••6789');
    expect(mask('123')).toBe('••••');
    expect(mask(null)).toBeNull();
    process.env.PII_ENCRYPTION_KEY = 'unit-test-key';
    const out = sealEmployeeFields({ accountNumber: '0123456789', nhfNumber: null });
    expect(Object.keys(out).sort()).toEqual(['accountNumber', 'accountNumberHash', 'nhfNumber']);
    expect(out.nhfNumber).toBeNull();
    expect(open(out.accountNumber)).toBe('0123456789');
  });
});
