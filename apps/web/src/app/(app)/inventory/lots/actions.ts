'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface LotState {
  error: string | null;
  message: string | null;
}

const fail = (caught: unknown, fallback: string): LotState => ({ error: caught instanceof ApiError ? caught.message : fallback, message: null });

/** Release a quarantined lot for use, or reject it. */
export async function decideLot(id: string, decision: 'RELEASE' | 'REJECT', note?: string): Promise<LotState> {
  try {
    await api(`/inventory/lots/${id}/decide`, { method: 'POST', body: { decision, note } });
  } catch (caught) {
    return fail(caught, 'Could not record that decision.');
  }
  revalidatePath('/inventory/lots');
  return { error: null, message: decision === 'RELEASE' ? 'Released for use.' : 'Rejected. Return it to the supplier or write it off.' };
}

/** An item's quarantine-on-receipt and shelf life. */
export async function saveItemControls(_previous: LotState, formData: FormData): Promise<LotState> {
  const itemId = String(formData.get('itemId') ?? '');
  if (!itemId) return { error: 'Choose the item.', message: null };
  const shelf = String(formData.get('shelfLifeDays') ?? '').trim();
  try {
    await api(`/inventory/items/${itemId}/controls`, {
      method: 'POST',
      body: { quarantineOnReceipt: formData.get('quarantineOnReceipt') === 'on', shelfLifeDays: shelf === '' ? null : Number(shelf) },
    });
  } catch (caught) {
    return fail(caught, 'Could not save those controls.');
  }
  revalidatePath('/inventory/lots');
  return { error: null, message: 'Saved. It applies to what is received or made from now on.' };
}
