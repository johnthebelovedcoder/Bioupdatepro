import 'server-only';
import { api, ApiError } from './api';

/**
 * Tax (Consolidated Reference §4) — the filing calendar, the VAT and WHT
 * registers, and the proof that each register agrees with the ledger.
 *
 * A tax period is not a financial period. A VAT return covers a calendar month
 * with a statutory due date and is filed with an authority; a financial period
 * is closed for management reporting. The two screens are kept apart for the
 * same reason the API keeps them apart.
 */

export type TaxType = 'VAT' | 'WHT';
export type TaxPeriodStatus = 'OPEN' | 'CLOSED' | 'FILED';

export interface TaxPeriod {
  id: string;
  taxType: TaxType;
  year: number;
  periodNumber: number;
  name: string;
  startDate: string;
  endDate: string;
  dueDate: string;
  status: TaxPeriodStatus;
  filedAt: string | null;
  filingReference: string | null;
}

export interface VatRegister {
  summary: {
    outputTaxKobo: string;
    outputTurnoverKobo: string;
    inputTaxRecoverableKobo: string;
    inputTaxIrrecoverableKobo: string;
    inputPurchasesKobo: string;
    netPayableKobo: string;
  };
  entries: Array<{
    documentDate: string;
    documentReference: string;
    direction: 'INPUT' | 'OUTPUT';
    treatment: string;
    taxCode: string;
    counterparty: string | null;
    counterpartyTin: string | null;
    taxableBaseKobo: string;
    taxKobo: string;
    appliedRate: string;
    recoverable: boolean;
    journalEntryId: string | null;
  }>;
}

export interface WhtRegister {
  summary: {
    payableKobo: string;
    receivableKobo: string;
    payableByCategory: Array<{ category: string; amountKobo: string }>;
    receivableWithoutCreditNote: number;
  };
  entries: Array<{
    documentDate: string;
    documentReference: string;
    direction: 'PAYABLE' | 'RECEIVABLE';
    whtCategory: string;
    taxCode: string;
    counterparty: string | null;
    counterpartyTin: string | null;
    grossAmountKobo: string;
    taxableBaseKobo: string;
    taxKobo: string;
    appliedRate: string;
    creditNoteReference: string | null;
    journalEntryId: string | null;
  }>;
}

export interface TaxReconciliation {
  taxPeriodId: string;
  periodName: string;
  agrees: boolean;
  lines: Array<{
    direction: string;
    glAccountNumber: string;
    glAccountName: string;
    registerTaxKobo: string;
    ledgerBalanceKobo: string;
    differenceKobo: string;
    agrees: boolean;
  }>;
}

export interface TaxCode {
  id: string;
  code: string;
  name: string;
  taxType: TaxType;
}

/**
 * A read that can fail for a reason worth showing.
 *
 * Tax is narrower than the rest of Books — Finance Manager, Finance Controller
 * and CFO only — so a Farm Accountant who can open Books gets a 403 here. That
 * refusal is shown as what it is, not as an empty calendar that looks like
 * nothing was ever set up.
 */
export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

async function load<T>(path: string): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await api<T>(path) };
  } catch (caught) {
    if (caught instanceof ApiError) return { ok: false, error: caught.message };
    throw caught;
  }
}

export function getTaxPeriods(): Promise<Loaded<TaxPeriod[]>> {
  return load<TaxPeriod[]>('/tax/periods');
}

export function getVatRegister(taxPeriodId: string): Promise<Loaded<VatRegister>> {
  return load<VatRegister>(`/tax/vat/register?taxPeriodId=${encodeURIComponent(taxPeriodId)}`);
}

export function getWhtRegister(taxPeriodId: string): Promise<Loaded<WhtRegister>> {
  return load<WhtRegister>(`/tax/wht/register?taxPeriodId=${encodeURIComponent(taxPeriodId)}`);
}

export function getTaxReconciliation(taxPeriodId: string): Promise<Loaded<TaxReconciliation>> {
  return load<TaxReconciliation>(
    `/tax/reconciliation?taxPeriodId=${encodeURIComponent(taxPeriodId)}`,
  );
}

export async function getTaxCodes(): Promise<TaxCode[]> {
  try {
    return await api<TaxCode[]>('/masters/tax-codes');
  } catch {
    return [];
  }
}

/** A stored rate — always a fraction, "0.07500000" — as a person reads it: "7.5%". */
export function formatRate(rate: string): string {
  const value = Number(rate);
  if (!Number.isFinite(value)) return rate;
  return `${Number((value * 100).toFixed(4))}%`;
}
