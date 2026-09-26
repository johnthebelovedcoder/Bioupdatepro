'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export interface ReturnState {
  error: string | null;
  message: string | null;
}

const fail = (caught: unknown, fallback: string): ReturnState => ({ error: caught instanceof ApiError ? caught.message : fallback, message: null });

/** Raise a return against a posted receipt; someone else approves it. */
export async function raiseReturn(_previous: ReturnState, formData: FormData): Promise<ReturnState> {
  const grnId = String(formData.get('grnId') ?? '');
  const returnDate = String(formData.get('returnDate') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  const lines = formData
    .getAll('grnLineId')
    .map((id, i) => ({ grnLineId: String(id), quantity: String(formData.getAll('quantity')[i] ?? '').trim() }))
    .filter((l) => l.quantity !== '' && Number(l.quantity) > 0);
  if (!reason) return { error: 'Say why the goods are going back.', message: null };
  if (lines.length === 0) return { error: 'Enter a quantity for at least one item.', message: null };
  try {
    await api('/procurement/returns', { method: 'POST', body: { grnId, returnDate, reason, lines } });
  } catch (caught) {
    return fail(caught, 'Could not raise that return.');
  }
  revalidatePath('/procurement/returns');
  redirect('/procurement/returns');
}

export async function decideReturn(id: string, decision: 'APPROVE' | 'REJECT', note?: string): Promise<ReturnState> {
  try {
    await api(`/procurement/returns/${id}/decide`, { method: 'POST', body: { decision, note } });
  } catch (caught) {
    return fail(caught, 'Could not record that decision.');
  }
  revalidatePath('/procurement/returns');
  return { error: null, message: decision === 'APPROVE' ? 'Return posted.' : 'Return rejected.' };
}
