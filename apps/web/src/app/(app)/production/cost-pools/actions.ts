'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { parseNairaToKobo } from '@/lib/money';

/**
 * Activity cost pools and their effective-dated rates (US-897-015). Same
 * shape as recipes' own actions.ts: `RoutingService` could resolve a pool's
 * rate and compute unused capacity, but nothing anywhere could ever create a
 * pool or set its rate.
 */

export interface CreatePoolState {
  error: string | null;
}

export async function createCostPool(
  _previous: CreatePoolState,
  formData: FormData,
): Promise<CreatePoolState> {
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const driverName = String(formData.get('driverName') ?? '').trim();

  if (!code) return { error: 'Give the pool a code.' };
  if (!name) return { error: 'Give the pool a name.' };
  if (!driverName) {
    return { error: 'Name the driver — what usage actually spreads this cost across.' };
  }

  try {
    await api('/costing/cost-pools', { method: 'POST', body: { code, name, driverName } });
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not create that pool.' };
  }

  revalidatePath('/production/cost-pools');
  return { error: null };
}

export interface SetRateState {
  error: string | null;
}

export async function setCostPoolRate(
  _previous: SetRateState,
  formData: FormData,
): Promise<SetRateState> {
  const poolId = String(formData.get('poolId') ?? '');
  const poolCost = String(formData.get('poolCost') ?? '').trim();
  const practicalCapacity = String(formData.get('practicalCapacity') ?? '').trim();
  const effectiveFrom = String(formData.get('effectiveFrom') ?? '');
  const sourceReference = String(formData.get('sourceReference') ?? '').trim();

  const poolCostKobo = parseNairaToKobo(poolCost);
  if (poolCostKobo === null || poolCostKobo <= 0n) {
    return { error: 'Enter the pool cost for the period.' };
  }
  if (!practicalCapacity || Number(practicalCapacity) <= 0) {
    return { error: 'Enter the practical capacity — what the pool can realistically deliver.' };
  }
  if (!effectiveFrom) return { error: 'Choose when this rate takes effect.' };

  try {
    await api(`/costing/cost-pools/${poolId}/rate`, {
      method: 'POST',
      body: {
        poolCostKobo: String(poolCostKobo),
        practicalCapacity,
        effectiveFrom,
        sourceReference: sourceReference || null,
      },
    });
  } catch (caught) {
    return { error: caught instanceof ApiError ? caught.message : 'Could not set that rate.' };
  }

  revalidatePath('/production/cost-pools');
  return { error: null };
}
