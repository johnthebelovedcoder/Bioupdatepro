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

const PATH = '/m/snail/breeding';

export async function recordBreedingCycle(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const body = {
    code: String(formData.get('code') ?? '').trim(),
    breederGroupId: String(formData.get('breederGroupId') ?? ''),
    setOn: String(formData.get('setOn') ?? ''),
    breeders: Number(formData.get('breeders') ?? 0),
    eggsLaid: Number(formData.get('eggsLaid') ?? 0),
    notes: String(formData.get('notes') ?? '').trim() || null,
  };
  try {
    await api('/snail-breeding/cycles', { method: 'POST', body });
  } catch (caught) {
    return fail(caught, 'Could not record that cycle.');
  }
  revalidatePath(PATH);
  return { error: null, message: `${body.code.toUpperCase()} recorded.` };
}

export async function recordSnailHatch(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const cycleId = String(formData.get('cycleId') ?? '');
  const body = {
    hatchedOn: String(formData.get('hatchedOn') ?? ''),
    hatchedCount: Number(formData.get('hatchedCount') ?? 0),
    unhatchedCount: Number(formData.get('unhatchedCount') ?? 0),
    hatchlingGroupCode: String(formData.get('hatchlingGroupCode') ?? '').trim() || null,
  };
  try {
    await api(`/snail-breeding/cycles/${cycleId}/hatch`, { method: 'POST', body });
  } catch (caught) {
    return fail(caught, 'Could not record the hatch.');
  }
  revalidatePath(PATH);
  revalidatePath('/m/snail/cohorts');
  return {
    error: null,
    message: body.hatchedCount > 0 ? `${body.hatchedCount} hatchlings placed as ${body.hatchlingGroupCode}.` : 'Recorded.',
  };
}

export async function failBreedingCycle(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const cycleId = String(formData.get('cycleId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  try {
    await api(`/snail-breeding/cycles/${cycleId}/fail`, { method: 'POST', body: { reason } });
  } catch (caught) {
    return fail(caught, 'Could not record that.');
  }
  revalidatePath(PATH);
  return { error: null, message: 'Recorded as failed.' };
}
