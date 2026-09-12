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

export async function prepareChecklist(periodId: string): Promise<FlowState> {
  try {
    await api(`/period/${periodId}/checklist/prepare`, { method: 'POST' });
  } catch (caught) {
    return fail(caught, 'Could not prepare the checklist.');
  }
  revalidatePath(`/ledger/period-close/${periodId}`);
  return { error: null, message: 'Checklist prepared.' };
}

export async function settleChecklistItem(
  periodId: string,
  checklistId: string,
  status: 'COMPLETE' | 'WAIVED' | 'FAILED',
  comments: string,
): Promise<FlowState> {
  if (status === 'WAIVED' && !comments.trim()) {
    return { error: 'Waiving a step requires a reason.', message: null };
  }
  try {
    await api(`/period/checklist/${checklistId}`, {
      method: 'POST',
      body: { status, comments: comments.trim() || undefined },
    });
  } catch (caught) {
    return fail(caught, 'Could not update that checklist item.');
  }
  revalidatePath(`/ledger/period-close/${periodId}`);
  return { error: null, message: 'Updated.' };
}

export async function softCloseOrClose(
  periodId: string,
  action: 'soft-close' | 'close',
  reason: string,
): Promise<FlowState> {
  try {
    await api(`/period/${periodId}/${action}`, {
      method: 'POST',
      body: { reason: reason.trim() || undefined },
    });
  } catch (caught) {
    return fail(caught, action === 'close' ? 'Could not close the period.' : 'Could not soft-close the period.');
  }
  revalidatePath(`/ledger/period-close/${periodId}`);
  revalidatePath('/ledger/period-close');
  return { error: null, message: action === 'close' ? 'Period closed.' : 'Period soft-closed.' };
}

export async function requestReopen(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const periodId = String(formData.get('periodId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!reason) return { error: 'Say why this period needs to be reopened.', message: null };

  try {
    await api(`/period/${periodId}/request-reopen`, { method: 'POST', body: { reason } });
  } catch (caught) {
    return fail(caught, 'Could not raise a reopen request.');
  }
  revalidatePath(`/ledger/period-close/${periodId}`);
  return { error: null, message: 'Reopen requested — sent for approval.' };
}

export async function approveReopen(periodId: string, requestId: string): Promise<FlowState> {
  try {
    await api(`/period/reopen-requests/${requestId}/approve`, { method: 'POST' });
  } catch (caught) {
    return fail(caught, 'Could not approve that request.');
  }
  revalidatePath(`/ledger/period-close/${periodId}`);
  return { error: null, message: 'Approved.' };
}

export async function reopenPeriod(periodId: string, requestId: string): Promise<FlowState> {
  try {
    await api(`/period/reopen-requests/${requestId}/reopen`, { method: 'POST' });
  } catch (caught) {
    return fail(caught, 'Could not reopen the period.');
  }
  revalidatePath(`/ledger/period-close/${periodId}`);
  revalidatePath('/ledger/period-close');
  return { error: null, message: 'Period reopened.' };
}
