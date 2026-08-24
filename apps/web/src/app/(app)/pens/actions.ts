'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface StructureState {
  error: string | null;
  created: string | null;
  values?: Record<string, string>;
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

/**
 * Create a house, pen or section.
 *
 * The place an animal lives had no way of being created until now, so a farm
 * that signed up could not place a single batch — the livestock half of the
 * product was unreachable from a fresh account.
 */
export async function createPen(
  _previous: StructureState,
  formData: FormData,
): Promise<StructureState> {
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  const name = String(formData.get('name') ?? '').trim();
  const farmId = String(formData.get('farmId') ?? '').trim();
  const kept = { code, name, farmId };

  if (!code) return { error: 'Give it a short code.', created: null, values: kept };
  if (!name) return { error: 'Give it a name.', created: null, values: kept };

  try {
    await api('/masters/pens', {
      method: 'POST',
      body: { code, name, farmId: farmId || null },
    });
  } catch (caught) {
    return { error: message(caught, 'Could not save that.'), created: null, values: kept };
  }

  revalidatePath('/pens');
  return { error: null, created: name };
}

/** Create a farm — the thing pens belong to. */
export async function createFarm(
  _previous: StructureState,
  formData: FormData,
): Promise<StructureState> {
  const code = String(formData.get('farmCode') ?? '').trim().toUpperCase();
  const name = String(formData.get('farmName') ?? '').trim();
  const kept = { farmCode: code, farmName: name };

  if (!code) return { error: 'Give the farm a short code.', created: null, values: kept };
  if (!name) return { error: 'Give the farm a name.', created: null, values: kept };

  try {
    await api('/masters/farms', { method: 'POST', body: { code, name } });
  } catch (caught) {
    return { error: message(caught, 'Could not save that farm.'), created: null, values: kept };
  }

  revalidatePath('/pens');
  return { error: null, created: name };
}
