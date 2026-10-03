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
 * The same purposes on the APPROVED chart. Rearing cost has no entry: poultry
 * rearing is held in 16032 (immature) or 16042 (mature) by the cohort's stage
 * on the day it is posted, and snail feed and treatment are expensed to 52610
 * or 52510 — see rearingNumberFor and snailInputExpenseNumber.
 */
export const APPROVED_SPECIES_ACCOUNTS: Partial<Record<SpeciesRole, Record<Species, string>>> = {
  productionLoss: { poultry: '51120', snail: '51110' },
  liveCostOfSales: { poultry: '50310', snail: '50210' },
  liveRevenue: { poultry: '40310', snail: '40210' },
};

/**
 * Poultry stage → whether the approved chart carries it as immature livestock
 * (16032) or mature (16042). The workbook names the two accounts (PLP-BA-IMM,
 * PLP-BA-MAT) but not which stage belongs to which, so this is an engineering
 * proposal on the IAS 41 reading — immature until the bird can be harvested or
 * is producing — for Finance to confirm. A stage not listed has no account:
 * it is refused, not guessed.
 */
export const POULTRY_STAGE_MATURITY: Record<string, 'immature' | 'mature'> = {
  Chick: 'immature',
  Grower: 'immature',
  Pullet: 'immature',
  Cockerel: 'immature',
  'Market-ready': 'mature',
  'Point-of-lay': 'mature',
  Layer: 'mature',
  Broiler: 'mature',
  Breeder: 'mature',
};
const APPROVED_POULTRY_BA = { immature: '16032', mature: '16042' } as const;

/** Raised when the APPROVED chart has no account for a purpose, or none for the stage or context asked about. */
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
    if (role === 'rearingCost') continue; // below: held by stage, not by species alone
    for (const species of ['poultry', 'snail'] as const) add(`${role}:${species}`, APPROVED_SPECIES_ACCOUNTS[role]?.[species] ?? null);
  }
  // Poultry rearing cost sits in the immature or mature account by stage, so
  // both must exist; snail feed and treatment are expensed to their own accounts.
  const addAll = (role: string, numbers: string[]) =>
    result.push({ role, number: numbers.join('/'), state: numbers.every(isActive) ? 'ready' : 'missing-account' });
  addAll('rearingCost:poultry', Object.values(APPROVED_POULTRY_BA));
  for (const species of ['poultry', 'snail'] as const) {
    const results = biologicalResultAccountsFor('APPROVED', species)!;
    addAll(`biologicalResults:${species}`, [results.gain, results.loss, results.normalMortality, results.abnormalMortality]);
  }
  addAll('rearingCost:snail', [snailInputExpenseNumber('APPROVED', 'feed'), snailInputExpenseNumber('APPROVED', 'treatment')]);
  return result;
}

/** The approved-chart biological asset account a poultry stage is carried in. */
export function poultryStageAccountNumber(stage: string): string {
  const maturity = POULTRY_STAGE_MATURITY[stage];
  if (!maturity) throw new UnresolvedApprovedAccount(`poultry stage "${stage}"`);
  return APPROVED_POULTRY_BA[maturity];
}

/**
 * Where a population's rearing cost is held when it is posted. On LEGACY and
 * SPEC that is one account for the species; on APPROVED, poultry cost goes to
 * the account of the cohort's stage on the day it is posted, and snail cost is
 * expensed (null), as on SPEC.
 */
export function rearingNumberFor(version: ChartVersion, species: string, stage: string): string | null {
  if (version !== 'APPROVED') return speciesNumberFor(version, 'rearingCost', species);
  return species.trim().toLowerCase() === 'snail' ? null : poultryStageAccountNumber(stage);
}

/** Every account a species' rearing cost can sit in on that chart — for per-account balances. */
export function rearingNumbersFor(version: ChartVersion, species: string): string[] {
  if (version === 'APPROVED') return species.trim().toLowerCase() === 'snail' ? [] : Object.values(APPROVED_POULTRY_BA);
  const one = speciesNumberFor(version, 'rearingCost', species);
  return one ? [one] : [];
}

/** What a snail's feed and treatment are expensed to as used (PCR-042/043), by chart. */
export function snailInputExpenseNumber(version: ChartVersion, purpose: 'feed' | 'treatment'): string {
  if (version === 'APPROVED') return purpose === 'feed' ? '52610' : '52510';
  return SNAIL_FEED_EXPENSE;
}

/**
 * Where a snail cohort's share of farm labour and overhead is expensed
 * (PCR-043): 612000 on the old charts; the workbook's direct snail farm labour
 * expense (52010) on the approved one.
 */
