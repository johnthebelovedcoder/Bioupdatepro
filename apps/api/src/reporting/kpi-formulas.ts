import Decimal from 'decimal.js';

/**
 * The workbook's KPI formulas (KPI_FORMULA_DEMOS, v8.9.8), one function
 * each, as exact decimals. KpiService computes its figures through these, and
 * test/unit/kpi-formulas.spec.ts reproduces the workbook's fifteen
 * demonstrations with them — so the formula the application runs is the one
 * the client wrote down.
 *
 * Ratios are returned as fractions (0.05, not 5); callers show them as a
 * percentage. A zero denominator is null: "not computable", never infinity.
 */
type N = Decimal.Value;
const ratio = (numerator: N, denominator: N): Decimal | null => {
  const d = new Decimal(denominator);
  return d.isZero() ? null : new Decimal(numerator).div(d);
};

/** KPI-01 — (revenue − cost of sales) ÷ revenue. */
export const grossMargin = (revenue: N, costOfSales: N) => ratio(new Decimal(revenue).minus(costOfSales), revenue);

/** KPI-02 — current assets ÷ current liabilities, times. */
export const currentRatio = (currentAssets: N, currentLiabilities: N) => ratio(currentAssets, currentLiabilities);

/** KPI-03 — receivables ÷ revenue × days in the period. */
export const daysSalesOutstanding = (receivables: N, revenue: N, days: N) => ratio(receivables, revenue)?.mul(days) ?? null;

/** KPI-04 — inventory ÷ cost of sales × days in the period. */
export const inventoryDays = (inventory: N, costOfSales: N, days: N) => ratio(inventory, costOfSales)?.mul(days) ?? null;

/** KPI-05/06 — actual conversion cost less standard absorbed; positive is adverse. */
export const costVariance = (actual: N, standard: N) => new Decimal(actual).minus(standard);

/** KPI-07 — hatched ÷ eggs set. */
export const hatchRate = (hatched: N, eggsSet: N) => ratio(hatched, eggsSet);

/** KPI-08/12 — deaths ÷ the population at risk. */
export const mortalityRate = (deaths: N, population: N) => ratio(deaths, population);

/** KPI-09 — survivors ÷ the opening population. */
export const survivalRate = (survivors: N, opening: N) => ratio(survivors, opening);

/** KPI-10/14 — main output weight ÷ input weight (snail meat yield, poultry dressed yield). */
export const processingYield = (outputKg: N, inputKg: N) => ratio(outputKg, inputKg);

/** KPI-11 — feed ÷ live-weight gain, kg per kg. */
export const feedConversionRatio = (feedKg: N, gainKg: N) => ratio(feedKg, gainKg);

/** KPI-13 — eggs ÷ hens alive, for the day. */
export const henDay = (eggs: N, hens: N) => ratio(eggs, hens);

/**
 * KPI-15 — 1 when production can close: nothing left in WIP, nothing left in
 * recovery, and no order still open; 0 otherwise.
 */
export const closeReadiness = (wip: N, recovery: N, openOrders: N) =>
  new Decimal(wip).isZero() && new Decimal(recovery).isZero() && new Decimal(openOrders).isZero() ? 1 : 0;
