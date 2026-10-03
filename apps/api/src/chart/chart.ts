/**
 * Which account does what, on each chart.
 *
 * Runtime compatibility charts:
 *   LEGACY  the four-digit chart new farms were given until 2026-09-25
 *   SPEC    the historical six-digit chart implementation. Its cutover is
 *           disabled while the selected five-digit approved workbook chart
 *           is implemented and reconciled.
 *   APPROVED the five-digit chart of the client's approved posting-engine
 *           workbook (docs/target-coa-decision.md). No company is moved onto
 *           it until Finance signs the crosswalk; the role map below is ready
 *           for it. A purpose the crosswalk says depends on context (asset
 *           class, item class, livestock stage, liability nature) has no
 *           single number there — it is `null`, and asking for it fails
 *           loudly rather than guessing (docs/target-coa-role-crosswalk.md).
 *
 * Code asks for an account by what it is for — `salaryPayable`, `grni` — and
 * ChartService answers with the company's own account on its own chart. A
 * `Company.chartVersion` still reflects these compatibility paths. The
 * five-digit target is tracked separately by posting-control chart readiness;
 * do not switch companies to SPEC through the old cutover route.
 *
 * Species-dependent purposes (a snail's cost of sales is not a bird's) take
 * the species; on LEGACY they share one account, as they always did.
 */

export type ChartVersion = 'LEGACY' | 'SPEC' | 'APPROVED';
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

/**
 * [LEGACY, SPEC, APPROVED] account numbers for each purpose that does not
 * depend on species.
 *
 * APPROVED numbers come from the approved posting-engine workbook's own
 * account maps for the company-wide application (YifrehCore), verified by
 * test/unit/chart-approved.spec.ts: raw materials COR-RM INVENTORY_CONTROL,
 * fixed assets COR-FA-EQUIP (cost 15200, accumulated depreciation 15600),
 * employer NSITF/ITF COR-FIN-DEFAULT ACCRUAL_CONTROL (an accrual, not a
 * deduction), payroll cost COR-PAYROLL LABOUR_EXPENSE (the workbook has no
 * separate employer-cost keys, so all four payroll expense roles share it),
 * operating expense COR-SVC-ADMIN SERVICE_EXPENSE. A fixed asset of another
 * class and a payroll cost needing an activity split still need Finance's
 * approved posting group; that is a crosswalk decision, not a code one.
 *
 * APPROVED is `null` where the workbook has no account at all — impairment
 * loss and the two capitalised variances — and asking for it fails loudly.
 */
