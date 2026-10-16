import 'server-only';
import { api, optional } from './api';

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
  return api<ManualJournalRow[]>('/journal/register');
}

export async function getRecurringJournals(): Promise<RecurringJournalRow[]> {
  return api<RecurringJournalRow[]>('/journal/recurring');
}

export interface GlAccountOption {
  id: string;
  accountNumber: string;
  name: string;
}

export async function getGlAccounts(): Promise<GlAccountOption[]> {
  return optional('the account list', () => api<GlAccountOption[]>('/masters/gl-accounts'), []);
}

export interface ReasonCodeOption {
  code: string;
  name: string;
  journalTypeId: string | null;
}

export async function getReasonCodes(): Promise<ReasonCodeOption[]> {
  return optional('the journal reason codes', () => api<ReasonCodeOption[]>('/journal/reason-codes'), []);
}
