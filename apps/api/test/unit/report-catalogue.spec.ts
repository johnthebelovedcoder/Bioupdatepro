import { describe, expect, it } from 'vitest';
import { REPORT_CATALOGUE, WORKBOOK_REPORTS } from '../../src/reporting/report-catalogue';
import { KPI_DEFINITIONS } from '../../src/reporting/kpi-definitions';
import { routeExists } from '../helpers/web-routes';

/**
 * The Reports page's catalogue against the client's REPORT_KPI_CATALOG
 * (REPORT_KPI_CHECKS "catalog rows"): every workbook definition present, each
 * built one on a real screen, each unfinished one saying what is missing.
 */
const WORKBOOK_IDS = [
  ...Array.from({ length: 18 }, (_, i) => `AGR-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 10 }, (_, i) => `SNL-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 11 }, (_, i) => `PLY-${String(i + 1).padStart(3, '0')}`),
];

describe('The report catalogue covers REPORT_KPI_CATALOG (REPORT_KPI_CHECKS)', () => {
  it('defines every workbook report: 18 AgriPro, 10 SnailPro, 11 PoultryPro', () => {
    expect(WORKBOOK_IDS).toHaveLength(39);
    expect(WORKBOOK_REPORTS.map((e) => e.id).sort()).toEqual([...WORKBOOK_IDS].sort());
    expect(new Set(REPORT_CATALOGUE.map((e) => e.key)).size).toBe(REPORT_CATALOGUE.length);
  });

  it('puts every built report on a screen that exists, and says what is missing from the rest', () => {
    expect(REPORT_CATALOGUE.filter((e) => e.status !== 'NOT_BUILT' && !(e.webPath && routeExists(e.webPath))).map((e) => e.id)).toEqual([]);
    expect(REPORT_CATALOGUE.filter((e) => e.status !== 'BUILT' && !e.gap).map((e) => e.id)).toEqual([]);
    expect(REPORT_CATALOGUE.filter((e) => e.status === 'BUILT' && e.gap).map((e) => e.id)).toEqual([]);
  });

  it('defines every KPI the KPIs page shows, with its formula', () => {
    expect(KPI_DEFINITIONS.filter((k) => !k.formula || !k.numerator).map((k) => k.key)).toEqual([]);
    expect(new Set(KPI_DEFINITIONS.map((k) => k.key)).size).toBe(KPI_DEFINITIONS.length);
  });
});
