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
