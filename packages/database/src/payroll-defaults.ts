/**
 * The current Nigerian statutory payroll figures — PAYE bands, reliefs,
 * pension/NHF/NSITF/ITF rates — as a single source of truth for `seed.ts`.
 *
 * These are not business preferences a company sets; they are the law. This
 * file exists so `seed.ts` has one place to read them from rather than
 * carrying its own copy — which is exactly how the ITF threshold drifted
 * before (seeded as 25 employees, matching neither the workbook's stated 5
 * nor its own formula).
 *
 * `apps/api/src/payroll/payroll-setup.service.ts` needs the SAME figures at
 * runtime and, ideally, would import them from here too — it cannot today,
 * because `@bioassetpro/database`'s package.json points `main`/`types`
 * straight at the generated Prisma client, not at this package's `src/`, so
 * nothing here is reachable across that boundary. It carries its own copy
 * instead, with a comment pointing back at this file. If the rates below
 * change, that file has to change with it by hand.
 *
 * When the law changes, this file changes, dated forward from its own
 * `effectiveFrom` — never edited in place for a company that has already
 * run payroll under it (`seed.ts`'s own comment on this: "past payroll runs
 * still reproduce exactly").
 */

export const PAYROLL_EFFECTIVE_FROM = new Date('2026-01-01');

export const NIGERIA_PAYE_2026_SOURCE =
  'Nigeria_PAYE_2026 workbook, Tax_Bands sheet (Nigeria Tax Act 2025)';

/** Amounts are naira in the workbook; kobo here. */
export const NIGERIA_PAYE_2026_BANDS = [
  { order: 1, lower: 0n, upper: 800_000_00n, width: 800_000_00n, rate: '0.00000000' },
  { order: 2, lower: 800_000_00n, upper: 3_000_000_00n, width: 2_200_000_00n, rate: '0.15000000' },
  { order: 3, lower: 3_000_000_00n, upper: 12_000_000_00n, width: 9_000_000_00n, rate: '0.18000000' },
  { order: 4, lower: 12_000_000_00n, upper: 25_000_000_00n, width: 13_000_000_00n, rate: '0.21000000' },
  { order: 5, lower: 25_000_000_00n, upper: 50_000_000_00n, width: 25_000_000_00n, rate: '0.23000000' },
  { order: 6, lower: 50_000_000_00n, upper: null, width: null, rate: '0.25000000' },
] as const;

export const NIGERIA_PAYE_2026_CONFIG = {
  // PAYE_Rules B5: national minimum wage, monthly.
  minimumWageMonthlyKobo: 70_000_00n,
  // PAYE_Rules B6/B7: lower of 20% of annual rent, or ₦500,000.
  rentReliefRate: '0.20000000',
  rentReliefCapKobo: 500_000_00n,
  // PAYE_Rules B8: 8% of basic + housing + transport.
  pensionReliefRate: '0.08000000',
  rounding: 'HALF_UP' as const,
  // PAYE_Calculation column AD.
  ruleVersion: 'NTA-2025-2026.01',
  sourceReference:
    'Nigeria_PAYE_2026 workbook, PAYE_Rules sheet. NOTE: the Consolidated ' +
    'Relief Allowance is deliberately absent — it was removed under this ' +
    'framework and rent relief replaces it.',
};

export const NIGERIA_STATUTORY_2026_CONFIG = {
  // Statutory_Rules C5/C6: 8% employee, 10% employer, 18% combined.
  pensionFunding: 'SPLIT_8_10' as const,
  pensionEmployeeRate: '0.08000000',
  pensionEmployerRate: '0.10000000',
  pensionCombinedRate: '0.18000000',
  // Company_Setup B13: pension applies at 3 or more employees.
  pensionMinEmployees: 3,
  // Statutory_Rules C7: 2.5% of monthly income, opt-in for private sector.
  nhfRate: '0.02500000',
  // Statutory_Rules C8: 1% of payroll, employer only.
  nsitfRate: '0.01000000',
  // NG_Statutory_Rules!E16/D16: 1% of annual payroll, >=5 employees, not in
  // an FTZ — confirmed against the live workbook's own formula at
  // NG_PAYE_2026!X5 (`IF(COUNTA(A$5:A$10)>=5,1,0)`). No "25-employee" cell
  // exists anywhere in the workbook.
  itfRate: '0.01000000',
  itfMinEmployees: 5,
  minimumWageMonthlyKobo: 70_000_00n,
  sourceReference: 'Nigeria_Statutory_Payroll workbook, Statutory_Rules and Company_Setup sheets',
};
