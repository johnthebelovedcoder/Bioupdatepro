'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export interface FlowState {
  error: string | null;
  message: string | null;
}

/** Log (or correct) hours one person worked on one batch on one day. */
export async function logHours(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const employeeId = String(formData.get('employeeId') ?? '');
  const groupId = String(formData.get('groupId') ?? '');
  const workDate = String(formData.get('workDate') ?? '').trim();
  const hours = String(formData.get('hours') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  if (!employeeId) return { error: 'Choose who worked.', message: null };
  if (!groupId) return { error: 'Choose the batch they worked on.', message: null };
  if (!workDate) return { error: 'Choose the day.', message: null };
  if (!/^[0-9]+([.][0-9]{1,2})?$/.test(hours)) return { error: 'Enter the hours as a number, such as 7.5.', message: null };

  try {
    await api('/cost-allocation/timesheets', {
      method: 'POST',
      body: { employeeId, groupId, workDate, hours, ...(notes ? { notes } : {}) },
    });
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not save those hours.', message: null };
  }
  revalidatePath('/finance/timesheets');
  return { error: null, message: `Saved ${hours} hours.` };
}

export async function removeHours(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await api(`/cost-allocation/timesheets/${id}/delete`, { method: 'POST', body: {} });
  revalidatePath('/finance/timesheets');
}

/** Approve pending hours so they count. Refusals (your own entries) come back as a message. */
export async function approveHours(formData: FormData): Promise<void> {
  const ids = String(formData.get('ids') ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return;
  try {
    await api('/cost-allocation/timesheets/approve', { method: 'POST', body: { ids } });
  } catch (caught) {
    // Shown on the page through the URL, so a refusal is never silent.
    const message = caught instanceof ApiError ? caught.message : 'Could not approve those hours.';
    redirect(`/finance/timesheets?error=${encodeURIComponent(message)}`);
  }
  revalidatePath('/finance/timesheets');
}
