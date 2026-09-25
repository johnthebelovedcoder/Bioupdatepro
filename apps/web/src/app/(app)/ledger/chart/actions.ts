'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import type { ProductClass, UnificationPreview } from '@/lib/controls';

export interface UnificationChoices {
  cutover: string;
  itemClasses: Record<string, ProductClass>;
  defaultClass: ProductClass;
  defaultSpecies: 'poultry' | 'snail';
}

/** The moves again, with the person's choices for each item. Changes nothing. */
export async function previewUnification(
  choices: UnificationChoices,
): Promise<{ error: string | null; preview: UnificationPreview | null }> {
  try {
    const preview = await api<UnificationPreview>('/posting-control/chart-unification/preview', {
      method: 'POST',
      body: choices,
    });
    return { error: null, preview };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not work out the moves.', preview: null };
  }
}

/**
 * Move the farm to the six-digit chart. One transaction on the API: the
 * balances move, the settings follow, the old accounts retire, or nothing
 * happens at all. Only a CFO may run it.
 */
export async function runUnification(
  choices: UnificationChoices,
): Promise<{ error: string | null; message: string | null }> {
  try {
    const result = await api<{ journals: string[]; moved: number; repointed: number; retired: number }>(
      '/posting-control/chart-unification',
      { method: 'POST', body: choices },
    );
    revalidatePath('/ledger/chart');
    revalidatePath('/ledger/controls');
    revalidatePath('/ledger/trial-balance');
    return {
      error: null,
      message:
        `Done. ${result.moved} balance${result.moved === 1 ? '' : 's'} moved in ${result.journals.length} ` +
        `journal${result.journals.length === 1 ? '' : 's'}, ${result.repointed} settings updated, ` +
        `${result.retired} old accounts retired.`,
    };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'The move did not run.', message: null };
  }
}
