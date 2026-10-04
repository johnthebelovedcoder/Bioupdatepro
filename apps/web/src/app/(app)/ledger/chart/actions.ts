'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import type { CutoverPreview, ProductClass, StockClass } from '@/lib/controls';

export interface CutoverChoices {
  cutover: string;
  itemClasses: Record<string, ProductClass>;
  stockClasses: Record<string, StockClass>;
  defaultClass: ProductClass;
  defaultSpecies: 'poultry' | 'snail';
  /** Old account number → approved account number, for balances the crosswalk cannot place. */
  overrides: Record<string, string>;
}

/** The moves again, with the person's choices. Changes nothing. */
export async function previewCutover(choices: CutoverChoices): Promise<{ error: string | null; preview: CutoverPreview | null }> {
  try {
    const preview = await api<CutoverPreview>('/posting-control/chart-cutover/preview', { method: 'POST', body: choices });
    return { error: null, preview };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not work out the moves.', preview: null };
  }
}

/**
 * Move the farm to the approved five-digit chart. One transaction on the API:
 * the balances move, the settings follow, the old accounts retire, or nothing
 * happens at all. Only a CFO may run it, and only with Finance's approval of
 * the crosswalk on record.
 */
export async function runCutover(
  choices: CutoverChoices,
  approval: { approvedBy: string; approvalReference: string },
): Promise<{ error: string | null; message: string | null }> {
  try {
    const result = await api<{ journals: string[]; moved: number; repointed: number; retired: number; cohorts: number }>(
      '/posting-control/chart-cutover',
      { method: 'POST', body: { ...choices, ...approval } },
    );
    revalidatePath('/ledger/chart');
    revalidatePath('/ledger/controls');
    revalidatePath('/ledger/trial-balance');
    return {
      error: null,
      message:
        `Done. ${result.moved} balance${result.moved === 1 ? '' : 's'} moved in ${result.journals.length} ` +
        `journal${result.journals.length === 1 ? '' : 's'}, ${result.repointed} settings updated, ` +
        `${result.retired} old accounts retired, ${result.cohorts} poultry cohort${result.cohorts === 1 ? '' : 's'} restated.`,
    };
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'The move did not run.', message: null };
  }
}