export const ROLE_ACCOUNTS: Record<AccountRole, [legacy: string, spec: string, approved: string | null]> = {
  bank: ['1101', '110100', '10100'],
  receivables: ['1201', '120100', '11000'],
  rawMaterials: ['1301', '130100', '12000'],
  // LEGACY never separated feed from other raw materials.
  feedInventory: ['1301', '130110', '12100'],
  packaging: ['1302', '130100', '12200'],
  inputVat: ['1601', '125100', '11300'],
  whtReceivable: ['1602', '125200', '11400'],
  ppe: ['1701', '140100', '15200'],
  accumulatedDepreciation: ['1702', '149100', '15600'],
  salaryPayable: ['2101', '220100', '20700'],
  pensionPayable: ['2102', '222100', '20700'],
  nhfPayable: ['2103', '223100', '20700'],
  nsitfPayable: ['2104', '224100', '20200'],
  itfPayable: ['2105', '224100', '20200'],
  payePayable: ['2110', '221100', '20600'],
  outputVat: ['2120', '226100', '20400'],
  whtPayable: ['2130', '225100', '20500'],
  grni: ['2140', '210200', '20300'],
  tradePayables: ['2201', '210100', '20100'],
  retainedEarnings: ['3200', '320100', '30200'],
  salaryExpense: ['5101', '620100', '52000'],
  employerPensionExpense: ['5102', '620200', '52000'],
  nsitfExpense: ['5103', '620300', '52000'],
  itfExpense: ['5104', '620300', '52000'],
  operatingExpenses: ['5401', '690100', '56000'],
  depreciationExpense: ['5501', '630100', '52400'],
  impairmentLoss: ['5502', '630200', null],
  fgCapitalisedVariance: ['1402', '130590', null],
  wipCapitalisedVariance: ['1403', '130595', null],
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

/**
 * The same purposes on the APPROVED chart. Rearing cost has no entry: the
 * workbook holds poultry rearing in 16032 (immature) or 16042 (mature) by the
 * cohort's stage at the posting date, and snail feed and treatment in 52610 or
 * 52510 by the source item — neither is a function of species alone.
 */
export const APPROVED_SPECIES_ACCOUNTS: Partial<Record<SpeciesRole, Record<Species, string>>> = {
  productionLoss: { poultry: '51120', snail: '51110' },
  liveCostOfSales: { poultry: '50310', snail: '50210' },
  liveRevenue: { poultry: '40310', snail: '40210' },
};

/** Raised when the APPROVED chart has no single account for a purpose without more context. */
export class UnresolvedApprovedAccount extends Error {
  constructor(readonly purpose: string) {
    super(
      `${purpose} has no single account on the approved five-digit chart: it depends on the item, asset, stage or liability behind the posting (docs/target-coa-role-crosswalk.md).`,
    );
  }
}

/** On SPEC, what a snail's feed and medication are charged to instead of being held (PCR-042). */
export const SNAIL_FEED_EXPENSE = '611000';

/** Every account number a purpose has had, on either chart — for reports that must read both. */
export function allNumbersFor(...roles: AccountRole[]): string[] {
  return [...new Set(roles.flatMap((role) => ROLE_ACCOUNTS[role]).filter((n): n is string => !!n))];
}

export function allSpeciesNumbersFor(role: SpeciesRole): string[] {
  const [legacy, spec] = SPECIES_ACCOUNTS[role];
  const approved = Object.values(APPROVED_SPECIES_ACCOUNTS[role] ?? {});
  return [...new Set([legacy, ...Object.values(spec).filter((n): n is string => !!n), ...approved])];
}

/** How a stored `Company.chartVersion` reads; anything unrecognised is the LEGACY chart. */
export function parseChartVersion(stored: string | null | undefined): ChartVersion {
  return stored === 'SPEC' || stored === 'APPROVED' ? stored : 'LEGACY';
}

/* -- Helpers for code that already holds a Prisma client or transaction -- */

interface CompanyReader {
  company: { findUnique(args: { where: { id: string }; select: { chartVersion: true } }): Promise<{ chartVersion: string } | null> };
}

export async function chartVersionOf(client: CompanyReader, companyId: string): Promise<ChartVersion> {
  const company = await client.company.findUnique({ where: { id: companyId }, select: { chartVersion: true } });
  return parseChartVersion(company?.chartVersion);
}

const VERSION_COLUMN: Record<ChartVersion, 0 | 1 | 2> = { LEGACY: 0, SPEC: 1, APPROVED: 2 };

/** The role's account number on that chart; on APPROVED, throws where the role needs context. */
export function numberFor(version: ChartVersion, role: AccountRole): string {
  const number = ROLE_ACCOUNTS[role][VERSION_COLUMN[version]];
  if (number === null) throw new UnresolvedApprovedAccount(role);
  return number;
}

export function speciesNumberFor(version: ChartVersion, role: SpeciesRole, species: string): string | null {
  const [legacy, spec] = SPECIES_ACCOUNTS[role];
  const normalized = species.trim().toLowerCase();
  if (version === 'LEGACY') return legacy;
  const species_ = normalized === 'snail' ? 'snail' : 'poultry';
  if (version === 'APPROVED') {
    const approved = APPROVED_SPECIES_ACCOUNTS[role]?.[species_];
    if (!approved) throw new UnresolvedApprovedAccount(`${role} (${species_})`);
    return approved;
  }
  return spec[species_];
}

/**
 * Whether a population's rearing cost is capitalised into its biological
 * asset rather than held apart or expensed. Poultry is on both client charts;
 * snail feed and treatment are expensed as used. The old chart holds it
 * apart (1501).
 */
export function holdsRearingInAsset(version: ChartVersion, species: string): boolean {
  return version !== 'LEGACY' && species.trim().toLowerCase() !== 'snail';
}

export interface RoleReadiness {
  /** The purpose code asks for ('grni', or 'liveRevenue:snail'). */
  role: string;
  /** Its account on the approved chart; null where the workbook names none. */
  number: string | null;
  /** ready; no-workbook-account (the crosswalk has none); or missing-account (the company's chart lacks it). */
  state: 'ready' | 'no-workbook-account' | 'missing-account';
}

/**
 * Whether every purpose code asks for by role can be answered on the approved
 * five-digit chart (docs/target-coa-role-crosswalk.md step 4). `isActive` says
 * whether the company's own chart holds the account.
 */
export function approvedRoleReadiness(isActive: (accountNumber: string) => boolean): RoleReadiness[] {
  const result: RoleReadiness[] = [];
  const add = (role: string, number: string | null) =>
    result.push({ role, number, state: number === null ? 'no-workbook-account' : isActive(number) ? 'ready' : 'missing-account' });
  for (const role of Object.keys(ROLE_ACCOUNTS) as AccountRole[]) add(role, ROLE_ACCOUNTS[role][2]);
  for (const role of Object.keys(SPECIES_ACCOUNTS) as SpeciesRole[]) {
    for (const species of ['poultry', 'snail'] as const) add(`${role}:${species}`, APPROVED_SPECIES_ACCOUNTS[role]?.[species] ?? null);
  }
  return result;
}
