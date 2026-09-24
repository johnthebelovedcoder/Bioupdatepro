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

function refresh() {
  revalidatePath('/ledger/tax/codes');
  revalidatePath('/ledger/tax');
}

/** Add a VAT treatment or WHT category the defaults do not have. */
export async function createTaxCode(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const taxType = String(formData.get('taxType') ?? '');
  const body = {
    taxType,
    code: String(formData.get('code') ?? '').trim(),
    name: String(formData.get('name') ?? '').trim(),
    ...(taxType === 'VAT'
      ? { treatment: String(formData.get('treatment') ?? 'STANDARD') }
      : { whtCategory: String(formData.get('whtCategory') ?? '').trim() || null }),
    ratePercent: String(formData.get('ratePercent') ?? '').trim(),
    effectiveFrom: String(formData.get('effectiveFrom') ?? '').trim(),
    sourceReference: String(formData.get('sourceReference') ?? '').trim(),
  };
  if (!body.code || !body.name) return { error: 'Give the code a code and a name.', message: null };

  try {
    await api('/tax/codes', { method: 'POST', body });
  } catch (caught) {
    return fail(caught, 'Could not add that code.');
  }
  refresh();
  return { error: null, message: `${body.code.toUpperCase()} added.` };
}

/** A new rate for a code from a date; the old rate closes the day before. */
export async function setTaxRate(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const taxCodeId = String(formData.get('taxCodeId') ?? '');
  const body = {
    ratePercent: String(formData.get('ratePercent') ?? '').trim(),
    effectiveFrom: String(formData.get('effectiveFrom') ?? '').trim(),
    sourceReference: String(formData.get('sourceReference') ?? '').trim(),
  };
  if (!body.ratePercent) return { error: 'Enter the new rate.', message: null };

  try {
    await api(`/tax/codes/${taxCodeId}/rates`, { method: 'POST', body });
  } catch (caught) {
    return fail(caught, 'Could not set that rate.');
  }
  refresh();
  return { error: null, message: `New rate of ${body.ratePercent}% from ${body.effectiveFrom}.` };
}

export async function setTaxCodeActive(taxCodeId: string, active: boolean): Promise<FlowState> {
  try {
    await api(`/tax/codes/${taxCodeId}/active`, { method: 'POST', body: { active } });
  } catch (caught) {
    return fail(caught, 'Could not change that code.');
  }
  refresh();
  return { error: null, message: active ? 'Reactivated.' : 'Deactivated.' };
}
