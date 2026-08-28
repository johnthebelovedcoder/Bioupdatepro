'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { parseNairaToKobo } from '@/lib/money';

export interface ValuationState {
  error: string | null;
  message: string | null;
}

/**
 * Raise a fair-value valuation — §61.6: a Farm Accountant prepares it, a
 * Finance Controller approves it. Submitting here does not post anything;
 * it puts the document into the approver's queue at /approvals, the same
 * queue every other approval-gated document in this application uses.
 */
export async function requestValuation(
  _previous: ValuationState,
  formData: FormData,
): Promise<ValuationState> {
  const groupId = String(formData.get('groupId') ?? '');
  const valuationDate = String(formData.get('valuationDate') ?? '');
  const marketPrice = String(formData.get('marketPricePerUnit') ?? '').trim();
  const costsToSell = String(formData.get('costsToSellPerUnit') ?? '').trim();
  const evidenceReference = String(formData.get('evidenceReference') ?? '').trim();

  if (!groupId) return { error: 'No population was named.', message: null };
  if (!evidenceReference) {
    return {
      error: 'State the market evidence — a valuation cannot be raised with nothing to support it.',
      message: null,
    };
  }

  const marketKobo = parseNairaToKobo(marketPrice);
  if (marketKobo === null || marketKobo <= 0n) {
    return { error: 'Enter the market price per unit.', message: null };
  }
  const costsKobo = parseNairaToKobo(costsToSell || '0') ?? 0n;

  try {
    await api('/biological-assets/valuations', {
      method: 'POST',
      body: {
        groupId,
        valuationDate: valuationDate || new Date().toISOString().slice(0, 10),
        marketPricePerUnitKobo: String(marketKobo),
        costsToSellPerUnitKobo: String(costsKobo),
        evidenceReference,
      },
    });
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not raise that valuation.',
      message: null,
    };
  }

  revalidatePath('/agripro/biological-assets');
  revalidatePath('/agripro/valuations');
  revalidatePath('/approvals');
  return { error: null, message: 'Raised. It now needs a Finance Controller to approve it.' };
}
