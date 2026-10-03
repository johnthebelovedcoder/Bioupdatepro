import { describe, expect, it } from 'vitest';
import { allocateAcross, positiveTotal } from '../../src/biological-assets/rearing-cost.service';

describe('splitting a relief across the accounts holding rearing cost', () => {
  const held = new Map([
    ['16032', 3000n],
    ['16042', 7000n],
  ]);

  it('takes each account in proportion to what it holds', () => {
    expect(allocateAcross(1000n, held)).toEqual([['16032', 300n], ['16042', 700n]]);
  });

  it('adds up to exactly the amount and never takes more than an account holds', () => {
    for (let amount = 1n; amount <= 10_000n; amount += 37n) {
      const parts = allocateAcross(amount, held);
      expect(parts.reduce((sum, [, v]) => sum + v, 0n), String(amount)).toBe(amount);
      for (const [account, value] of parts) expect(value <= held.get(account)!, `${account} ${amount}`).toBe(true);
    }
  });

  it('empties every account when the last animals take all that is left', () => {
    expect(allocateAcross(10_000n, held)).toEqual([['16032', 3000n], ['16042', 7000n]]);
  });

  it('skips an account that holds nothing and is not fooled by a negative one', () => {
    expect(allocateAcross(500n, new Map([['16032', 0n], ['16042', 900n]]))).toEqual([['16042', 500n]]);
    expect(allocateAcross(500n, new Map([['16032', -50n], ['16042', 900n]]))).toEqual([['16042', 500n]]);
    expect(allocateAcross(0n, held)).toEqual([]);
  });

  it('shares an odd amount without losing a kobo', () => {
    const three = new Map([['a', 10n], ['b', 10n], ['c', 10n]]);
    const parts = allocateAcross(10n, three);
    expect(parts.reduce((sum, [, v]) => sum + v, 0n)).toBe(10n);
    expect(positiveTotal(three)).toBe(30n);
    // Asked for more than is held, it takes what is held and no more.
    expect(allocateAcross(100n, three).reduce((sum, [, v]) => sum + v, 0n)).toBe(30n);
  });
});
