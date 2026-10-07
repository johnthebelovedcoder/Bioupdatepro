import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPROVED_SPECIES_ACCOUNTS,
  ROLE_ACCOUNTS,
  UnresolvedApprovedAccount,
  APPROVED_FEED_MILL_RECOVERY,
  APPROVED_PROCUREMENT_DEFAULTS,
  APPROVED_SALES_DEFAULTS,
  APPROVED_OVERHEAD_POOL,
  APPROVED_POSTING_KEYS,
  accrualNumberFor,
  approvedRoleReadiness,
  processingOverheadNumber,
  processingWipNumbers,
  recoveryNumberFor,
  biologicalResultAccountsFor,
  biologicalStageAccountNumber,
  snailStageAccountNumber,
  eggAccountsFor,
  hatchedChickAccountNumber,
  poultryStageAccountNumber,
  rearingNumberFor,
  rearingNumbersFor,
  snailInputExpenseNumber,
  snailLabourExpenseNumber,
  holdsRearingInAsset,
  numberFor,
  parseChartVersion,
  speciesNumberFor,
  type AccountRole,
} from '../../src/chart/chart';

/**
 * The APPROVED (five-digit) column of the chart role map, against the account
 * master in the client's approved posting-engine workbook and the engineering
 * crosswalk (docs/target-coa-role-crosswalk.md). Nothing here moves a company
 * onto that chart; it proves the map is ready and refuses to guess.
 */
interface WorkbookAccount {
  'GL Code': string;
  'Control Account': string;
  'Posting Account': string;
  'Developer Note'?: string | null;
}
interface WorkbookMap {
  Application: string;
  'Posting Group': string;
  'Posting Key': string;
  'GL Code': string;
  Status: string;
}
const workbook = JSON.parse(
  readFileSync(join(__dirname, '../../../../packages/database/src/approved-posting-engine.json'), 'utf8'),
) as { sheets: { accounts: WorkbookAccount[]; accountMaps: WorkbookMap[] } };
const accounts = new Map(workbook.sheets.accounts.map((a) => [a['GL Code'], a]));
/** The company-wide application's active map: `group/key` → GL code. */
const coreMap = new Map(
  workbook.sheets.accountMaps
    .filter((m) => m.Application === 'YifrehCore' && m.Status === 'Active')
    .map((m) => [`${m['Posting Group']}/${m['Posting Key']}`, m['GL Code']]),
);

/** The workbook posting group and key each role is taken from. */
const WORKBOOK_SOURCE: Partial<Record<AccountRole, string>> = {
  bank: 'COR-BANK-MAIN/BANK',
  receivables: 'COR-CUST-LOCAL/AR_CONTROL',
  rawMaterials: 'COR-RM/INVENTORY_CONTROL',
  feedInventory: 'COR-RM/FARM_FEED_INVENTORY',
  inputVat: 'COR-VAT-IN/INPUT_VAT',
  whtReceivable: 'COR-WHT-SUP-2/WHT_RECEIVABLE',
  ppe: 'COR-FA-EQUIP/FA_COST',
  accumulatedDepreciation: 'COR-FA-EQUIP/ACCUMULATED_DEPRECIATION',
  salaryPayable: 'COR-PAYROLL/PAYROLL_PAYABLE',
  nsitfPayable: 'COR-FIN-DEFAULT/ACCRUAL_CONTROL',
  itfPayable: 'COR-FIN-DEFAULT/ACCRUAL_CONTROL',
  outputVat: 'COR-VAT-OUT/OUTPUT_VAT',
  whtPayable: 'COR-WHT-SUP-2/WHT_PAYABLE',
  grni: 'COR-RM/GRNI',
  tradePayables: 'COR-VEND-LOCAL/AP_CONTROL',
  retainedEarnings: 'COR-FIN-DEFAULT/RETAINED_EARNINGS',
  salaryExpense: 'COR-PAYROLL/LABOUR_EXPENSE',
  employerPensionExpense: 'COR-PAYROLL/LABOUR_EXPENSE',
  nsitfExpense: 'COR-PAYROLL/LABOUR_EXPENSE',
  itfExpense: 'COR-PAYROLL/LABOUR_EXPENSE',
  operatingExpenses: 'COR-SVC-ADMIN/SERVICE_EXPENSE',
  depreciationExpense: 'COR-FA-EQUIP/DEPRECIATION_EXPENSE',
};

