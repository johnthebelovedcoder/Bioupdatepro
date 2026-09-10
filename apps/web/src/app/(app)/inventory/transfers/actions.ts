'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';
import { getContext } from '@/lib/org';

export interface FlowState {
  error: string | null;
  message: string | null;
}

function fail(caught: unknown, fallback: string): FlowState {
  return { error: caught instanceof ApiError ? caught.message : fallback, message: null };
}

/** Same `PREFIX-YYYYMMDD-hash` shape every other document number in this app uses. */
function documentNumber(prefix: string): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const hash = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${today}-${hash}`;
}

/** Issue stock out of one store, in transit to another. Posts Dr/Cr the in-transit holding account (PCR-012). */
export async function issueTransfer(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const itemId = String(formData.get('itemId') ?? '');
  const fromWarehouseId = String(formData.get('fromWarehouseId') ?? '');
  const toWarehouseId = String(formData.get('toWarehouseId') ?? '');
  const quantity = String(formData.get('quantity') ?? '');

  if (!itemId) return { error: 'Choose an item.', message: null };
  if (!fromWarehouseId) return { error: 'Choose the store it is leaving.', message: null };
  if (!toWarehouseId) return { error: 'Choose the store it is going to.', message: null };
  if (fromWarehouseId === toWarehouseId) {
    return { error: 'The source and destination store must be different.', message: null };
  }
  if (!quantity || Number(quantity) <= 0) return { error: 'Enter a quantity greater than zero.', message: null };

  const context = await getContext();
  const branch = context.branches[0];
  if (!branch) return { error: 'This company has no active branch.', message: null };

  try {
    const transferNumber = documentNumber('TRF');
    await api('/inventory/transfers', {
      method: 'POST',
      body: { branchId: branch.id, itemId, fromWarehouseId, toWarehouseId, quantity, transferNumber },
    });
    revalidatePath('/inventory/transfers');
    return { error: null, message: `${transferNumber} issued — in transit until received at the other end.` };
  } catch (caught) {
    return fail(caught, 'Could not issue that transfer.');
  }
}

/** The receiving half — posted at the original transfer value, never re-priced (PCR-013). */
export async function receiveTransfer(transferId: string): Promise<FlowState> {
  try {
    await api(`/inventory/transfers/${transferId}/receive`, { method: 'POST' });
  } catch (caught) {
    return fail(caught, 'Could not receive that transfer.');
  }
  revalidatePath('/inventory/transfers');
  return { error: null, message: 'Received.' };
}

/** Remove stock with a reason — count evidence, obsolescence, damage (PCR-014). */
export async function writeOffStock(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const itemId = String(formData.get('itemId') ?? '');
  const warehouseId = String(formData.get('warehouseId') ?? '');
  const quantity = String(formData.get('quantity') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();

  if (!itemId) return { error: 'Choose an item.', message: null };
  if (!warehouseId) return { error: 'Choose which store it is coming out of.', message: null };
  if (!quantity || Number(quantity) <= 0) return { error: 'Enter a quantity greater than zero.', message: null };
  if (!reason) return { error: 'Say why — count evidence, damage, obsolescence.', message: null };

  const context = await getContext();
  const branch = context.branches[0];
  if (!branch) return { error: 'This company has no active branch.', message: null };

  try {
    await api('/inventory/write-offs', {
      method: 'POST',
      body: { branchId: branch.id, itemId, warehouseId, quantity, reason },
    });
    revalidatePath('/inventory/transfers');
    return { error: null, message: 'Written off.' };
  } catch (caught) {
    return fail(caught, 'Could not write that off.');
  }
}
