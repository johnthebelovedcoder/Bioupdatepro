import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPROVED_SPECIES_ACCOUNTS,
  ROLE_ACCOUNTS,
  UnresolvedApprovedAccount,
  approvedRoleReadiness,
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
/** Roles the workbook has no account for: impairment, and the POL-009 capitalised variances. */
const UNRESOLVED: AccountRole[] = ['impairmentLoss', 'fgCapitalisedVariance', 'wipCapitalisedVariance'];

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

  it('leaves roles with no workbook account unresolved and refuses them rather than guessing', () => {
    for (const role of UNRESOLVED) {
      expect(ROLE_ACCOUNTS[role][2], role).toBeNull();
      expect(() => numberFor('APPROVED', role), role).toThrow(UnresolvedApprovedAccount);
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
    expect(everything.filter((r) => r.state !== 'ready').map((r) => r.role).sort()).toEqual([
      'fgCapitalisedVariance', 'impairmentLoss', 'rearingCost:poultry', 'rearingCost:snail', 'wipCapitalisedVariance',
    ]);
    const emptyChart = approvedRoleReadiness(() => false);
    expect(emptyChart.find((r) => r.role === 'grni')).toEqual({ role: 'grni', number: '20300', state: 'missing-account' });
    expect(emptyChart.find((r) => r.role === 'impairmentLoss')!.state).toBe('no-workbook-account');
  });
});
