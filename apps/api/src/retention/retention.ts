/**
 * The record retention schedule (handbook security and records controls).
 *
 * Owned by code, like the KPI definitions: every farm keeps the same schedule,
 * and changing it is a reviewed change rather than a setting someone edits.
 *
 * Nothing here deletes anything. Posted financial records cannot be deleted at
 * all — the database refuses (sql/010 and the per-module constraint files) —
 * and a closed year is archived by the year-end close, not removed. Once a
 * record passes its minimum period it becomes *eligible for review*; whether
 * and how anything is then disposed of is the company's decision, recorded
 * outside the ledger.
 *
 * The six-year minimum follows the usual Nigerian practice for tax and
 * company records. The client's legal adviser should confirm it before
 * release (Phase 0 decisions).
 */

export interface RetentionRule {
  key: string;
  label: string;
  /** Minimum years kept, counted from the end of the calendar year of the record's date. */
  years: number;
  basis: string;
  /** What happens after the minimum: never deleted, or reviewed by the company. */
  after: string;
}

const NEVER = 'Never deleted by the application. Kept, and archived with its closed year.';
const REVIEW = 'Eligible for review by the company; the application does not delete it.';

export const RETENTION_SCHEDULE: RetentionRule[] = [
  { key: 'journals', label: 'Journal entries (the general ledger)', years: 6, basis: 'Books of account: tax and company law', after: NEVER },
  { key: 'supplierInvoices', label: 'Supplier invoices', years: 6, basis: 'Tax evidence for expenses and input VAT', after: NEVER },
  { key: 'salesInvoices', label: 'Sales invoices', years: 6, basis: 'Tax evidence for income and output VAT', after: NEVER },
  { key: 'customerReceipts', label: 'Customer receipts', years: 6, basis: 'Books of account', after: NEVER },
  { key: 'supplierPayments', label: 'Supplier payments', years: 6, basis: 'Books of account; WHT evidence', after: NEVER },
  { key: 'paymentFiles', label: 'Bank payment files', years: 6, basis: 'Evidence of what was sent to the bank', after: NEVER },
  { key: 'stockMovements', label: 'Stock movements', years: 6, basis: 'Inventory and cost of sales evidence', after: NEVER },
  { key: 'livestock', label: 'Batches and flocks (biological assets)', years: 6, basis: 'IAS 41 measurement evidence', after: NEVER },
  { key: 'payrollRuns', label: 'Payroll runs and payslips', years: 6, basis: 'PAYE, pension and NHF evidence', after: NEVER },
  { key: 'formerEmployees', label: 'Records of employees who have left', years: 6, basis: 'PAYE and pension queries after exit; counted from the exit date', after: REVIEW },
  { key: 'approvals', label: 'Approval history (workflow)', years: 6, basis: 'Evidence of authorisation for every posting', after: NEVER },
  { key: 'closeLog', label: 'Period and year close log', years: 6, basis: 'Evidence of the close', after: NEVER },
  { key: 'closePacks', label: 'Close packs (fingerprinted trial balances)', years: 6, basis: 'Audit evidence of the closed figures', after: NEVER },
  { key: 'audit', label: 'Audit trail', years: 6, basis: 'Who did what and when; append-only', after: NEVER },
];

/** The first day of the calendar year before which a record has passed its minimum period. */
export function eligibleBefore(years: number, today = new Date()): Date {
  return new Date(Date.UTC(today.getUTCFullYear() - years, 0, 1));
}
