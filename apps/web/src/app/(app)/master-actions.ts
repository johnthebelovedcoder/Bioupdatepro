'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { parseNairaToKobo } from '@/lib/money';

export interface FlowState {
  error: string | null;
  message: string | null;
}

function fail(caught: unknown, fallback: string): FlowState {
  return { error: caught instanceof ApiError ? caught.message : fallback, message: null };
}

/**
 * Activate, deactivate or block a customer or supplier.
 *
 * Blocking is the serious one — a blocked customer fails credit control and a
 * blocked supplier cannot be ordered from or paid — so the API insists on a
 * reason for it, and that reason is kept on the record.
 */
export async function setPartyStatus(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const kind = String(formData.get('kind') ?? '');
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (kind !== 'customers' && kind !== 'suppliers') return { error: 'Unknown record.', message: null };
  if (!['ACTIVE', 'INACTIVE', 'BLOCKED'].includes(status)) {
    return { error: 'Choose a status.', message: null };
  }
  if (status === 'BLOCKED' && !reason) {
    return { error: 'Say why — a block stops all trading with them.', message: null };
  }

  try {
    await api(`/masters/${kind}/${id}/status`, {
      method: 'POST',
      body: { status, ...(reason ? { reason } : {}) },
    });
  } catch (caught) {
    return fail(caught, 'Could not change that status.');
  }

  revalidatePath(kind === 'customers' ? '/customers' : '/suppliers');
  return { error: null, message: `Now ${status.toLowerCase()}.` };
}

export interface CreditCheckState {
  error: string | null;
  result: {
    passed: boolean;
    creditLimitKobo: string | null;
    outstandingKobo: string;
    availableKobo: string | null;
    reasons: string[];
  } | null;
}

/** Would a sale of this size fit inside the customer's credit limit? Records nothing. */
export async function runCreditCheck(
  _previous: CreditCheckState,
  formData: FormData,
): Promise<CreditCheckState> {
  const id = String(formData.get('id') ?? '');
  const amount = parseNairaToKobo(String(formData.get('amount') ?? ''));
  if (amount === null || amount < 0n) return { error: 'Enter the size of the sale.', result: null };

  try {
    const result = await api<NonNullable<CreditCheckState['result']>>(
      `/masters/customers/${id}/credit-check`,
      { method: 'POST', body: { proposedAmountKobo: amount.toString() } },
    );
    return { error: null, result };
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not run the check.',
      result: null,
    };
  }
}

/**
 * Set an item's standard cost from a date — what stock of it is valued at
 * until the next one. Effective-dated, so earlier valuations still stand.
 */
export async function setStandardCost(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const id = String(formData.get('id') ?? '');
  const cost = parseNairaToKobo(String(formData.get('cost') ?? ''));
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '').trim();
  const sourceReference = String(formData.get('sourceReference') ?? '').trim();
  if (cost === null || cost < 0n) return { error: 'Enter a cost in naira.', message: null };
  if (!effectiveFrom) return { error: 'Say when it takes effect.', message: null };

  try {
    await api(`/masters/items/${id}/standard-cost`, {
      method: 'POST',
      body: {
        costKobo: cost.toString(),
        effectiveFrom,
        ...(sourceReference ? { sourceReference } : {}),
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not set that cost.');
  }

  revalidatePath('/items');
  return { error: null, message: `Standard cost set from ${effectiveFrom}.` };
}
