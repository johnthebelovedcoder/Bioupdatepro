import 'server-only';
import { api } from './api';

/**
 * Period-End Closing (§8) — the checklist, the validations, and the
 * workflow-governed close/reopen. Year-end rollover is a separate, larger
 * step not covered here; this is the month-by-month close.
 */

export type PeriodStatus = 'OPEN' | 'SOFT_CLOSED' | 'CLOSED' | 'ARCHIVED';
export type ChecklistItemStatus = 'PENDING' | 'COMPLETE' | 'WAIVED' | 'FAILED';

export interface ChecklistItem {
  id: string;
  code: string;
  name: string;
  blocking: boolean;
  status: ChecklistItemStatus;
  comments: string | null;
  completedBy: string | null;
  completedAt: string | null;
}

export interface ValidationFinding {
  code: string;
  name: string;
  blocking: boolean;
  passed: boolean;
  detail: string;
}

export interface PeriodValidation {
  periodName: string;
  canClose: boolean;
  findings: ValidationFinding[];
  trialBalance: {
    balanced: boolean;
    totalDebitKobo: string;
    totalCreditKobo: string;
  };
}

export interface ReopenRequest {
  id: string;
  reason: string;
  requestedById: string;
  requestedByName: string;
  requestedAt: string;
  approvedByName: string | null;
  approvedAt: string | null;
  reopenedAt: string | null;
}

export async function getChecklist(periodId: string): Promise<ChecklistItem[]> {
  return api<ChecklistItem[]>(`/period/${periodId}/checklist`);
}

export async function prepareChecklist(periodId: string): Promise<ChecklistItem[]> {
  return api<ChecklistItem[]>(`/period/${periodId}/checklist/prepare`, { method: 'POST' });
}

export async function validatePeriod(periodId: string): Promise<PeriodValidation> {
  return api<PeriodValidation>(`/period/${periodId}/validate`);
}

export async function getReopenRequests(periodId: string): Promise<ReopenRequest[]> {
  try {
    return await api<ReopenRequest[]>(`/period/${periodId}/reopen-requests`);
  } catch {
    return [];
  }
}
