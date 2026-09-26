/**
 * Which account does what, on each chart.
 *
 * Every company is on one of two charts:
 *   LEGACY  the four-digit chart new farms were given until 2026-09-25
 *   SPEC    the client's six-digit chart (POSTING_COA_MASTER /
 *           RECOMMENDED_COA_CC) that the posting rules are written against
 *
 * Code asks for an account by what it is for — `salaryPayable`, `grni` — and
 * ChartService answers with the company's own account on its own chart. A
 * company moves from LEGACY to SPEC once, through the chart unification
 * (ChartUnificationService), which posts journals moving every balance and
 * then switches `Company.chartVersion`.
 *
 * Species-dependent purposes (a snail's cost of sales is not a bird's) take
 * the species; on LEGACY they share one account, as they always did.
 */

export type ChartVersion = 'LEGACY' | 'SPEC';
export type Species = 'poultry' | 'snail';

export type AccountRole =
  | 'bank'
  | 'receivables'
  | 'rawMaterials'
  | 'feedInventory'
  | 'packaging'
  | 'inputVat'
  | 'whtReceivable'
  | 'ppe'
  | 'accumulatedDepreciation'
  | 'salaryPayable'
  | 'pensionPayable'
  | 'nhfPayable'
  | 'nsitfPayable'
  | 'itfPayable'
  | 'payePayable'
  | 'outputVat'
  | 'whtPayable'
  | 'grni'
  | 'tradePayables'
  | 'retainedEarnings'
  | 'salaryExpense'
  | 'employerPensionExpense'
  | 'nsitfExpense'
  | 'itfExpense'
  | 'operatingExpenses'
  | 'depreciationExpense'
  /** IAS 36 impairment of fixed assets; the spec chart has no approved number, so 630200 is proposed. */
  | 'impairmentLoss'
  /** POL-009 prorated variance held against finished goods and WIP; no spec number, 130590/130595 proposed. */
  | 'fgCapitalisedVariance'
  | 'wipCapitalisedVariance';

/** [LEGACY, SPEC] account numbers for each purpose that does not depend on species. */
export const ROLE_ACCOUNTS: Record<AccountRole, [legacy: string, spec: string]> = {
  bank: ['1101', '110100'],
  receivables: ['1201', '120100'],
  rawMaterials: ['1301', '130100'],
  // LEGACY never separated feed from other raw materials.
  feedInventory: ['1301', '130110'],
  packaging: ['1302', '130100'],
  inputVat: ['1601', '125100'],
  whtReceivable: ['1602', '125200'],
  ppe: ['1701', '140100'],
  accumulatedDepreciation: ['1702', '149100'],
  salaryPayable: ['2101', '220100'],
  pensionPayable: ['2102', '222100'],
  nhfPayable: ['2103', '223100'],
  nsitfPayable: ['2104', '224100'],
  itfPayable: ['2105', '224100'],
  payePayable: ['2110', '221100'],
  outputVat: ['2120', '226100'],
  whtPayable: ['2130', '225100'],
  grni: ['2140', '210200'],
  tradePayables: ['2201', '210100'],
  retainedEarnings: ['3200', '320100'],
  salaryExpense: ['5101', '620100'],
  employerPensionExpense: ['5102', '620200'],
  nsitfExpense: ['5103', '620300'],
  itfExpense: ['5104', '620300'],
  operatingExpenses: ['5401', '690100'],
  depreciationExpense: ['5501', '630100'],
  impairmentLoss: ['5502', '630200'],
  fgCapitalisedVariance: ['1402', '130590'],
  wipCapitalisedVariance: ['1403', '130595'],
};

export type SpeciesRole =
  /** Where a population's rearing cost (feed, medication, labour) is held. */
  | 'rearingCost'
  /** Where the rearing cost of animals that die is written off. */
  | 'productionLoss'
  /** Cost of sales for live animals sold. */
  | 'liveCostOfSales'
  /** Revenue for live animals sold. */
  | 'liveRevenue';

/**
 * [LEGACY, SPEC by species]. On SPEC, snail rearing cost is not held at all:
 * the workbook expenses snail feed and medication as used (PCR-042 → 611000)
 * and snail labour (PCR-043 → 612000), while poultry is capitalised into the
 * biological asset (PCR-062/063/064 → 130210) — the policy chosen on
 * 2026-09-25. `null` means "not capitalised": post to the expense instead.
 */
export const SPECIES_ACCOUNTS: Record<SpeciesRole, [legacy: string, spec: Record<Species, string | null>]> = {
  rearingCost: ['1501', { poultry: '130210', snail: null }],
  productionLoss: ['5305', { poultry: '640500', snail: '640300' }],
  liveCostOfSales: ['5001', { poultry: '510300', snail: '510100' }],
  liveRevenue: ['4101', { poultry: '410300', snail: '410100' }],
};

/** On SPEC, what a snail's feed and medication are charged to instead of being held (PCR-042). */
export const SNAIL_FEED_EXPENSE = '611000';

/** Every account number a purpose has had, on either chart — for reports that must read both. */
export function allNumbersFor(...roles: AccountRole[]): string[] {
  return [...new Set(roles.flatMap((role) => ROLE_ACCOUNTS[role]))];
}

export function allSpeciesNumbersFor(role: SpeciesRole): string[] {
  const [legacy, spec] = SPECIES_ACCOUNTS[role];
  return [...new Set([legacy, ...Object.values(spec).filter((n): n is string => !!n)])];
}

/* -- Helpers for code that already holds a Prisma client or transaction -- */

interface CompanyReader {
  company: { findUnique(args: { where: { id: string }; select: { chartVersion: true } }): Promise<{ chartVersion: string } | null> };
}

export async function chartVersionOf(client: CompanyReader, companyId: string): Promise<ChartVersion> {
  const company = await client.company.findUnique({ where: { id: companyId }, select: { chartVersion: true } });
  return company?.chartVersion === 'SPEC' ? 'SPEC' : 'LEGACY';
}

export function numberFor(version: ChartVersion, role: AccountRole): string {
  return ROLE_ACCOUNTS[role][version === 'SPEC' ? 1 : 0];
}

export function speciesNumberFor(version: ChartVersion, role: SpeciesRole, species: string): string | null {
  const [legacy, spec] = SPECIES_ACCOUNTS[role];
  if (version === 'LEGACY') return legacy;
  return spec[species === 'snail' ? 'snail' : 'poultry'];
}
