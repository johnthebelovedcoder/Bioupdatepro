'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface LeaveState {
  error: string | null;
  message: string | null;
}

const failed = (caught: unknown, fallback: string): LeaveState => ({
  error: caught instanceof ApiError ? caught.message : fallback,
  message: null,
});

export async function requestLeave(_previous: LeaveState, formData: FormData): Promise<LeaveState> {
  const value = (key: string) => String(formData.get(key) ?? '').trim();
  const body = {
    employeeId: value('employeeId'),
    type: value('type'),
    startDate: value('startDate'),
    endDate: value('endDate'),
    reason: value('reason'),
    handover: value('handover') || undefined,
    evidenceReference: value('evidenceReference') || undefined,
  };
  if (!body.employeeId) return { error: 'Choose the employee.', message: null };
  if (!body.startDate || !body.endDate) return { error: 'Give the first and last day of the leave.', message: null };
  try {
    const created = await api<{ workingDays: number; payPercent: number }>('/leave/requests', { method: 'POST', body });
    revalidatePath('/staff/leave');
    return { error: null, message: `Requested: ${created.workingDays} working days at ${created.payPercent}% pay, waiting for approval.` };
  } catch (caught) {
    return failed(caught, 'Could not request that leave.');
  }
}

export async function decideLeave(id: string, approve: boolean, note?: string): Promise<LeaveState> {
  try {
    await api(`/leave/requests/${id}/decide`, { method: 'POST', body: { approve, note } });
  } catch (caught) {
    return failed(caught, 'Could not record that decision.');
  }
  revalidatePath('/staff/leave');
  return { error: null, message: approve ? 'Approved.' : 'Refused.' };
}

export async function cancelLeave(id: string, note?: string): Promise<LeaveState> {
  try {
    await api(`/leave/requests/${id}/cancel`, { method: 'POST', body: { note } });
  } catch (caught) {
    return failed(caught, 'Could not cancel that leave.');
  }
  revalidatePath('/staff/leave');
  return { error: null, message: 'Cancelled.' };
}

export async function savePolicy(_previous: LeaveState, formData: FormData): Promise<LeaveState> {
  const keys = ['annualDays', 'annualServiceMonths', 'carryOverYears', 'sickDays', 'maternityWeeks', 'maternityPayPercent', 'maternityServiceMonths'];
  const body: Record<string, number> = {};
  for (const key of keys) {
    const raw = String(formData.get(key) ?? '').trim();
    if (raw !== '') body[key] = Number(raw);
  }
  try {
    await api('/leave/policy', { method: 'POST', body });
  } catch (caught) {
    return failed(caught, 'Could not save the policy.');
  }
  revalidatePath('/staff/leave');
  return { error: null, message: 'Policy saved.' };
}
