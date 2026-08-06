import Decimal from 'decimal.js';

/**
 * MONEY. Rule 1.
 *
 * Every monetary value in BioAssetPro is an integer count of minor currency
 * units — kobo for NGN. Never a float, never an unconstrained decimal.
 *
 * `Kobo` is a branded bigint: structurally it is a bigint, but TypeScript will
 * not let a raw bigint or number be passed where a Kobo is expected without
 * going through one of the constructors below. That makes "I accidentally
 * passed naira" a compile error rather than a 100x accounting mistake.
 */
export type Kobo = bigint & { readonly __brand: 'Kobo' };

export const ZERO_KOBO = 0n as Kobo;

/** Wrap a value already known to be in minor units. */
export function kobo(value: bigint | number): Kobo {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new MoneyError(
        `Refusing to build Kobo from the non-integer ${value}. ` +
          `Convert with fromMajorUnits() and an explicit rounding decision.`,
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new MoneyError(
        `${value} exceeds the safe integer range; pass a bigint instead.`,
      );
    }
    return BigInt(value) as Kobo;
  }
  return value as Kobo;
}

export function addKobo(...values: Kobo[]): Kobo {
  return values.reduce((sum: bigint, v) => sum + v, 0n) as Kobo;
}

export function subKobo(a: Kobo, b: Kobo): Kobo {
  return (a - b) as Kobo;
}

export function negateKobo(a: Kobo): Kobo {
  return -a as Kobo;
}

export function isZero(a: Kobo): boolean {
  return a === 0n;
}

export class MoneyError extends Error {}

/**
 * Convert a major-unit amount (naira) to minor units (kobo).
 *
 * Fractional math runs through decimal.js, never native floats — `0.1 + 0.2`
 * problems do not get to touch money. Rounding happens exactly once, here, at
 * the boundary into storage (Rule 1: "round only at the point of persistence,
 * never mid-calculation").
 */
export function fromMajorUnits(
  amount: Decimal.Value,
  minorUnitScale = 2,
  rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP,
): Kobo {
  const scaled = new Decimal(amount).mul(new Decimal(10).pow(minorUnitScale));
  return BigInt(scaled.toDecimalPlaces(0, rounding).toFixed(0)) as Kobo;
}

/** For display and reporting only. Never feed this back into a posting. */
export function toMajorUnits(amount: Kobo, minorUnitScale = 2): Decimal {
  return new Decimal(amount.toString()).div(new Decimal(10).pow(minorUnitScale));
}

export function formatKobo(
  amount: Kobo,
  minorUnitScale = 2,
  symbol = '₦',
): string {
  const major = toMajorUnits(amount, minorUnitScale);
  return `${symbol}${major.toFixed(minorUnitScale)}`;
}

/**
 * Split a total across weights so that the parts sum back to the total exactly.
 *
 * This is the primitive behind every allocation in the system — joint-cost
 * allocation (Phase 6), overhead absorption, and payroll proration. The naive
 * approach (round each share independently) loses or invents kobo; the largest-
 * remainder method here distributes the rounding residual deterministically so
 * that `sum(result) === total`, always.
 *
 * Returns one Kobo per weight, in the same order.
 */
export function allocateKobo(total: Kobo, weights: Decimal.Value[]): Kobo[] {
  if (weights.length === 0) {
    throw new MoneyError('Cannot allocate across an empty set of weights.');
  }

  const decimalWeights = weights.map((w) => new Decimal(w));
  if (decimalWeights.some((w) => w.isNegative())) {
    throw new MoneyError('Allocation weights cannot be negative.');
  }

  const weightTotal = decimalWeights.reduce(
    (sum, w) => sum.plus(w),
    new Decimal(0),
  );

  if (weightTotal.isZero()) {
    throw new MoneyError(
      'Allocation weights sum to zero; there is no basis on which to allocate.',
    );
  }

  const negative = total < 0n;
  const magnitude = negative ? -total : total;

  // Floor each share, then hand out the remaining units to the largest
  // fractional remainders. Ties break toward the earlier index, which keeps the
  // result stable for a given input ordering.
  const exact = decimalWeights.map((w) =>
    new Decimal(magnitude.toString()).mul(w).div(weightTotal),
  );
  const floors = exact.map((e) => BigInt(e.floor().toFixed(0)));
  const distributed = floors.reduce((sum, f) => sum + f, 0n);
  let remainder = magnitude - distributed;

  const order = exact
    .map((e, index) => ({ index, frac: e.minus(e.floor()) }))
    .sort((a, b) => {
      const cmp = b.frac.comparedTo(a.frac);
      return cmp !== 0 ? cmp : a.index - b.index;
    });

  const result = [...floors];
  let cursor = 0;
  while (remainder > 0n) {
    const target = order[cursor % order.length];
    if (target) {
      result[target.index] = (result[target.index] ?? 0n) + 1n;
      remainder -= 1n;
    }
    cursor += 1;
  }

  return result.map((r) => (negative ? -r : r) as Kobo);
}
