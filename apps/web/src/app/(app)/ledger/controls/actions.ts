'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface FlowState {
  error: string | null;
  message: string | null;
}

/**
 * Record a release decision against the live control checks. Refused unless
 * every check passes, or the exceptions are acknowledged in writing — the API
 * enforces that; this only carries the words.
 */
export async function signOffRelease(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const releaseLabel = String(formData.get('releaseLabel') ?? '').trim();
  const exceptionsAcknowledged = String(formData.get('exceptionsAcknowledged') ?? '').trim();
  if (!releaseLabel) return { error: 'Name the release, e.g. "March close" or "v1.2".', message: null };

  try {
    const result = await api<{ verdict: string; releaseLabel: string }>(
      '/reporting/release-sign-off',
      {
        method: 'POST',
        body: { releaseLabel, ...(exceptionsAcknowledged ? { exceptionsAcknowledged } : {}) },
      },
    );
    revalidatePath('/ledger/controls');
    return {
      error: null,
      message:
        result.verdict === 'RELEASED'
          ? `${result.releaseLabel} signed off clean.`
          : `${result.releaseLabel} signed off with the exceptions acknowledged.`,
    };
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not record the sign-off.',
      message: null,
    };
  }
}

export interface BacklogState {
  error: string | null;
  result: {
    feedIssues: { posted: number; failed: number };
    treatments: { posted: number; failed: number };
    reasons: string[];
  } | null;
}

/**
 * Post the feeding and treatment records that reached the farm log but not
 * the ledger — a round recorded while a period was closed, or before a feed
 * item had a cost. Run by a person, not a timer: the resulting journals carry
 * whoever pressed it.
 */
export async function postOperationsBacklog(
  _previous: BacklogState,
  _formData: FormData,
): Promise<BacklogState> {
  try {
    const result = await api<NonNullable<BacklogState['result']>>('/operations/postings/retry', {
      method: 'POST',
      body: {},
    });
    revalidatePath('/ledger/controls');
    return { error: null, result };
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not post the backlog.',
      result: null,
    };
  }
}
