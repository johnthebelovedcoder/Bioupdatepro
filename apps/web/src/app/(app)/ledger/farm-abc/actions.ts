'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface RateState {
  error: string | null;
  message: string | null;
}

/** Set one stage's naira-per-driver-unit weight for a pool (S_SNAILERY_ABC). */
export async function setAbcRate(_previous: RateState, formData: FormData): Promise<RateState> {
  const stage = String(formData.get('stage') ?? '');
  const pool = String(formData.get('pool') ?? '');
  const rate = String(formData.get('rate') ?? '').trim();
  if (!rate) return { error: 'Give a rate.', message: null };
  try {
    await api('/cost-allocation/farm-abc/rates', { method: 'POST', body: { stage, pool, rate } });
    revalidatePath('/ledger/farm-abc');
    return { error: null, message: 'Saved.' };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not save the rate.', message: null };
  }
}
