import 'server-only';
import { api } from './api';

/** A role's approval limit, as this company is actually configured — real
 * `WorkflowStep` data, not a number written into the frontend. */
export interface ApprovalLadderEntry {
  roleCode: string;
  /** Kobo, as an integer string. Null means unlimited. */
  maxAmountKobo: string | null;
}

export async function getApprovalLadder(): Promise<ApprovalLadderEntry[]> {
  return api<ApprovalLadderEntry[]>('/workflow/approval-ladder');
}

/** The maker's side of the approval queue, and the trail behind any document. */

export interface MyDocument {
  transactionId: string;
  documentReference: string;
  transactionType: string;
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'RETURNED';
  amountKobo: string;
  submittedAt: string | null;
  route: string;
  canCancel: boolean;
}

export interface HistoryEntry {
  occurredAt: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  level: number | null;
  user: string;
  onBehalfOf: string | null;
  comments: string | null;
}

export interface WorkflowDashboard {
  byStatus: Array<{ status: string; transactionType: string; count: number; totalAmountKobo: string }>;
  open: { count: number; escalated: number; oldestHours: number };
}

export async function getMyDocuments(): Promise<MyDocument[]> {
  try {
    return await api<MyDocument[]>('/workflow/mine');
  } catch {
    return [];
  }
}

export async function getHistory(transactionId: string): Promise<HistoryEntry[] | null> {
  try {
    return await api<HistoryEntry[]>(`/workflow/history/${transactionId}`);
  } catch {
    return null;
  }
}

/** Finance roles only; null for everyone else, who simply do not see the panel. */
export async function getWorkflowDashboard(): Promise<WorkflowDashboard | null> {
  try {
    return await api<WorkflowDashboard>('/workflow/dashboard');
  } catch {
    return null;
  }
}