const roles = Object.keys(ROLE_ACCOUNTS) as AccountRole[];
/** Roles with no account at all. None now: the three the workbook lacked have engineering-proposed accounts. */
const UNRESOLVED: AccountRole[] = [];
/** Engineering-proposed additions to the workbook chart, pending Finance's confirmation (docs/finance-signoff-pack.md). */
const PROPOSED: Array<[AccountRole, string]> = [['impairmentLoss', '52800'], ['fgCapitalisedVariance', '12490'], ['wipCapitalisedVariance', '13190']];

describe('approved five-digit chart roles', () => {
  it("takes every role from the workbook's own account map", () => {
    for (const [role, source] of Object.entries(WORKBOOK_SOURCE) as [AccountRole, string][]) {
      expect(coreMap.get(source), `${source} is an active workbook map`).toBeDefined();
      expect(ROLE_ACCOUNTS[role][2], `${role} ← ${source}`).toBe(coreMap.get(source));
    }
  });

  it('maps every resolved role to an account the workbook defines', () => {
    for (const role of roles.filter((r) => !UNRESOLVED.includes(r))) {
      const number = ROLE_ACCOUNTS[role][2];
      expect(number, role).toMatch(/^\d{5}$/);
      expect(accounts.has(number!), `${role} → ${number} is in the workbook`).toBe(true);
    }
  });

  it('answers the three roles the workbook lacked with accounts marked as proposed, and no role is unresolved', () => {
    expect(UNRESOLVED).toEqual([]);
    for (const [role, number] of PROPOSED) {
      expect(numberFor('APPROVED', role), role).toBe(number);
      const row = accounts.get(number)!;
      expect(row['Posting Account'], number).toBe('Yes');
      expect(String(row['Developer Note']), `${number} says it is a proposal`).toMatch(/pending Finance confirmation/);
    }
  });

  it('keeps payroll and tax liabilities on the control accounts the workbook flags', () => {
    for (const role of ['bank', 'receivables', 'salaryPayable', 'payePayable', 'outputVat', 'grni', 'tradePayables'] as const) {
      expect(accounts.get(numberFor('APPROVED', role))!['Control Account'], role).toBe('Yes');
    }
    expect(accounts.get(numberFor('APPROVED', 'depreciationExpense'))!['Posting Account']).toBe('Yes');
  });

  it('leaves the LEGACY and SPEC columns exactly as they were', () => {
    expect(numberFor('LEGACY', 'tradePayables')).toBe('2201');
    expect(numberFor('SPEC', 'tradePayables')).toBe('210100');
    expect(numberFor('APPROVED', 'tradePayables')).toBe('20100');
    expect(numberFor('SPEC', 'impairmentLoss')).toBe('630200');
  });

  it('resolves species purposes that depend on species alone, and refuses rearing cost', () => {
    for (const [role, bySpecies] of Object.entries(APPROVED_SPECIES_ACCOUNTS)) {
      for (const number of Object.values(bySpecies)) expect(accounts.has(number), `${role} → ${number}`).toBe(true);
    }
    expect(speciesNumberFor('APPROVED', 'liveRevenue', 'snail')).toBe('40210');
    expect(speciesNumberFor('APPROVED', 'productionLoss', 'poultry')).toBe('51120');
    expect(() => speciesNumberFor('APPROVED', 'rearingCost', 'poultry')).toThrow(UnresolvedApprovedAccount);
    expect(speciesNumberFor('SPEC', 'rearingCost', 'snail')).toBeNull();
  });

  it('reads a stored chart version, treating anything unknown as the old chart', () => {
    expect(parseChartVersion('APPROVED')).toBe('APPROVED');
    expect(parseChartVersion('SPEC')).toBe('SPEC');
    expect(parseChartVersion('whatever')).toBe('LEGACY');
    expect(parseChartVersion(undefined)).toBe('LEGACY');
  });

  it('holds poultry rearing cost in the asset on both client charts and snails nowhere', () => {
    expect(holdsRearingInAsset('LEGACY', 'poultry')).toBe(false);
    expect(holdsRearingInAsset('SPEC', 'poultry')).toBe(true);
    expect(holdsRearingInAsset('APPROVED', 'poultry')).toBe(true);
    expect(holdsRearingInAsset('APPROVED', 'snail')).toBe(false);
  });

  it('reports which roles the approved chart can and cannot answer', () => {
    const everything = approvedRoleReadiness(() => true);
    expect(everything.filter((r) => r.state !== 'ready').map((r) => r.role).sort()).toEqual([]);
    expect(everything.find((r) => r.role === 'rearingCost:poultry')!.number).toBe('16032/16042');
    // Poultry rearing cost needs both stage accounts.
    expect(approvedRoleReadiness((n) => n !== '16042').find((r) => r.role === 'rearingCost:poultry')!.state).toBe('missing-account');
    const emptyChart = approvedRoleReadiness(() => false);
    expect(emptyChart.find((r) => r.role === 'grni')).toEqual({ role: 'grni', number: '20300', state: 'missing-account' });
    expect(emptyChart.find((r) => r.role === 'impairmentLoss')).toEqual({ role: 'impairmentLoss', number: '52800', state: 'missing-account' });
  });

  it('holds poultry rearing cost by the flock stage at posting, and snail inputs in expense', () => {
    for (const stage of ['Chick', 'Grower', 'Pullet', 'Cockerel']) expect(poultryStageAccountNumber(stage), stage).toBe('16032');
    for (const stage of ['Market-ready', 'Point-of-lay', 'Layer', 'Broiler', 'Breeder']) expect(poultryStageAccountNumber(stage), stage).toBe('16042');
    expect(() => poultryStageAccountNumber('Egg')).toThrow(UnresolvedApprovedAccount);
    expect(rearingNumberFor('APPROVED', 'poultry', 'Chick')).toBe('16032');
    expect(rearingNumberFor('APPROVED', 'snail', 'Grower')).toBeNull();
    expect(rearingNumberFor('SPEC', 'poultry', 'Chick')).toBe('130210');
    expect(rearingNumberFor('LEGACY', 'poultry', 'Layer')).toBe('1501');
    expect(rearingNumbersFor('APPROVED', 'poultry')).toEqual(['16032', '16042']);
    expect(rearingNumbersFor('SPEC', 'snail')).toEqual([]);
    expect(snailInputExpenseNumber('APPROVED', 'feed')).toBe('52610');
    expect(snailInputExpenseNumber('APPROVED', 'treatment')).toBe('52510');
    expect(snailInputExpenseNumber('SPEC', 'feed')).toBe('611000');
    expect(snailLabourExpenseNumber('APPROVED')).toBe('52010');
    expect(snailLabourExpenseNumber('LEGACY')).toBe('612000');
  });

  it('checks every stage account against the workbook', () => {
    for (const number of ['16032', '16042', '52610', '52510', '52010']) expect(accounts.has(number), number).toBe(true);
  });

  it("takes the egg accounts from the workbook's own maps, and flags the one it had to propose", () => {
    const poultry = new Map(
      workbook.sheets.accountMaps
        .filter((m) => m.Application === 'YifrehPoultry' && m.Status === 'Active')
        .map((m) => [`${m['Posting Group']}/${m['Posting Key']}`, m['GL Code']]),
    );
    const egg = eggAccountsFor('APPROVED');
    expect(egg.inventory).toBe(poultry.get('PLP-FG-EGG/FINISHED_GOODS_INVENTORY'));
    expect(egg.costOfSales).toBe(poultry.get('PLP-FG-EGG/COGS'));
    expect(egg.revenue).toBe(poultry.get('PLP-SALES-EGG/SALES_REVENUE'));
    expect(egg.gain).toBe(poultry.get('PLP-BA-IMM/BA_FAIR_VALUE_GAIN'));
    // Day-old chicks come in at the immature poultry account the workbook names for recognition/birth/hatch.
    expect(hatchedChickAccountNumber('APPROVED', 'Chick')).toBe(poultry.get('PLP-BA-IMM/BA_SOURCE_STAGE_CONTROL'));
    // Eggs in incubation: no workbook map, so a proposal — it must at least exist as a control account.
    expect(accounts.get(egg.incubation)).toMatchObject({ 'Control Account': 'Yes' });
    for (const number of [egg.inventory, egg.gain, egg.revenue!, egg.costOfSales!]) expect(accounts.has(number), number).toBe(true);
  });

  it('leaves the egg accounts on the old charts as they were', () => {
    for (const version of ['LEGACY', 'SPEC'] as const) {
      expect(eggAccountsFor(version)).toEqual({ inventory: '130215', gain: '420210', incubation: '130216', revenue: null, costOfSales: null });
      expect(hatchedChickAccountNumber(version, 'Chick')).toBe('130210');
    }
  });

  it("takes valuation, mortality and stage accounts from the workbook's own maps", () => {
    const map = (application: string) =>
      new Map(
        workbook.sheets.accountMaps
          .filter((m) => m.Application === application && m.Status === 'Active')
          .map((m) => [`${m['Posting Group']}/${m['Posting Key']}`, m['GL Code']]),
      );
    for (const [species, application, group] of [['poultry', 'YifrehPoultry', 'PLP'], ['snail', 'YifrehSnail', 'SNP']] as const) {
      const maps = map(application);
      expect(biologicalResultAccountsFor('APPROVED', species), species).toEqual({
        gain: maps.get(`${group}-BA-IMM/BA_FAIR_VALUE_GAIN`),
        loss: maps.get(`${group}-BA-IMM/BA_FAIR_VALUE_LOSS`),
        normalMortality: maps.get(`${group}-BA-IMM/NORMAL_MORTALITY_LOSS`),
        abnormalMortality: maps.get(`${group}-BA-IMM/ABNORMAL_MORTALITY_LOSS`),
      });
      // Immature and mature stage accounts are the workbook's two livestock controls.
      expect(biologicalStageAccountNumber(species, species === 'poultry' ? 'Grower' : 'Egg')).toBe(maps.get(`${group}-BA-IMM/BA_CONTROL`));
      expect(biologicalStageAccountNumber(species, species === 'poultry' ? 'Layer' : 'Market-ready')).toBe(maps.get(`${group}-BA-MAT/BA_DESTINATION_STAGE_CONTROL`));
    }
    // Gain and loss are separate accounts: income and expense.
    expect(accounts.get('42000')).toMatchObject({ 'Posting Account': 'Yes' });
    expect(() => snailStageAccountNumber('Larva')).toThrow(UnresolvedApprovedAccount);
  });

  it('leaves valuation and mortality results on the old charts as one account per species', () => {
    expect(biologicalResultAccountsFor('LEGACY', 'poultry')).toBeNull();
    expect(biologicalResultAccountsFor('SPEC', 'snail')).toBeNull();
  });

  describe('production and processing keys', () => {
    const control = JSON.parse(readFileSync(join(__dirname, '../../../../packages/database/src/posting-control.json'), 'utf8')) as {
      keys: Array<{ key: string }>;
    };
    const keyNames = new Set(control.keys.map((k) => k.key));
    const mapBySource = (source: string) => {
      const [group, key] = source.split(' ');
      const rows = workbook.sheets.accountMaps.filter((m) => m['Posting Group'] === group && m['Posting Key'] === key && m.Status === 'Active');
      return new Set(rows.map((m) => m['GL Code']));
    };

    it('names only keys the posting rules actually use', () => {
      for (const key of Object.keys(APPROVED_POSTING_KEYS)) expect(keyNames.has(key), key).toBe(true);
    });

    it('takes every workbook-sourced key from the workbook map it cites', () => {
      for (const [key, { account, source }] of Object.entries(APPROVED_POSTING_KEYS)) {
        if (!/^[A-Z]{3}-[A-Z-]+ [A-Z_]+/.test(source)) continue; // crosswalk-sourced, below
        expect(mapBySource(source), `${key} ← ${source}`).toEqual(new Set([account]));
      }
    });

    it('takes every crosswalk-sourced key from the review crosswalk, and every account exists in the workbook', () => {
      const crosswalk = readFileSync(join(__dirname, '../../../../docs/approved-coa-crosswalk-review.csv'), 'utf8');
      for (const [key, { account, source }] of Object.entries(APPROVED_POSTING_KEYS)) {
        expect(accounts.has(account), `${key} → ${account}`).toBe(true);
        const match = source.match(/^crosswalk (\d{6}) → (\d{5})/);
        if (!match) continue;
        expect(match[2], key).toBe(account);
        expect(crosswalk.includes(`"${match[1]}"`), `${match[1]} is in the crosswalk`).toBe(true);
      }
    });

    it('keeps the control and posting flags the engine relies on', () => {
      // WIP, finished goods, recovery and ingredient stock are controls (module-posted only); expenses and variances post.
      for (const account of ['13110', '13120', '13200', '12410', '12420', '12450', '54000', '54100', '54200', '54300']) {
        expect(accounts.get(account), account).toMatchObject({ 'Control Account': 'Yes', 'Posting Account': 'No' });
      }
      for (const account of ['51200', '52110', '52120', '52200', '52400', '52700', '53500', '53600']) {
        expect(accounts.get(account), account).toMatchObject({ 'Control Account': 'No', 'Posting Account': 'Yes' });
      }
    });

    it('credits recovery by routing resource, one feed-mill account, and keeps the old charts’ WIP numbers', () => {
      expect([recoveryNumberFor('LABOUR'), recoveryNumberFor('MACHINE'), recoveryNumberFor('OVERHEAD'), recoveryNumberFor('DEPRECIATION')]).toEqual(['54000', '54100', '54200', '54100']);
      expect(APPROVED_FEED_MILL_RECOVERY).toBe('54300');
      expect(APPROVED_OVERHEAD_POOL).toBe('52200');
      expect(accrualNumberFor('APPROVED')).toBe('20200');
      expect(accrualNumberFor('SPEC')).toBeNull();
      expect(processingWipNumbers('APPROVED')).toEqual({ SNAILPRO: '13110', POULTRYPRO: '13120', FEED_MILL: '13200' });
      expect(processingWipNumbers('SPEC')).toEqual({ SNAILPRO: '130410', POULTRYPRO: '130420', FEED_MILL: '130430' });
      expect(processingOverheadNumber('APPROVED', 'POULTRYPRO')).toBe('52400');
      expect(processingOverheadNumber('APPROVED', 'FEED_MILL')).toBe('52700');
      expect(processingOverheadNumber('LEGACY', 'SNAILPRO')).toBe('621200');
    });
  });

  it("takes the sales and procurement configuration defaults from the workbook's own maps", () => {
    expect(APPROVED_SALES_DEFAULTS).toEqual({
      receivable: coreMap.get('COR-CUST-LOCAL/AR_CONTROL'),
      revenue: coreMap.get('COR-FIN-DEFAULT/INCOME_ACCOUNT'),
      costOfSales: coreMap.get('COR-FG/COGS'),
      inventory: coreMap.get('COR-FG/FINISHED_GOODS_INVENTORY'),
      whtReceivable: coreMap.get('COR-WHT-SUP-2/WHT_RECEIVABLE'),
    });
    expect(APPROVED_PROCUREMENT_DEFAULTS).toEqual({
      grni: coreMap.get('COR-RM/GRNI'),
      payables: coreMap.get('COR-VEND-LOCAL/AP_CONTROL'),
      whtPayable: coreMap.get('COR-WHT-SUP-2/WHT_PAYABLE'),
    });
    // Revenue and cost of sales post directly; receivables, payables, GRNI and inventory are module-posted controls.
    for (const account of [APPROVED_SALES_DEFAULTS.revenue, APPROVED_SALES_DEFAULTS.costOfSales]) {
      expect(accounts.get(account), account).toMatchObject({ 'Control Account': 'No', 'Posting Account': 'Yes' });
    }
    for (const account of [APPROVED_SALES_DEFAULTS.receivable, APPROVED_SALES_DEFAULTS.inventory, APPROVED_PROCUREMENT_DEFAULTS.grni, APPROVED_PROCUREMENT_DEFAULTS.payables]) {
      expect(accounts.get(account), account).toMatchObject({ 'Control Account': 'Yes', 'Posting Account': 'No' });
    }
  });
});
