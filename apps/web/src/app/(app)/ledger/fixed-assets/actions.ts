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

/** Capitalise a new asset and send it for approval. */
export async function capitaliseAsset(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) return { error: 'Name the asset.', message: null };

  const assetClass = String(formData.get('assetClass') ?? '').trim();
  if (!assetClass) return { error: 'Say what class of asset this is.', message: null };

  const acquisitionDate = String(formData.get('acquisitionDate') ?? '').trim();
  const costKobo = String(formData.get('costKobo') ?? '').trim();
  if (!costKobo || Number(costKobo) <= 0) {
    return { error: 'Enter what this asset cost.', message: null };
  }

  const usefulLifeMonths = Number(formData.get('usefulLifeMonths') ?? 0);
  if (!usefulLifeMonths || usefulLifeMonths <= 0) {
    return { error: 'Enter a useful life in months.', message: null };
  }

  const costCentreId = String(formData.get('costCentreId') ?? '').trim();

  try {
    await api('/fixed-assets/assets', {
      method: 'POST',
      body: {
        name,
        assetClass,
        acquisitionDate: acquisitionDate ? new Date(acquisitionDate).toISOString() : undefined,
        costKobo,
        usefulLifeMonths,
        ...(costCentreId ? { costCentreId } : {}),
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not capitalise that asset.');
  }

  revalidatePath('/ledger/fixed-assets');
  return { error: null, message: 'Capitalised and sent for approval.' };
}

/** Run depreciation for one financial period, across every in-service asset. */
export async function runDepreciation(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const financialPeriodId = String(formData.get('financialPeriodId') ?? '');
  if (!financialPeriodId) return { error: 'Choose a period.', message: null };

  try {
    const result = await api<{ assetCount: number }>('/fixed-assets/depreciation-runs', {
      method: 'POST',
      body: { financialPeriodId },
    });
    revalidatePath('/ledger/fixed-assets');
    return {
      error: null,
      message: `Depreciation run created for ${result.assetCount} asset${result.assetCount === 1 ? '' : 's'} and sent for approval.`,
    };
  } catch (caught) {
    return fail(caught, 'Could not run depreciation.');
  }
}
