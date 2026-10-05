import { describe, expect, it } from 'vitest';
import { receiptMethodOf } from '../../src/operations/trade.service';

describe('receiptMethodOf', () => {
  it('maps what the phone offers to a receipt method', () => {
    expect(receiptMethodOf('Cash')).toBe('CASH');
    expect(receiptMethodOf('Bank transfer')).toBe('BANK_TRANSFER');
    expect(receiptMethodOf('POS')).toBe('POS');
  });
  it('falls back to cash for anything else', () => {
    expect(receiptMethodOf(null)).toBe('CASH');
    expect(receiptMethodOf('Mobile money')).toBe('CASH');
  });
});
