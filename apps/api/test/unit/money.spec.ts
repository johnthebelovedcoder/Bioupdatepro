import { describe, expect, it } from 'vitest';
import {
  addKobo,
  allocateKobo,
  formatKobo,
  fromMajorUnits,
  kobo,
  MoneyError,
  toMajorUnits,
} from '../../src/common/money';

/**
 * Rule 1 — money is an integer count of minor units, and fractional maths never
 * touches a native float.
 */
describe('Kobo', () => {
  it('refuses to build from a non-integer number', () => {
    // 45.5 kobo is not a thing. Forcing the caller to decide how to round is
    // the entire point.
    expect(() => kobo(45.5)).toThrow(MoneyError);
  });

  it('refuses values beyond the safe integer range', () => {
    expect(() => kobo(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });

  it('accepts bigints of any magnitude', () => {
    const large = kobo(9_007_199_254_740_993n);
    expect(large).toBe(9_007_199_254_740_993n);
  });

  it('adds without precision loss where floats would fail', () => {
    // 0.1 + 0.2 !== 0.3 in float. In kobo it is 10 + 20 === 30, exactly.
    const total = addKobo(kobo(10), kobo(20));
    expect(total).toBe(30n);
    expect(toMajorUnits(total).toString()).toBe('0.3');
  });
});

describe('fromMajorUnits', () => {
  it('converts naira to kobo', () => {
    expect(fromMajorUnits('4200')).toBe(420_000n);
    expect(fromMajorUnits('577.45')).toBe(57_745n);
  });

  it('rounds half up, once, at the boundary into storage', () => {
    expect(fromMajorUnits('0.005')).toBe(1n);
    expect(fromMajorUnits('0.004')).toBe(0n);
  });

  it('handles the workbook unit cost that has no exact kobo representation', () => {
    // SnailPro Costing_Summary L5 — ₦577.44554011653975 per unit.
    // Storing this as a unit cost is exactly what we do NOT do; we store the
    // total and derive. But when a unit price is genuinely persisted, it
    // rounds once, here.
    expect(fromMajorUnits('577.44554011653975')).toBe(57_745n);
  });

  it('does not accumulate float error across many conversions', () => {
    let total = 0n;
    for (let i = 0; i < 1000; i += 1) {
      total += fromMajorUnits('0.07');
    }
    expect(total).toBe(7_000n); // ₦70.00 exactly
  });
});

describe('formatKobo', () => {
  it('renders naira and kobo', () => {
    expect(formatKobo(kobo(257_656_20))).toBe('₦257656.20');
  });
});

/**
 * allocateKobo is the primitive behind joint-cost allocation (Phase 6),
 * overhead absorption and payroll proration. The invariant that matters is
 * that the parts always sum back to the whole — no kobo is lost or invented.
 */
describe('allocateKobo', () => {
  it('splits evenly when it can', () => {
    const parts = allocateKobo(kobo(300), [1, 1, 1]);
    expect(parts).toEqual([100n, 100n, 100n]);
  });

  it('distributes an indivisible remainder without losing a kobo', () => {
    // ₦1.00 across three ways cannot divide evenly.
    const parts = allocateKobo(kobo(100), [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(100n);
    expect(parts).toEqual([34n, 33n, 33n]);
  });

  it('allocates by weight', () => {
    const parts = allocateKobo(kobo(1000), [70, 20, 10]);
    expect(parts).toEqual([700n, 200n, 100n]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(1000n);
  });

  it('sums back to the total for awkward fractional weights', () => {
    // Poultry cut weights: the case Phase 6 will actually hit.
    const total = kobo(2_743_000_00);
    const parts = allocateKobo(total, ['1.5', '0.28', '0.19', '0.13', '0.05']);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
  });

  it('sums back to the total across a large randomised sweep', () => {
    for (let trial = 0; trial < 200; trial += 1) {
      const total = kobo(BigInt(1 + Math.floor(Math.random() * 10_000_000)));
      const weights = Array.from(
        { length: 2 + Math.floor(Math.random() * 8) },
        () => Math.random() * 100,
      );
      const parts = allocateKobo(total, weights);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
    }
  });

  it('handles negative totals symmetrically', () => {
    const parts = allocateKobo(kobo(-100), [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0n)).toBe(-100n);
  });

  it('rejects a zero weight basis rather than dividing by zero', () => {
    expect(() => allocateKobo(kobo(100), [0, 0])).toThrow(MoneyError);
  });

  it('rejects negative weights', () => {
    expect(() => allocateKobo(kobo(100), [1, -1])).toThrow(MoneyError);
  });

  it('rejects an empty basis', () => {
    expect(() => allocateKobo(kobo(100), [])).toThrow(MoneyError);
  });
});
