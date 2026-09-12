import 'server-only';
import { api } from './api';
import type { SessionUser } from './session';

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

/**
 * Everyone else active on the farm, for the "delegate to" picker — a name
 * carries no role. Excludes the caller: the backend already refuses a
 * self-delegation (Rule 4 would be pointless to lend to yourself), so
 * offering your own name here is a choice that can only ever be rejected.
 */
export async function getColleagues(): Promise<Colleague[]> {
  try {
    const [names, me] = await Promise.all([
      api<Colleague[]>('/auth/users/names'),
      api<SessionUser>('/auth/me'),
    ]);
    return names.filter((person) => person.id !== me.userId);
  } catch {
    return [];
  }
}