export function snailLabourExpenseNumber(version: ChartVersion): string {
  return version === 'APPROVED' ? '52010' : '612000';
}

/**
 * The accounts the poultry egg flow posts to (PCR-067/068/069), by chart.
 *
 * LEGACY and SPEC hold eggs in 130215, eggs in incubation in 130216 and the
 * gain at collection in 420210. On the approved chart the workbook's own
 * maps give the rest: eggs are finished poultry products (PLP-FG-EGG →
 * 12420), sold to 40330 revenue and 50330 cost of sales, and the gain at
 * initial recognition is the biological asset fair value gain (PLP-BA-IMM
 * BA_FAIR_VALUE_GAIN → 42000). The workbook has no account for eggs in
 * incubation; 13020 (poultry farm WIP control) is an engineering proposal —
 * eggs are work in process until they hatch — for Finance to confirm.
 */
export interface EggAccounts {
  /** Where collected eggs are held, when the item names no inventory account. */
  inventory: string;
  /** Credited when eggs are recognised at collection. */
  gain: string;
  /** Eggs set, until they hatch. */
  incubation: string;
  /** What an egg item sells to and relieves, when it names none; null where the old charts leave that to item setup. */
  revenue: string | null;
  costOfSales: string | null;
}

export function eggAccountsFor(version: ChartVersion): EggAccounts {
  if (version === 'APPROVED') {
    return { inventory: '12420', gain: '42000', incubation: '13020', revenue: '40330', costOfSales: '50330' };
  }
  return { inventory: '130215', gain: '420210', incubation: '130216', revenue: null, costOfSales: null };
}

/** Where day-old chicks are carried on hatching: 130210 on the old charts, the stage's account on the approved one. */
export function hatchedChickAccountNumber(version: ChartVersion, stage: string): string {
  return version === 'APPROVED' ? poultryStageAccountNumber(stage) : '130210';
}

/**
 * Snail stage → immature (16031) or mature (16041) biological assets on the
 * approved chart. As with poultry (POULTRY_STAGE_MATURITY) the workbook names
 * the two accounts (SNP-BA-IMM, SNP-BA-MAT) but not the stages: an engineering
 * proposal for Finance to confirm — immature until the snail is market-ready or
 * a breeder. The snail breeding module already carries viable eggs in 16031.
 */
export const SNAIL_STAGE_MATURITY: Record<string, 'immature' | 'mature'> = {
  Egg: 'immature',
  Hatchling: 'immature',
  Juvenile: 'immature',
  Juveniles: 'immature',
  Grower: 'immature',
  Growers: 'immature',
  'Market-ready': 'mature',
  Breeder: 'mature',
  'Breeder cohort': 'mature',
};
const APPROVED_SNAIL_BA = { immature: '16031', mature: '16041' } as const;

/** The approved-chart biological asset account a snail stage is carried in. */
export function snailStageAccountNumber(stage: string): string {
  const maturity = SNAIL_STAGE_MATURITY[stage];
  if (!maturity) throw new UnresolvedApprovedAccount(`snail stage "${stage}"`);
  return APPROVED_SNAIL_BA[maturity];
}

/** The approved-chart account a population of either species is carried in at a stage. */
export function biologicalStageAccountNumber(species: string, stage: string): string {
  return species.trim().toLowerCase() === 'snail' ? snailStageAccountNumber(stage) : poultryStageAccountNumber(stage);
}

/**
 * Where a population's valuation and mortality results post on the approved
 * chart, from the workbook's own maps: the biological asset fair value gain
 * (BA_FAIR_VALUE_GAIN → 42000) and loss (BA_FAIR_VALUE_LOSS → 42100) are
 * separate accounts, and normal and abnormal mortality have one each per
 * species. The old charts post gains, losses and normal deaths to one
 * fair-value account per species, so they return null and keep that.
 */
export interface BiologicalResultAccounts {
  gain: string;
  loss: string;
  normalMortality: string;
  abnormalMortality: string;
}

export function biologicalResultAccountsFor(version: ChartVersion, species: string): BiologicalResultAccounts | null {
  if (version !== 'APPROVED') return null;
  const snail = species.trim().toLowerCase() === 'snail';
  return {
    gain: '42000',
    loss: '42100',
    normalMortality: snail ? '51010' : '51020',
    abnormalMortality: snail ? '51110' : '51120',
  };
}

