'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface FlowState {
  error: string | null;
  message: string | null;
}

function fail(caught: unknown, fallback: string): FlowState {
  return { error: caught instanceof ApiError ? caught.message : fallback, message: null };
}

/**
 * Lend your own approval authority to a colleague for a window — the fix for
 * a document stuck because the only holder of a role also raised it. The
 * delegate acts as themselves; Rule 4 still refuses them their own document.
 */
export async function grantDelegation(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const delegateId = String(formData.get('delegateId') ?? '');
  const startDate = String(formData.get('startDate') ?? '');
  const endDate = String(formData.get('endDate') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  if (!delegateId) return { error: 'Choose who this goes to.', message: null };
  if (!startDate) return { error: 'Choose when this starts.', message: null };
  if (!endDate) return { error: 'Choose when this ends.', message: null };
  if (!reason) return { error: 'Say why — leave, travel, a stuck document.', message: null };

  try {
    await api('/workflow/delegate', {
      method: 'POST',
      body: { delegateId, startDate, endDate, reason },
    });
  } catch (caught) {
    return fail(caught, 'Could not grant that delegation.');
  }

  revalidatePath('/approvals/delegations');
  return { error: null, message: 'Granted. They can now act in your place for anything you could, until it ends.' };
}

/** Withdraw authority you lent. Only the person who granted it, or an administrator, may do this. */
export async function revokeDelegation(delegationId: string): Promise<FlowState> {
  try {
    await api(`/workflow/delegations/${delegationId}/revoke`, { method: 'POST' });
  } catch (caught) {
    return fail(caught, 'Could not revoke that delegation.');
  }
  revalidatePath('/approvals/delegations');
  return { error: null, message: 'Revoked.' };
}
