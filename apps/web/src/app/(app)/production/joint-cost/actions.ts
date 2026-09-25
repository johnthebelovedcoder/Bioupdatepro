'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { parseNairaToKobo } from '@/lib/money';

export interface PriceState {
  error: string | null;
  message: string | null;
}

const failed = (caught: unknown, fallback: string): PriceState => ({
  error: caught instanceof ApiError ? caught.message : fallback,
  message: null,
});

/** Propose a selling price at split-off for a joint output. Someone else approves it. */
export async function proposePrice(_previous: PriceState, formData: FormData): Promise<PriceState> {
  const itemId = String(formData.get('itemId') ?? '');
  const selling = parseNairaToKobo(String(formData.get('sellingPrice') ?? ''));
  const further = parseNairaToKobo(String(formData.get('furtherCost') ?? '0') || '0');
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '').trim();
  const evidenceReference = String(formData.get('evidenceReference') ?? '').trim();
  if (!itemId) return { error: 'Choose the output.', message: null };
  if (selling === null || selling <= 0n) return { error: 'Enter the selling price per unit.', message: null };
  if (!effectiveFrom) return { error: 'Choose the date the price applies from.', message: null };
  if (!evidenceReference) return { error: 'Name the evidence — a price list, quotation or recent sale.', message: null };
  try {
    await api('/production-orders/joint-cost/prices', {
      method: 'POST',
      body: {
        itemId,
        sellingPricePerUnitKobo: selling.toString(),
        furtherCostPerUnitKobo: (further ?? 0n).toString(),
        effectiveFrom,
        evidenceReference,
      },
    });
    revalidatePath('/production/joint-cost');
    return { error: null, message: 'Proposed. Next: the finance controller or CFO approves it.' };
  } catch (caught) {
    return failed(caught, 'Could not propose that price.');
  }
}

export async function decidePrice(priceId: string, approve: boolean, reason?: string): Promise<PriceState> {
  try {
    await api(`/production-orders/joint-cost/prices/${encodeURIComponent(priceId)}/decide`, {
      method: 'POST',
      body: { approve, ...(reason ? { reason } : {}) },
    });
    revalidatePath('/production/joint-cost');
    return { error: null, message: approve ? 'Approved. Orders completed from its date use it.' : 'Rejected.' };
  } catch (caught) {
    return failed(caught, 'Could not record the decision.');
  }
}

export async function releaseMethod(method: string): Promise<PriceState> {
  try {
    await api('/production-orders/joint-cost/method', { method: 'POST', body: { method } });
    revalidatePath('/production/joint-cost');
    return { error: null, message: `Every order now allocates by ${method}.` };
  } catch (caught) {
    return failed(caught, 'Could not change the method.');
  }
}
