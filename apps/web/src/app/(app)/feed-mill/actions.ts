'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface MillState {
  error: string | null;
  message: string | null;
}

const fail = (caught: unknown, fallback: string): MillState => ({ error: caught instanceof ApiError ? caught.message : fallback, message: null });

/** A feed's quality limits (handbook §26). */
export async function saveQualitySpec(_previous: MillState, formData: FormData): Promise<MillState> {
  const v = (k: string) => String(formData.get(k) ?? '').trim();
  if (!v('itemId')) return { error: 'Choose the feed.', message: null };
  try {
    await api('/feed-mill/quality/specs', {
      method: 'POST',
      body: {
        itemId: v('itemId'),
        minProteinPercent: v('minProteinPercent') || undefined,
        maxMoisturePercent: v('maxMoisturePercent') || undefined,
        maxAflatoxinPpb: v('maxAflatoxinPpb') || undefined,
        samplingNote: v('samplingNote') || undefined,
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not save those limits.');
  }
  revalidatePath('/feed-mill/quality');
  return { error: null, message: 'Limits saved.' };
}

/** Raise a milling order for a plan's shortfall. */
export async function raiseFromPlan(_previous: MillState, formData: FormData): Promise<MillState> {
  const v = (k: string) => String(formData.get(k) ?? '').trim();
  if (!v('farmId')) return { error: 'Choose the farm.', message: null };
  let orderNumber: string;
  try {
    ({ orderNumber } = await api<{ orderNumber: string }>('/production-orders/feed', {
      method: 'POST',
      body: {
        branchId: v('branchId'),
        farmId: v('farmId'),
        warehouseId: '00000000-0000-0000-0000-000000000000',
        recipeVersionId: v('recipeVersionId'),
        plannedOutputQuantity: v('plannedOutputQuantity'),
      },
    }));
  } catch (caught) {
    return fail(caught, 'Could not raise that order.');
  }
  revalidatePath('/feed-mill/plan');
  revalidatePath('/production');
  return { error: null, message: `${orderNumber} raised as a draft.` };
}
