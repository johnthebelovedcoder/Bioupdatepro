import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AccountType, NormalBalance, Prisma } from '@bioassetpro/database';

/**
 * The client's approved posting-engine workbook, read once and shared.
 *
 * `packages/database/src/approved-posting-engine.json` is an extract of
 * YIFRE_Posting_Engine_Final_Implementation_Ready_01102026.xlsx: 137 five-digit
 * accounts with their IFRS captions, posting and control flags and cost-centre
 * rules, plus the account maps, posting-control lines and 57 cost centres. It
 * is read at runtime rather than copied into TypeScript — 116 KB of workbook
 * transcribed by hand is exactly the drift the file exists to prevent.
 *
 * Two callers need it and neither should own it: the posting-control
 * provisioning service, which loads the whole engine into an existing company,
 * and company provisioning, which gives a brand-new farm the chart on day one.
 */

export type ApprovedRow = Record<string, string | number | null>;

export interface ApprovedWorkbook {
  source: string;
  sheets: {
    accounts: ApprovedRow[];
    postingControls: ApprovedRow[];
    postingKeys: ApprovedRow[];
    postingGroups: ApprovedRow[];
    accountMaps: ApprovedRow[];
    costCentres: ApprovedRow[];
  };
}

/**
 * Where the workbook extracts live, found by walking up from this file.
 *
 * The API runs from `dist/` in production and from `src/` under vitest, and the
 * JSON is neither compiled nor copied, so the path cannot be relative to either.
 */
export function databaseSrcDir(from: string = __dirname): string {
  let dir = from;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'packages', 'database', 'src');
    if (existsSync(join(candidate, 'approved-posting-engine.json'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`Could not find packages/database/src from ${from}.`);
}

let cached: ApprovedWorkbook | null = null;

export function loadApprovedWorkbook(): ApprovedWorkbook {
  if (cached) return cached;
  const file = join(databaseSrcDir(), 'approved-posting-engine.json');
  cached = JSON.parse(readFileSync(file, 'utf8')) as ApprovedWorkbook;
  return cached;
}

export function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function yes(value: unknown): boolean {
  return text(value).toLowerCase() === 'yes';
}

export function intValue(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) ? number : 0;
}

export function dateValue(value: unknown): Date | null {
  const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
  return date && Number.isFinite(date.getTime())
    ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    : null;
}

export function approvedAccountType(type: string, code: string): AccountType {
  const kind = type.toLowerCase();
  if (kind === 'asset' || kind === 'contra asset') return AccountType.ASSET;
  if (kind === 'liability') return AccountType.LIABILITY;
  if (kind === 'equity') return AccountType.EQUITY;
  if (kind === 'income') return AccountType.REVENUE;
  if (kind === 'expense' || kind === 'contra expense') return AccountType.EXPENSE;
  // Mixed settlement/clearing and suspense accounts are non-posting by policy;
  // their statement class follows the approved balance-sheet caption.
  if (kind === 'asset/liability') return code.startsWith('1') ? AccountType.ASSET : AccountType.LIABILITY;
  throw new Error(`Unsupported approved COA account type "${type}" for ${code}.`);
}

/** The workbook's active accounts, as the GL rows a company should carry. */
export function approvedAccountRows(
  companyId: string,
  workbook: ApprovedWorkbook = loadApprovedWorkbook(),
): Prisma.GLAccountCreateManyInput[] {
  return workbook.sheets.accounts
    .filter((row) => text(row.Status) === 'Active')
    .map((row) => {
      const accountNumber = text(row['GL Code']);
      return {
        companyId,
        accountNumber,
        name: text(row['GL Name']),
        accountType: approvedAccountType(text(row['Account Type']), accountNumber),
        normalBalance: text(row['Normal Balance']).toLowerCase().startsWith('credit')
          ? NormalBalance.CREDIT
          : NormalBalance.DEBIT,
        isPostingAccount: yes(row['Posting Account']),
        isControlAccount: yes(row['Control Account']),
        manualJournalAllowed: yes(row['Manual Journal']),
        approvedStatement: text(row.Statement),
        ifrsCategory: text(row['IFRS Category']),
        ifrsLine: text(row['IFRS Line / Subcategory']),
        approvedPostingGroup: text(row['Posting Group']),
        applicationScope: text(row['Application Scope']),
        businessStream: text(row['Business Stream']),
        legalEntityScope: text(row['Legal Entity']),
        costCentreRule: text(row['Cost Centre Rule']),
        approvedEffectiveFrom: dateValue(row['Effective Date']),
        requiresCostCentre: text(row['Cost Centre Rule']).toLowerCase().startsWith('required'),
        active: true,
      };
    });
}

export interface ApprovedCostCentre {
  code: string;
  name: string;
  parentCode: string | null;
  approvedApplication: string;
  businessUnit: string;
  functionName: string;
  activityStage: string;
  location: string;
  responsibilityOwner: string;
  postingAllowed: boolean;
  active: boolean;
}

/** The workbook's cost centres, parents before children so a parent can be linked. */
export function approvedCostCentres(
  workbook: ApprovedWorkbook = loadApprovedWorkbook(),
): ApprovedCostCentre[] {
  const rows = workbook.sheets.costCentres.map((row) => ({
    code: text(row['Cost Centre Code']),
    name: text(row['Cost Centre Name']),
    parentCode: text(row['Parent Cost Centre']) || null,
    approvedApplication: text(row.Application),
    businessUnit: text(row['Business Unit']),
    functionName: text(row.Function),
    activityStage: text(row['Activity or Stage']),
    location: text(row.Location),
    responsibilityOwner: text(row['Responsibility Owner']),
    postingAllowed: yes(row['Posting Allowed']),
    active: text(row.Status) === 'Active',
  }));

  // A child must not be created before its parent. The workbook happens to
  // list them that way; sorting makes it true whatever order it arrives in.
  const placed: ApprovedCostCentre[] = [];
  const seen = new Set<string>();
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const place = (row: ApprovedCostCentre, guard = 0): void => {
    if (seen.has(row.code) || guard > rows.length) return;
    const parent = row.parentCode ? byCode.get(row.parentCode) : undefined;
    if (parent && !seen.has(parent.code)) place(parent, guard + 1);
    seen.add(row.code);
    placed.push(row);
  };
  rows.forEach((row) => place(row));
  return placed;
}
