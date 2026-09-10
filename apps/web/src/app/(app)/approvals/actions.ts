'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface FlowState {
  error: string | null;
  message: string | null;
}

/**
 * Drive the escalation clock on demand.
 *
 * A scheduler is meant to call `POST /workflow/escalation/sweep` regularly in
 * deployment; this is the on-demand door the endpoint's own docblock already
 * names as a reason for exposing it separately, and until now nothing in the
 * app ever opened it.
 */
export async function runEscalationSweep(): Promise<FlowState> {
  try {
    const result = await api<{ reminded: number; managersNotified: number; escalated: number }>(
      '/workflow/escalation/sweep',
      { method: 'POST', body: {} },
    );
    revalidatePath('/approvals');
    return {
      error: null,
      message:
        `${result.reminded} reminder${result.reminded === 1 ? '' : 's'} sent, ` +
        `${result.managersNotified} manager${result.managersNotified === 1 ? '' : 's'} notified, ` +
        `${result.escalated} document${result.escalated === 1 ? '' : 's'} escalated.`,
    };
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not run the escalation sweep.',
      message: null,
    };
  }
}
