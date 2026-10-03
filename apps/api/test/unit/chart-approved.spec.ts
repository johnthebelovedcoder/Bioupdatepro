import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APPROVED_SPECIES_ACCOUNTS,
  ROLE_ACCOUNTS,
  UnresolvedApprovedAccount,
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
const workbook = JSON.parse(
  readFileSync(join(__dirname, '../../../../packages/database/src/approved-posting-engine.json'), 'utf8'),
) as { sheets: { accounts: WorkbookAccount[] } };
const accounts = new Map(workbook.sheets.accounts.map((a) => [a['GL Code'], a]));

const roles = Object.keys(ROLE_ACCOUNTS) as AccountRole[];
/** Roles whose account depends on the item, asset, stage or liability behind the posting. */
const CONTEXT_DEPENDENT: AccountRole[] = [
  'rawMaterials', 'ppe', 'accumulatedDepreciation', 'nsitfPayable', 'itfPayable', 'salaryExpense',
  'employerPensionExpense', 'nsitfExpense', 'itfExpense', 'operatingExpenses', 'impairmentLoss',
  'fgCapitalisedVariance', 'wipCapitalisedVariance',
];

describe('approved five-digit chart roles', () => {
  it('maps every direct role to an account the workbook defines', () => {
    for (const role of roles.filter((r) => !CONTEXT_DEPENDENT.includes(r))) {
      const number = ROLE_ACCOUNTS[role][2];
      expect(number, role).toMatch(/^\d{5}$/);
      expect(accounts.has(number!), `${role} → ${number} is in the workbook`).toBe(true);
    }
  });

  it('leaves context-dependent roles unresolved and refuses them rather than guessing', () => {
    for (const role of CONTEXT_DEPENDENT) {
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
});
