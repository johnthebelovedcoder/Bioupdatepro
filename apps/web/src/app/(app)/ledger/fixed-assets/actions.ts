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

/**
 * Take an asset out of service. Sent for approval like the capitalisation
 * was; the asset's cost and accumulated depreciation only leave the books
 * once it is approved.
 */
export async function disposeAsset(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const assetId = String(formData.get('assetId') ?? '');
  const disposedOn = String(formData.get('disposedOn') ?? '').trim();
  if (!assetId) return { error: 'No asset was named.', message: null };
  if (!disposedOn) return { error: 'Say when it left service.', message: null };

  try {
    await api(`/fixed-assets/assets/${assetId}/dispose`, {
      method: 'POST',
      body: { disposedOn: new Date(disposedOn).toISOString() },
    });
  } catch (caught) {
    return fail(caught, 'Could not dispose of that asset.');
  }

  revalidatePath('/ledger/fixed-assets');
  return { error: null, message: 'Disposal sent for approval.' };
}

/** PCR-031 — which processing line a machine serves; its depreciation follows. */
export async function setProcessingLine(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const assetId = String(formData.get('assetId') ?? '');
  const line = String(formData.get('processingCycle') ?? '');
  if (!assetId) return { error: 'No asset was named.', message: null };

  try {
    await api(`/fixed-assets/assets/${assetId}/processing-line`, {
      method: 'POST',
      body: { processingCycle: line || null },
    });
  } catch (caught) {
    return fail(caught, 'Could not save the processing line.');
  }

  revalidatePath('/ledger/fixed-assets');
  return {
    error: null,
    message: line
      ? 'Saved. From the next depreciation run, this machine is charged to that line.'
      : 'Saved. From the next depreciation run, this machine goes to general depreciation.',
  };
}

/** PCR-031 — a machine's hours on each processing line for one period. */
export async function setMachineHours(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const assetId = String(formData.get('assetId') ?? '');
  const financialPeriodId = String(formData.get('financialPeriodId') ?? '');
  if (!assetId || !financialPeriodId) return { error: 'Choose the period.', message: null };
  const hours: Record<string, string> = {};
  for (const line of ['SNAILPRO', 'POULTRYPRO', 'FEED_MILL']) {
    const value = String(formData.get(line) ?? '').trim();
    if (value && !/^[0-9]+([.][0-9]{1,2})?$/.test(value)) return { error: 'Hours must be numbers such as 42.5.', message: null };
    hours[line] = value || '0';
  }
  try {
    await api(`/fixed-assets/assets/${assetId}/machine-hours`, { method: 'POST', body: { financialPeriodId, hours } });
  } catch (caught) {
    return fail(caught, 'Could not save the machine hours.');
  }
  revalidatePath('/ledger/fixed-assets');
  return { error: null, message: 'Saved. That period’s depreciation for this machine is split by these hours when the run posts.' };
}
