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

/** Set what eggs are worth from a date (PCR-067). */
export async function setEggValue(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const itemId = String(formData.get('itemId') ?? '');
  const eggsPerUnit = Number(formData.get('eggsPerUnit') ?? 0);
  const valuePerUnitKobo = String(formData.get('valuePerUnitKobo') ?? '').trim();
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '').trim();
  if (!itemId) return { error: 'Choose the eggs stock item.', message: null };
  if (!Number.isInteger(eggsPerUnit) || eggsPerUnit < 1) return { error: 'Eggs per unit must be a whole number.', message: null };
  if (!/^\d+$/.test(valuePerUnitKobo) || valuePerUnitKobo === '0') return { error: 'Enter what one unit is worth.', message: null };
  if (!effectiveFrom) return { error: 'Choose the date the value starts.', message: null };

  try {
    await api('/poultry/eggs/value-policies', {
      method: 'POST',
      body: { itemId, eggsPerUnit, valuePerUnitKobo, effectiveFrom },
    });
  } catch (caught) {
    return fail(caught, 'Could not set the egg value.');
  }
  revalidatePath('/ledger/farm-costing');
  return { error: null, message: 'Saved. Collections from that date are valued at it; press "Post waiting farm records" on Controls for any already recorded.' };
}

/** Share chosen expense amounts across the populations by animal-days (PCR-028/043/064). */
export async function postAllocation(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const financialPeriodId = String(formData.get('financialPeriodId') ?? '');
  let sources: Array<{ glAccountId: string; costCentreId: string | null; amountKobo: string }> = [];
  try {
    sources = JSON.parse(String(formData.get('sources') ?? '[]'));
  } catch {
    return { error: 'The amounts could not be read.', message: null };
  }
  sources = sources.filter((s) => /^\d+$/.test(s.amountKobo) && s.amountKobo !== '0');
  if (!financialPeriodId) return { error: 'Choose a period.', message: null };
  if (sources.length === 0) return { error: 'Tick at least one amount to share.', message: null };

  try {
    const result = await api<{ reference: string; journalNumber: string; populations: number }>('/cost-allocation', {
      method: 'POST',
      body: { financialPeriodId, sources },
    });
    revalidatePath('/ledger/farm-costing');
    return {
      error: null,
      message: `Posted ${result.journalNumber}: shared across ${result.populations} population${result.populations === 1 ? '' : 's'}.`,
    };
  } catch (caught) {
    return fail(caught, 'Could not post the allocation.');
  }
}
