'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface GrowthState {
  error: string | null;
  message: string | null;
}

const failed = (caught: unknown, fallback: string): GrowthState => ({
  error: caught instanceof ApiError ? caught.message : fallback,
  message: null,
});

/** Record a sample weighing — how many, and what they weighed together. It waits for a supervisor. */
export async function recordWeighing(_previous: GrowthState, formData: FormData): Promise<GrowthState> {
  const code = String(formData.get('code') ?? '');
  const weighedOn = String(formData.get('weighedOn') ?? '').trim();
  const sampleSize = Number(formData.get('sampleSize'));
  const unit = String(formData.get('unit') ?? 'kg') === 'g' ? 'g' : 'kg';
  const totalSampleWeight = Number(formData.get('totalSampleWeight'));
  const notes = String(formData.get('notes') ?? '').trim();
  if (!weighedOn) return { error: 'Choose the day they were weighed.', message: null };
  if (!Number.isInteger(sampleSize) || sampleSize < 1) return { error: 'Say how many were weighed.', message: null };
  if (!(totalSampleWeight > 0)) return { error: 'Give what the whole sample weighed.', message: null };

  try {
    const result = await api<{ averageWeightGrams: number }>(`/operations/groups/${encodeURIComponent(code)}/weighings`, {
      method: 'POST',
      body: { weighedOn, sampleSize, totalSampleWeight, unit, ...(notes ? { notes } : {}) },
    });
    revalidatePath('/', 'layout');
    return {
      error: null,
      message: `Recorded: ${sampleSize} weighed, average ${result.averageWeightGrams.toLocaleString('en-NG')} g. Next: a supervisor approves it.`,
    };
  } catch (caught) {
    return failed(caught, 'Could not record the weighing.');
  }
}

export async function approveWeighing(id: string): Promise<GrowthState> {
  try {
    const result = await api<{ isCurrent: boolean }>(`/operations/weighings/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} });
    revalidatePath('/', 'layout');
    return { error: null, message: result.isCurrent ? 'Approved. It is now the current weight.' : 'Approved. A newer weighing stays current.' };
  } catch (caught) {
    return failed(caught, 'Could not approve the weighing.');
  }
}

export async function rejectWeighing(id: string, reason: string): Promise<GrowthState> {
  if (!reason.trim()) return { error: 'Say why it is rejected.', message: null };
  try {
    await api(`/operations/weighings/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { reason } });
    revalidatePath('/', 'layout');
    return { error: null, message: 'Rejected. Record a new weighing if one is needed.' };
  } catch (caught) {
    return failed(caught, 'Could not reject the weighing.');
  }
}

export async function setHatchDate(_previous: GrowthState, formData: FormData): Promise<GrowthState> {
  const code = String(formData.get('code') ?? '');
  const hatchedOn = String(formData.get('hatchedOn') ?? '').trim();
  const estimated = formData.get('estimated') === 'on';
  try {
    await api(`/operations/groups/${encodeURIComponent(code)}/hatch-date`, {
      method: 'POST',
      body: { hatchedOn: hatchedOn || null, estimated },
    });
    revalidatePath('/', 'layout');
    return { error: null, message: hatchedOn ? 'Hatch date saved. Age now counts from it.' : 'Hatch date cleared. Age counts from placement.' };
  } catch (caught) {
    return failed(caught, 'Could not save the hatch date.');
  }
}