/* -------------------------------------------------------------------------
 * Production and processing on the approved chart
 * -------------------------------------------------------------------------
 * Processing and feed-mill orders resolve their accounts through posting
 * rules (PCR-0xx) whose keys are linked to accounts per company. On the
 * approved chart those keys are linked to the five-digit accounts below, from
 * the workbook's own maps (the work-centre, finished-goods, payroll and raw
 * material posting groups) and, where the workbook has no key for the app's
 * step, the review crosswalk (docs/approved-coa-crosswalk-review.csv). Each
 * entry says where it came from; test/unit/chart-approved.spec.ts checks the
 * workbook-sourced ones against the workbook.
 */
export const APPROVED_PROCESSING_KEYS: Record<string, { account: string; source: string }> = {
  // --- SnailPro processing (PCR-051…058) -----------------------------------
  'PCR-051-DR': { account: '13110', source: 'SNP-WC-MAIN PROCESSING_WIP' },
  'PCR-051-CR': { account: '16041', source: 'SNP-BA-MAT BA_DESTINATION_STAGE_CONTROL — market-ready snails leave the mature account' },
  'PCR-052-DR': { account: '13110', source: 'SNP-WC-MAIN PROCESSING_WIP' },
  'PCR-052-CR': { account: '12000', source: 'SNP-RM INVENTORY_CONTROL — workbook rule YFR-045B processing material consumption' },
  'PCR-053-DR': { account: '13110', source: 'SNP-WC-MAIN PROCESSING_WIP' },
  'PCR-053-CR': { account: '54000', source: 'SNP-WC-MAIN LABOUR_RECOVERY — default only; absorption is credited to the recovery account of each routing line’s resource type' },
  'PCR-054-DR': { account: '52110', source: 'SNP-PAYROLL OUTSOURCED_LABOUR_EXPENSE — snail processing labour expense' },
  'PCR-054-CR': { account: '20700', source: 'SNP-PAYROLL PAYROLL_PAYABLE' },
  'PCR-055-DR': { account: '52200', source: 'crosswalk 621200 → 52200 (utilities and facility; first of its split)' },
  'PCR-056-DR': { account: '51200', source: 'crosswalk 640400 → 51200 (abnormal processing loss, IAS 2)' },
  'PCR-056-CR': { account: '13110', source: 'SNP-WC-MAIN PROCESSING_WIP' },
  'PCR-057-DR': { account: '12410', source: 'SNP-FG-PROCESSED FINISHED_GOODS_INVENTORY' },
  'PCR-057-CR': { account: '13110', source: 'SNP-WC-MAIN PROCESSING_WIP' },
  'PCR-058-DR': { account: '53500', source: 'SNP-WC-MAIN RECOVERY_VARIANCE' },
  // --- PoultryPro processing (PCR-074…080) ----------------------------------
  'PCR-074-DR': { account: '13120', source: 'PLP-WC-MAIN PROCESSING_WIP' },
  'PCR-074-CR': { account: '16042', source: 'PLP-BA-MAT BA_DESTINATION_STAGE_CONTROL — market-ready birds leave the mature account' },
  'PCR-075-DR': { account: '13120', source: 'PLP-WC-MAIN PROCESSING_WIP' },
  'PCR-075-CR': { account: '12000', source: 'PLP-RM INVENTORY_CONTROL — workbook rule YFR-045B processing material consumption' },
  'PCR-076-DR': { account: '13120', source: 'PLP-WC-MAIN PROCESSING_WIP' },
  'PCR-076-CR': { account: '54000', source: 'PLP-WC-MAIN LABOUR_RECOVERY — default only; see PCR-053-CR' },
  'PCR-077-DR': { account: '52120', source: 'PLP-PAYROLL OUTSOURCED_LABOUR_EXPENSE — poultry processing labour expense' },
  'PCR-078-DR': { account: '51200', source: 'crosswalk 640600 → 51200 (abnormal processing loss, IAS 2)' },
  'PCR-078-CR': { account: '13120', source: 'PLP-WC-MAIN PROCESSING_WIP' },
  'PCR-079-DR': { account: '12420', source: 'PLP-FG-PROCESSED FINISHED_GOODS_INVENTORY' },
  'PCR-079-CR': { account: '13120', source: 'PLP-WC-MAIN PROCESSING_WIP' },
  'PCR-080-DR': { account: '53500', source: 'PLP-WC-MAIN RECOVERY_VARIANCE' },
  // --- Feed mill (PCR-032…036) ----------------------------------------------
  'PCR-032-DR': { account: '13200', source: 'PLP-RM FEED_MILL_WIP' },
  'PCR-032-CR': { account: '12100', source: 'PLP-RM FEED_INGREDIENT_INVENTORY — workbook rule YFR-045C' },
  'PCR-033-DR': { account: '13200', source: 'PLP-RM FEED_MILL_WIP' },
  'PCR-033-CR': { account: '54300', source: 'PLP-RM FEED_MILL_OVERHEAD_RECOVERY' },
  'PCR-034-DR': { account: '12450', source: 'PLP-FG FINISHED_FEED_INVENTORY' },
  'PCR-034-CR': { account: '13200', source: 'PLP-RM FEED_MILL_WIP' },
  'PCR-035-DR': { account: '51200', source: 'crosswalk 640200 → 51200 (post-harvest abnormal production loss)' },
  'PCR-035-CR': { account: '13200', source: 'PLP-RM FEED_MILL_WIP' },
  'PCR-036-DR': { account: '53600', source: 'PLP-RM FEED_YIELD_VARIANCE — feed mill yield and formulation variance' },
};

