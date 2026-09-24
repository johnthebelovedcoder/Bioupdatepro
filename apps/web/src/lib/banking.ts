import 'server-only';
import { api, ApiError } from './api';

export interface BankAccountRow {
  id: string;
  name: string;
  bankName: string;
  accountNumberMasked: string;
  active: boolean;
  glAccount: { id: string; accountNumber: string; name: string } | null;
  ledgerBalanceKobo: string;
  latestStatement: { periodTo: string; closingBalanceKobo: string } | null;
  unmatchedLines: number;
}

export interface Reconciliation {
  bankAccount: {
    id: string;
    name: string;
    bankName: string;
    accountNumberMasked: string;
    glAccount: { accountNumber: string; name: string };
  };
  asOf: string | null;
  statementClosingKobo: string | null;
  ledgerBalanceKobo: string;
  unclearedKobo: string;
  notInLedgerKobo: string;
  differenceKobo: string | null;
  reconciled: boolean;
  lines: Array<{
    id: string;
    valueDate: string;
    description: string;
    reference: string | null;
    amountKobo: string;
    status: 'UNMATCHED' | 'MATCHED' | 'IGNORED';
    ignoredReason: string | null;
    matchedJournal: { journalNumber: string; journalDate: string } | null;
  }>;
  uncleared: Array<{
    id: string;
    journalNumber: string;
    journalDate: string;
    description: string;
    signedKobo: string;
  }>;
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

async function load<T>(path: string): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await api<T>(path) };
  } catch (caught) {
    if (caught instanceof ApiError) return { ok: false, error: caught.message };
    throw caught;
  }
}

export const getBankAccounts = () => load<BankAccountRow[]>('/banking/accounts');
export const getReconciliation = (id: string) =>
  load<Reconciliation>(`/banking/accounts/${encodeURIComponent(id)}/reconciliation`);
