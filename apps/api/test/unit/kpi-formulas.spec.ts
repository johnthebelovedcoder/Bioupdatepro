import { describe, expect, it } from 'vitest';
import * as f from '../../src/reporting/kpi-formulas';

/**
 * KPI_FORMULA_DEMOS (workbook v8.9.8): each demonstration's inputs through
 * the application's own formula, against the workbook's result — REPORT_KPI_CHECKS
 * "Formula demonstrations (15)".
 */
const DEMOS: Array<[id: string, kpi: string, actual: () => unknown, workbook: number]> = [
  ['KPI-01', 'Gross margin %', () => f.grossMargin(7_420_000, 4_283_333), 0.42273140161725065],
  ['KPI-02', 'Current ratio', () => f.currentRatio(5_000_000, 2_500_000), 2],
  ['KPI-03', 'DSO', () => f.daysSalesOutstanding(1_200_000, 7_420_000, 30), 4.851752021563342],
  ['KPI-04', 'Inventory days', () => f.inventoryDays(1_800_000, 4_283_333, 30), 12.607004872140456],
  ['KPI-05', 'Snail cost variance', () => f.costVariance(326_000, 300_000), 26_000],
  ['KPI-06', 'Poultry cost variance', () => f.costVariance(660_000, 620_000), 40_000],
  ['KPI-07', 'Hatch rate', () => f.hatchRate(1_000, 2_000), 0.5],
  ['KPI-08', 'Snail mortality rate', () => f.mortalityRate(25, 500), 0.05],
  ['KPI-09', 'Survival rate', () => f.survivalRate(850, 1_000), 0.85],
  ['KPI-10', 'Meat yield', () => f.processingYield(350, 1_000), 0.35],
  ['KPI-11', 'FCR', () => f.feedConversionRatio(4_500, 2_100), 2.142857142857143],
  ['KPI-12', 'Poultry mortality rate', () => f.mortalityRate(50, 1_000), 0.05],
  ['KPI-13', 'Hen-day production', () => f.henDay(820, 900), 0.9111111111111111],
  ['KPI-14', 'Dressed yield', () => f.processingYield(1_254, 1_900), 0.66],
  ['KPI-15', 'Production close readiness', () => f.closeReadiness(0, 0, 0), 1],
];

describe('KPI formulas reproduce KPI_FORMULA_DEMOS (REPORT_KPI_CHECKS)', () => {
  it('reproduces all fifteen workbook demonstrations', () => {
    expect(DEMOS).toHaveLength(15);
    const off = DEMOS.map(([id, kpi, actual, workbook]) => ({ id, kpi, app: Number(String(actual())), workbook })).filter(
      (d) => Math.abs(d.app - d.workbook) > 1e-12,
    );
    expect(off).toEqual([]);
  });

  it('refuses a zero denominator rather than dividing by it', () => {
    expect(f.currentRatio(100, 0)).toBeNull();
    expect(f.inventoryDays(100, 0, 30)).toBeNull();
    expect(f.hatchRate(0, 0)).toBeNull();
  });

  it('is not ready to close while anything is left in WIP or recovery, or an order is open', () => {
    expect(f.closeReadiness(1, 0, 0)).toBe(0);
    expect(f.closeReadiness(0, -1, 0)).toBe(0);
    expect(f.closeReadiness(0, 0, 2)).toBe(0);
  });
});
