'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface StandardState {
  error: string | null;
  message: string | null;
}

const failed = (caught: unknown, fallback: string): StandardState => ({
  error: caught instanceof ApiError ? caught.message : fallback,
  message: null,
});

/** SOP-049: the year's policy — standard cost only, and its variance tolerance. */
export async function configurePolicy(_previous: StandardState, formData: FormData): Promise<StandardState> {
  const financialYearId = String(formData.get('financialYearId') ?? '');
  const tolerance = String(formData.get('varianceTolerancePercent') ?? '').trim();
  if (!financialYearId) return { error: 'Choose the financial year.', message: null };
  try {
    await api('/production-orders/standard-costs/policy', { method: 'POST', body: { financialYearId, varianceTolerancePercent: tolerance || undefined } });
  } catch (caught) {
    return failed(caught, 'Could not configure that policy.');
  }
  revalidatePath('/production/standard-costs');
  return { error: null, message: 'Policy configured. It locks at the year’s first production posting.' };
}

/** SOP-050: prepare a standard from a recipe version's roll-up. */
export async function prepareStandard(_previous: StandardState, formData: FormData): Promise<StandardState> {
  const recipeVersionId = String(formData.get('recipeVersionId') ?? '');
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '');
  if (!recipeVersionId) return { error: 'Choose the recipe version.', message: null };
  if (!effectiveFrom) return { error: 'Say when the standard applies from.', message: null };
  try {
    const prepared = await api<{ versionNumber: number; unitCostKobo: string }>('/production-orders/standard-costs', {
      method: 'POST',
      body: { recipeVersionId, effectiveFrom },
    });
    revalidatePath('/production/standard-costs');
    return { error: null, message: `Version ${prepared.versionNumber} prepared — waiting for someone else to release it.` };
  } catch (caught) {
    return failed(caught, 'Could not prepare that standard.');
  }
}

export async function decideStandard(versionId: string, approve: boolean, reason?: string): Promise<StandardState> {
  try {
    await api(`/production-orders/standard-costs/${versionId}/decide`, { method: 'POST', body: { approve, reason } });
  } catch (caught) {
    return failed(caught, 'Could not record that decision.');
  }
  revalidatePath('/production/standard-costs');
  return { error: null, message: approve ? 'Released.' : 'Rejected.' };
}
