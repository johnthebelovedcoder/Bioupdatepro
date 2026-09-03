import 'server-only';
import { api } from './api';

export interface ManualJournalRow {
  id: string;
  reference: string;
  journalDate: string;
  narration: string;
  status: string;
  journalType: string;
  reasonCode: string | null;
  raisedBy: string;
  totalDebitKobo: string;
  totalCreditKobo: string;
  journalEntryId: string | null;
  reversalOf: string | null;
  reversedBy: string | null;
  scheduledReversalDate: string | null;
}

export interface RecurringJournalRow {
  id: string;
  code: string;
  name: string;
  journalType: string;
  basis: string;
  frequency: string;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  active: boolean;
  amountKobo: string;
}

export async function getManualJournals(): Promise<ManualJournalRow[]> {
  try {
    return await api<ManualJournalRow[]>('/journal/register');
  } catch {
    return [];
  }
}

export async function getRecurringJournals(): Promise<RecurringJournalRow[]> {
  try {
    return await api<RecurringJournalRow[]>('/journal/recurring');
  } catch {
    return [];
  }
}

export interface GlAccountOption {
  id: string;
  accountNumber: string;
  name: string;
}

export async function getGlAccounts(): Promise<GlAccountOption[]> {
  try {
    return await api<GlAccountOption[]>('/masters/gl-accounts');
  } catch {
    return [];
  }
}

export interface ReasonCodeOption {
  code: string;
  name: string;
  journalTypeId: string | null;
}

export async function getReasonCodes(): Promise<ReasonCodeOption[]> {
  try {
    return await api<ReasonCodeOption[]>('/journal/reason-codes');
  } catch {
    return [];
  }
}
