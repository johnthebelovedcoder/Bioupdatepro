import 'server-only';
import { api } from './api';

/**
 * §2 Delegation — lending approval authority for a window, without lending
 * identity. The maker-checker rule still applies to whoever acts, delegated
 * or not: a maker who has been delegated the approver's authority still
 * cannot approve their own document.
 */
export interface Delegation {
  id: string;
  delegatorId: string;
  delegatorName: string;
  delegateId: string;
  delegateName: string;
  transactionType: string | null;
  startDate: string;
  endDate: string;
  reason: string;
  active: boolean;
  /** GRANTED: you lent this authority. RECEIVED: someone lent it to you. */
  direction: 'GRANTED' | 'RECEIVED';
}

/** Delegations you have granted, and ones lent to you. */
export async function getDelegations(): Promise<Delegation[]> {
  try {
    return await api<Delegation[]>('/workflow/delegations');
  } catch {
    return [];
  }
}

export interface Colleague {
  id: string;
  name: string;
}

/** Everyone active on the farm, for the "delegate to" picker — a name carries no role. */
export async function getColleagues(): Promise<Colleague[]> {
  try {
    return await api<Colleague[]>('/auth/users/names');
  } catch {
    return [];
  }
}
