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
 * Send a document back to the person who raised it, for correction — softer
 * than rejecting: it stays alive, and resubmitting resumes the same approval
 * trail rather than starting a new one.
 */
export async function returnTransaction(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const id = String(formData.get('transactionId') ?? '');
  const comments = String(formData.get('comments') ?? '').trim();
  if (!id) return { error: 'No document was named.', message: null };
  if (!comments) {
    return { error: 'Say what needs correcting — the person who raised it will see this.', message: null };
  }

  try {
    await api(`/workflow/${id}/return`, { method: 'POST', body: { comments } });
  } catch (caught) {
    return fail(caught, 'Could not send that document back.');
  }

  revalidatePath('/approvals');
  revalidatePath('/procurement');
  return { error: null, message: 'Sent back for correction.' };
}

/** Withdraw a document you raised, before anyone has approved any step of it. */
export async function cancelTransaction(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const id = String(formData.get('transactionId') ?? '');
  const comments = String(formData.get('comments') ?? '').trim();
  if (!id) return { error: 'No document was named.', message: null };

  try {
    await api(`/workflow/${id}/cancel`, { method: 'POST', body: { comments: comments || null } });
  } catch (caught) {
    return fail(caught, 'Could not withdraw that document.');
  }

  revalidatePath('/approvals');
  revalidatePath('/approvals/mine');
  revalidatePath('/procurement');
  return { error: null, message: 'Withdrawn.' };
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
      expiryDate: String(formData.get(`expiry:${purchaseOrderLineId}`) ?? '').trim(),
    }))
    .filter((line) => line.receivedQuantity !== '' && Number(line.receivedQuantity) > 0)
    .map((line) => ({
      purchaseOrderLineId: line.purchaseOrderLineId,
      receivedQuantity: line.receivedQuantity,
      ...(line.rejectedQuantity && Number(line.rejectedQuantity) > 0
        ? { rejectedQuantity: line.rejectedQuantity }
        : {}),
      ...(line.batchReference ? { batchReference: line.batchReference } : {}),
      ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
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
        quarantine: formData.get('quarantine') === 'on',
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

/**
 * Enter a supplier's invoice against a goods receipt.
 *
 * One row per receipt line, same "blank rows are dropped, not refused"
 * discipline as `receiveGoods` — a vendor rarely bills every line of a
 * delivery in one document.
 */
export async function recordSupplierInvoice(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const goodsReceiptNoteId = String(formData.get('goodsReceiptNoteId') ?? '');
  if (!goodsReceiptNoteId) return { error: 'No goods receipt was named.', message: null };

  const supplierInvoiceNumber = String(formData.get('supplierInvoiceNumber') ?? '').trim();
  if (!supplierInvoiceNumber) {
    return { error: "Enter the supplier's own invoice number.", message: null };
  }

  const lineIds = formData.getAll('lineId').map(String);
  const lines = lineIds
    .map((goodsReceiptNoteLineId) => ({
      goodsReceiptNoteLineId,
      quantity: String(formData.get(`quantity:${goodsReceiptNoteLineId}`) ?? '').trim(),
      unitPriceKobo: String(formData.get(`price:${goodsReceiptNoteLineId}`) ?? '').trim(),
    }))
    .filter((line) => line.quantity !== '' && Number(line.quantity) > 0);

  if (lines.length === 0) {
    return { error: 'Enter what the supplier billed for at least one line.', message: null };
  }

  const invoiceDate = String(formData.get('invoiceDate') ?? '').trim();

  try {
    await api('/procurement/invoices', {
      method: 'POST',
      body: {
        goodsReceiptNoteId,
        supplierInvoiceNumber,
        ...(invoiceDate ? { invoiceDate: new Date(invoiceDate).toISOString() } : {}),
        lines,
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not enter that invoice.');
  }

  revalidatePath('/procurement/receipts');
  revalidatePath('/procurement/invoices');
  redirect('/procurement/invoices?entered=1');
}

/**
 * Pay a supplier against one or more of their approved invoices.
 *
 * One allocation per invoice shown; blank amounts are dropped the same way a
 * blank receipt line is — paying two of a supplier's five open invoices is
 * the ordinary case, not a partial form.
 */
export async function recordSupplierPayment(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const supplierId = String(formData.get('supplierId') ?? '');
  if (!supplierId) return { error: 'Choose a supplier.', message: null };

  const bankGlAccountId = String(formData.get('bankGlAccountId') ?? '');
  if (!bankGlAccountId) return { error: 'Choose which account this is paid from.', message: null };

  const method = String(formData.get('method') ?? 'BANK_TRANSFER');

  const invoiceIds = formData.getAll('invoiceId').map(String);
  const allocations = invoiceIds
    .map((invoiceId) => ({
      invoiceId,
      amountKobo: String(formData.get(`amount:${invoiceId}`) ?? '').trim(),
    }))
    .filter((line) => line.amountKobo !== '' && Number(line.amountKobo) > 0);

  if (allocations.length === 0) {
    return { error: 'Enter how much is being paid against at least one invoice.', message: null };
  }

  const paymentDate = String(formData.get('paymentDate') ?? '').trim();
  const reference = String(formData.get('reference') ?? '').trim();

  try {
    await api('/procurement/payments', {
      method: 'POST',
      body: {
        supplierId,
        bankGlAccountId,
        method,
        ...(paymentDate ? { paymentDate: new Date(paymentDate).toISOString() } : {}),
        ...(reference ? { reference } : {}),
        allocations,
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not record that payment.');
  }

  revalidatePath('/procurement/invoices');
  redirect('/procurement/invoices?paid=1');
}

/**
 * Raise a purchase requisition — a request, not a commitment.
 *
 * One row per item wanted; blank rows are dropped the same way an empty
 * receipt line is. Nothing here touches a supplier or a price — that is
 * decided when the requisition is converted into an order.
 */
export async function raiseRequisition(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const itemIds = formData.getAll('itemId').map(String);
  const lines = itemIds
    .map((itemId) => ({
      itemId,
      quantity: String(formData.get(`quantity:${itemId}`) ?? '').trim(),
    }))
    .filter((line) => line.quantity !== '' && Number(line.quantity) > 0);

  if (lines.length === 0) {
    return { error: 'Enter how much of at least one item is needed.', message: null };
  }

  const requestDate = String(formData.get('requestDate') ?? '').trim();
  const requiredDate = String(formData.get('requiredDate') ?? '').trim();
  const justification = String(formData.get('justification') ?? '').trim();

  try {
    await api('/procurement/requisitions', {
      method: 'POST',
      body: {
        ...(requestDate ? { requestDate: new Date(requestDate).toISOString() } : {}),
        ...(requiredDate ? { requiredDate: new Date(requiredDate).toISOString() } : {}),
        ...(justification ? { justification } : {}),
        lines,
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not raise that requisition.');
  }

  revalidatePath('/procurement/requisitions');
  redirect('/procurement/requisitions?raised=1');
}

/**
 * Convert an approved requisition into a purchase order.
 *
 * One row per requisition line; quantity defaults to what is still
 * outstanding, and the person converting it is the one who now names a
 * supplier and a price — a requisition carries neither.
 */
export async function convertRequisitionToOrder(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const requisitionId = String(formData.get('requisitionId') ?? '');
  if (!requisitionId) return { error: 'No requisition was named.', message: null };

  const supplierId = String(formData.get('supplierId') ?? '');
  if (!supplierId) return { error: 'Choose a supplier.', message: null };

  const lineIds = formData.getAll('lineId').map(String);
  const lines = lineIds
    .map((requisitionLineId) => ({
      requisitionLineId,
      itemId: String(formData.get(`itemId:${requisitionLineId}`) ?? ''),
      quantity: String(formData.get(`quantity:${requisitionLineId}`) ?? '').trim(),
      unitPriceKobo: String(formData.get(`price:${requisitionLineId}`) ?? '').trim(),
    }))
    .filter((line) => line.quantity !== '' && Number(line.quantity) > 0);

  if (lines.length === 0) {
    return { error: 'Enter what to order for at least one line.', message: null };
  }

  const orderDate = String(formData.get('orderDate') ?? '').trim();

  try {
    await api(`/procurement/requisitions/${requisitionId}/convert`, {
      method: 'POST',
      body: {
        supplierId,
        ...(orderDate ? { orderDate: new Date(orderDate).toISOString() } : {}),
        lines,
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not convert that requisition.');
  }

  revalidatePath('/procurement/requisitions');
  revalidatePath('/procurement');
  redirect('/procurement?ordered=1');
}

/**
 * Correct a draft order's quantities and prices, then send it back for
 * approval — the path an order takes after an approver returns it.
 *
 * Every line is sent back, not only the edited ones: amending replaces the
 * order's lines, so a line left out would be deleted. Each keeps its item,
 * wording, tax code and requisition link exactly as it was.
 */
export async function amendAndResubmitOrder(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const orderId = String(formData.get('orderId') ?? '');
  if (!orderId) return { error: 'No order was named.', message: null };

  let lines: Array<{
    itemId: string;
    description: string;
    requisitionLineId: string | null;
    quantity: string;
    unitPriceKobo: string;
    taxCode: string | null;
  }>;
  try {
    lines = JSON.parse(String(formData.get('original') ?? '[]'));
  } catch {
    return { error: 'The order could not be read back. Reload and try again.', message: null };
  }

  for (const [index, line] of lines.entries()) {
    const quantity = String(formData.get(`quantity:${index}`) ?? '').trim();
    const priceKobo = String(formData.get(`priceKobo:${index}`) ?? '').trim();
    if (!quantity || !(Number(quantity) > 0)) {
      return { error: `Line ${index + 1}: enter a quantity above zero.`, message: null };
    }
    if (!/^\d+$/.test(priceKobo)) {
      return { error: `Line ${index + 1}: enter a unit price.`, message: null };
    }
    line.quantity = quantity;
    line.unitPriceKobo = priceKobo;
  }

  try {
    await api(`/procurement/orders/${orderId}/amend`, { method: 'POST', body: { lines } });
    await api(`/procurement/orders/${orderId}/submit`, { method: 'POST', body: {} });
  } catch (caught) {
    return fail(caught, 'Could not amend that order.');
  }

  revalidatePath('/procurement');
  revalidatePath(`/procurement/orders/${orderId}`);
  return { error: null, message: 'Amended and sent back for approval.' };
}

/** Send a draft order for approval as it stands. */
export async function submitOrder(orderId: string): Promise<FlowState> {
  try {
    await api(`/procurement/orders/${orderId}/submit`, { method: 'POST', body: {} });
  } catch (caught) {
    return fail(caught, 'Could not send that order for approval.');
  }
  revalidatePath('/procurement');
  revalidatePath(`/procurement/orders/${orderId}`);
  return { error: null, message: 'Sent for approval.' };
}
