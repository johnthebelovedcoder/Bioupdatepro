import { describe, expect, it } from 'vitest';
import { employeeSensitiveFields, fingerprint, isLegacyEncrypted, mask } from '../../src/common/sensitive';

describe('sensitive employee values', () => {
  it('stores the provided values as plaintext and creates normalized duplicate-check fingerprints without a key', () => {
    const stored = employeeSensitiveFields({ accountNumber: '0123 456 789', tin: 'tin-e1', nhfNumber: null });
    expect(stored).toMatchObject({
      accountNumber: '0123 456 789',
      accountNumberHash: fingerprint('0123456789'),
      tin: 'tin-e1',
      tinHash: fingerprint('TIN-E1'),
      nhfNumber: null,
    });
    expect(stored.accountNumber).toBe('0123 456 789');
  });

  it('fingerprints values consistently after removing spaces and case differences', () => {
    expect(fingerprint('0123 456 789')).toBe(fingerprint('0123456789'));
    expect(fingerprint('tin-e1')).toBe(fingerprint('TIN-E1'));
    expect(fingerprint('0123456789')).not.toBe(fingerprint('0123456780'));
    expect(fingerprint(null)).toBeNull();
  });

  it('masks displayed values and recognizes a legacy encrypted marker', () => {
    expect(mask('0123456789')).toBe('••••6789');
    expect(mask('123')).toBe('••••');
    expect(mask(null)).toBeNull();
    expect(isLegacyEncrypted('enc:v1:iv:tag:data')).toBe(true);
    expect(isLegacyEncrypted('0123456789')).toBe(false);
  });
});
