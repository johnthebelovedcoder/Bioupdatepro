'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export interface FlowState {
  error: string | null;
  message: string | null;
}

/**
 * The API's refusals are the point, so they are shown verbatim.
 *
 * "You cannot approve your own document", "no financial period covers that
 * date", "line 2 would be over-received" — each of those tells the user
 * exactly what to do next. Replacing them with "Something went wrong" throws
 * away the most useful thing the system said.
 */
function fail(caught: unknown, fallback: string): FlowState {
  return { error: caught instanceof ApiError ? caught.message : fallback, message: null };
}

/** Approve a purchase order, so goods can be received against it. */
export async function approveOrder(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const id = String(formData.get('orderId') ?? '');
  if (!id) return { error: 'No order was named.', message: null };

  try {
    await api(`/procurement/orders/${id}/approve`, { method: 'POST', body: {} });
  } catch (caught) {
    return fail(caught, 'Could not approve that order.');
  }

  revalidatePath('/procurement');
  return { error: null, message: 'Approved. Goods can now be received against it.' };
}

/** Approve anything sitting in the approvals queue. */
export async function approveTransaction(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const id = String(formData.get('transactionId') ?? '');
  const comments = String(formData.get('comments') ?? '').trim();
  if (!id) return { error: 'No document was named.', message: null };

  try {
    await api(`/workflow/${id}/approve`, {
      method: 'POST',
      body: { comments: comments || null },
    });
  } catch (caught) {
    return fail(caught, 'Could not approve that document.');
  }

  revalidatePath('/approvals');
  revalidatePath('/procurement');
  revalidatePath('/procurement/receipts');
  return { error: null, message: 'Approved.' };
}

export async function rejectTransaction(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const id = String(formData.get('transactionId') ?? '');
  const comments = String(formData.get('comments') ?? '').trim();
  if (!id) return { error: 'No document was named.', message: null };
  if (!comments) {
    return { error: 'Say why you are rejecting it — the person who raised it will see this.', message: null };
  }

  try {
    await api(`/workflow/${id}/reject`, { method: 'POST', body: { comments } });
  } catch (caught) {
    return fail(caught, 'Could not reject that document.');
  }

  revalidatePath('/approvals');
  revalidatePath('/procurement');
  return { error: null, message: 'Rejected.' };
}

/**
 * Record goods arriving against an order.
 *
 * One form row per order line. Blank and zero rows are dropped rather than
 * refused: a delivery that brings three of the five things ordered is normal,
 * and making the storekeeper delete rows to say so would be silly.
 */
export async function receiveGoods(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const purchaseOrderId = String(formData.get('purchaseOrderId') ?? '');
  if (!purchaseOrderId) return { error: 'No order was named.', message: null };

  const lineIds = formData.getAll('lineId').map(String);
  const lines = lineIds
    .map((purchaseOrderLineId) => ({
      purchaseOrderLineId,
      receivedQuantity: String(formData.get(`received:${purchaseOrderLineId}`) ?? '').trim(),
      rejectedQuantity: String(formData.get(`rejected:${purchaseOrderLineId}`) ?? '').trim(),
      batchReference: String(formData.get(`batch:${purchaseOrderLineId}`) ?? '').trim(),
    }))
    .filter((line) => line.receivedQuantity !== '' && Number(line.receivedQuantity) > 0)
    .map((line) => ({
      purchaseOrderLineId: line.purchaseOrderLineId,
      receivedQuantity: line.receivedQuantity,
      ...(line.rejectedQuantity && Number(line.rejectedQuantity) > 0
        ? { rejectedQuantity: line.rejectedQuantity }
        : {}),
      ...(line.batchReference ? { batchReference: line.batchReference } : {}),
    }));

  if (lines.length === 0) {
    return { error: 'Enter how much of each item actually arrived.', message: null };
  }

  const receiptDate = String(formData.get('receiptDate') ?? '').trim();
  const deliveryNoteReference = String(formData.get('deliveryNoteReference') ?? '').trim();

  try {
    await api('/procurement/receipts', {
      method: 'POST',
      body: {
        purchaseOrderId,
        ...(receiptDate ? { receiptDate: new Date(receiptDate).toISOString() } : {}),
        ...(deliveryNoteReference ? { deliveryNoteReference } : {}),
        lines,
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not record that delivery.');
  }

  revalidatePath('/procurement');
  revalidatePath('/procurement/receipts');
  redirect('/procurement/receipts?received=1');
}