/** Which resource a routing operation absorbs, for the recovery account it is credited to. */
export type RecoveryResource = 'LABOUR' | 'MACHINE' | 'OVERHEAD' | 'DEPRECIATION';

/**
 * The recovery account a processing order's standard absorption is credited
 * to, by the routing line's resource: labour recovery 54000, machine overhead
 * recovery 54100 (machine time and the depreciation absorbed by it), utility
 * recovery 54200 (power, maintenance, QA, stores). The old charts keep one
 * recovery account per line (219810 snail, 219820 poultry), so they have no
 * resource split.
 */
export function recoveryNumberFor(resource: RecoveryResource): string {
  return resource === 'LABOUR' ? '54000' : resource === 'OVERHEAD' ? '54200' : '54100';
}

/** The one feed-mill recovery account on the approved chart (a single account carries every species). */
export const APPROVED_FEED_MILL_RECOVERY = '54300';

/**
 * Where an order's actual overhead is charged before settlement clears it:
 * utilities expense, the first of the review crosswalk's split for the
 * snail overhead and poultry conversion pools.
 */
export const APPROVED_OVERHEAD_POOL = '52200';

/** The accrual actual conversion cost is credited to until its invoices and payroll are booked. */
export function accrualNumberFor(version: ChartVersion): string | null {
  return version === 'APPROVED' ? '20200' : null;
}

/** The processing WIP accounts the control reconciliation reads, by chart. */
export function processingWipNumbers(version: ChartVersion): Record<'SNAILPRO' | 'POULTRYPRO' | 'FEED_MILL', string> {
  return version === 'APPROVED'
    ? { SNAILPRO: '13110', POULTRYPRO: '13120', FEED_MILL: '13200' }
    : { SNAILPRO: '130410', POULTRYPRO: '130420', FEED_MILL: '130430' };
}

/** Where machine depreciation for a processing line is charged (PCR-031), by chart. */
export function processingOverheadNumber(version: ChartVersion, cycle: 'SNAILPRO' | 'POULTRYPRO' | 'FEED_MILL'): string {
  if (version === 'APPROVED') return cycle === 'FEED_MILL' ? '52700' : '52400';
  return cycle === 'SNAILPRO' ? '621200' : cycle === 'POULTRYPRO' ? '622100' : '623100';
}

/* -------------------------------------------------------------------------
 * Sales and procurement on the approved chart
 * -------------------------------------------------------------------------
 * O2C and P2P post through the company's SalesConfiguration and
 * ProcurementConfiguration (and the item and tax accounts), not through
 * posting keys. On the approved chart those defaults are the workbook's own:
 * the customer group's AR control, the finance default group's revenue and
 * retained cost-of-sales controls, finished goods control, the withholding
 * receivable, and for procurement the vendor group's AP control, GRNI and
 * the withholding payable. An item names its own revenue, cost-of-sales and
 * inventory accounts where it differs (eggs: 40330 / 50330 / 12420).
 */
export const APPROVED_SALES_DEFAULTS = {
  receivable: '11000', // COR-CUST-LOCAL AR_CONTROL
  revenue: '40000', // COR-FIN-DEFAULT INCOME_ACCOUNT
  costOfSales: '50000', // COR-FG COGS
  inventory: '12400', // COR-FG FINISHED_GOODS_INVENTORY
  whtReceivable: '11400', // COR-WHT-SUP-2 WHT_RECEIVABLE
} as const;

export const APPROVED_PROCUREMENT_DEFAULTS = {
  grni: '20300', // COR-RM GRNI
  payables: '20100', // COR-VEND-LOCAL AP_CONTROL
  whtPayable: '20500', // COR-WHT-SUP-2 WHT_PAYABLE
} as const;
