'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface HealthState {
  error: string | null;
  message: string | null;
}

/** Put a vaccination or treatment on a batch's programme (PLY-008). */
export async function scheduleHealthEvent(_previous: HealthState, formData: FormData): Promise<HealthState> {
  const groupCode = String(formData.get('groupCode') ?? '').trim();
  const kind = String(formData.get('kind') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const dueOn = String(formData.get('dueOn') ?? '').trim();
  const detail = String(formData.get('detail') ?? '').trim();
  if (!groupCode || !name || !dueOn) return { error: 'Choose the batch, name the vaccine or treatment, and give the day it is due.', message: null };
  try {
    await api('/operations/health-events', { method: 'POST', body: { groupCode, kind, name, dueOn, detail: detail || null } });
    revalidatePath('/', 'layout');
    return { error: null, message: `${name} scheduled for ${groupCode}.` };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not schedule it.', message: null };
  }
}

/** Stand a scheduled event down — it will not be given — with the reason. */
export async function skipHealthEvent(_previous: HealthState, formData: FormData): Promise<HealthState> {
  const eventId = String(formData.get('eventId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!reason) return { error: 'Say why it is not being given.', message: null };
  try {
    await api(`/operations/health-events/${encodeURIComponent(eventId)}/skip`, { method: 'POST', body: { reason } });
    revalidatePath('/', 'layout');
    return { error: null, message: 'Stood down.' };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not stand it down.', message: null };
  }
}
