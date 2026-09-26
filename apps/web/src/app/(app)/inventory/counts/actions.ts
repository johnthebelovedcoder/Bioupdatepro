'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface CountState {
  error: string | null;
  message: string | null;
}

const failed = (caught: unknown, fallback: string): CountState => ({
  error: caught instanceof ApiError ? caught.message : fallback,
  message: null,
});

/** Freeze a store and take its book quantities (INT-009). */
export async function startCount(_previous: CountState, formData: FormData): Promise<CountState> {
  const warehouseId = String(formData.get('warehouseId') ?? '');
  const threshold = String(formData.get('recountThresholdPercent') ?? '').trim();
  if (!warehouseId) return { error: 'Choose the store to count.', message: null };
  let id: string;
  try {
    const started = await api<{ id: string }>('/inventory/counts', {
      method: 'POST',
      body: { warehouseId, ...(threshold ? { recountThresholdPercent: threshold } : {}) },
    });
    id = started.id;
  } catch (caught) {
    return failed(caught, 'Could not start that count.');
  }
  revalidatePath('/inventory/counts');
  redirect(`/inventory/counts/${id}`);
}

/** Save counted quantities (or recounts) and reasons. */
export async function saveCounts(_previous: CountState, formData: FormData): Promise<CountState> {
  const id = String(formData.get('countId') ?? '');
  const entries = new Map<string, { itemId: string; quantity?: string; reason?: string }>();
  for (const [key, raw] of formData.entries()) {
    const [kind, itemId] = key.split(':');
    if (!itemId || (kind !== 'qty' && kind !== 'reason')) continue;
    const value = String(raw).trim();
    const entry = entries.get(itemId) ?? { itemId };
    if (kind === 'qty' && value !== '') entry.quantity = value;
    if (kind === 'reason') entry.reason = value;
    entries.set(itemId, entry);
  }
  try {
    await api(`/inventory/counts/${id}/counts`, { method: 'POST', body: { counts: [...entries.values()] } });
  } catch (caught) {
    return failed(caught, 'Could not save those counts.');
  }
  revalidatePath(`/inventory/counts/${id}`);
  return { error: null, message: 'Saved.' };
}

export async function submitCount(id: string): Promise<CountState> {
  try {
    const result = await api<{ status: string; message: string }>(`/inventory/counts/${id}/submit`, { method: 'POST' });
    revalidatePath(`/inventory/counts/${id}`);
    revalidatePath('/inventory/counts');
    return { error: null, message: result.message };
  } catch (caught) {
    return failed(caught, 'Could not submit the count.');
  }
}

export async function decideCount(id: string, action: 'APPROVE' | 'HOLD' | 'CANCEL', note?: string): Promise<CountState> {
  try {
    await api(`/inventory/counts/${id}/decide`, { method: 'POST', body: { action, note } });
  } catch (caught) {
    return failed(caught, 'Could not record that decision.');
  }
  revalidatePath(`/inventory/counts/${id}`);
  revalidatePath('/inventory/counts');
  return { error: null, message: action === 'APPROVE' ? 'Approved and posted.' : action === 'HOLD' ? 'Held for investigation.' : 'Cancelled.' };
}
