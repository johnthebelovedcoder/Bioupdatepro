'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export interface FlowState {
  error: string | null;
  message: string | null;
}

/** The API's refusals are shown verbatim — see procurement/actions.ts for why. */
function fail(caught: unknown, fallback: string): FlowState {
  return { error: caught instanceof ApiError ? caught.message : fallback, message: null };
}

/** Approve a sales order, so it can be delivered against. */
export async function approveSalesOrder(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const id = String(formData.get('orderId') ?? '');
  if (!id) return { error: 'No order was named.', message: null };

  try {
    await api(`/sales/orders/${id}/approve`, { method: 'POST', body: {} });
  } catch (caught) {
    return fail(caught, 'Could not approve that order.');
  }

  revalidatePath('/sales');
  return { error: null, message: 'Approved. Goods can now be shipped against it.' };
}

/**
 * Ship goods against an approved order.
 *
 * One row per order line; blank and zero rows are dropped — shipping part
 * of an order is normal, not something the storekeeper should have to
 * delete rows to say.
 */
export async function deliverGoods(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const salesOrderId = String(formData.get('salesOrderId') ?? '');
  if (!salesOrderId) return { error: 'No order was named.', message: null };

  const lineIds = formData.getAll('lineId').map(String);
  const lines = lineIds
    .map((salesOrderLineId) => ({
      salesOrderLineId,
      quantity: String(formData.get(`quantity:${salesOrderLineId}`) ?? '').trim(),
      batchReference: String(formData.get(`batch:${salesOrderLineId}`) ?? '').trim(),
    }))
    .filter((line) => line.quantity !== '' && Number(line.quantity) > 0)
    .map((line) => ({
      salesOrderLineId: line.salesOrderLineId,
      quantity: line.quantity,
      ...(line.batchReference ? { batchReference: line.batchReference } : {}),
    }));

  if (lines.length === 0) {
    return { error: 'Enter how much of each item is going out.', message: null };
  }

  const deliveryDate = String(formData.get('deliveryDate') ?? '').trim();
  const driverName = String(formData.get('driverName') ?? '').trim();
  const vehicleNumber = String(formData.get('vehicleNumber') ?? '').trim();

  try {
    await api('/sales/deliveries', {
      method: 'POST',
      body: {
        salesOrderId,
        ...(deliveryDate ? { deliveryDate: new Date(deliveryDate).toISOString() } : {}),
        ...(driverName ? { driverName } : {}),
        ...(vehicleNumber ? { vehicleNumber } : {}),
        lines,
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not record that delivery.');
  }

  revalidatePath('/sales');
  revalidatePath('/sales/deliveries');
  redirect('/sales/deliveries?shipped=1');
}

/**
 * Raise an invoice for whatever an order has shipped but not yet billed.
 *
 * No line entry — the invoice is for delivered-minus-invoiced, which the API
 * already knows without being told.
 */
export async function raiseSalesInvoice(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const salesOrderId = String(formData.get('salesOrderId') ?? '');
  if (!salesOrderId) return { error: 'No order was named.', message: null };

  const invoiceDate = String(formData.get('invoiceDate') ?? '').trim();

  try {
    await api('/sales/invoices', {
      method: 'POST',
      body: {
        salesOrderId,
        ...(invoiceDate ? { invoiceDate: new Date(invoiceDate).toISOString() } : {}),
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not raise that invoice.');
  }

  revalidatePath('/sales/deliveries');
  revalidatePath('/sales/invoices');
  redirect('/sales/invoices?invoiced=1');
}

/**
 * Receive a customer's payment against one or more of their posted invoices.
 */
export async function recordCustomerReceipt(
  _previous: FlowState,
  formData: FormData,
): Promise<FlowState> {
  const customerId = String(formData.get('customerId') ?? '');
  if (!customerId) return { error: 'Choose a customer.', message: null };

  const bankGlAccountId = String(formData.get('bankGlAccountId') ?? '');
  if (!bankGlAccountId) return { error: 'Choose which account this is received into.', message: null };

  const method = String(formData.get('method') ?? 'BANK_TRANSFER');

  const invoiceIds = formData.getAll('invoiceId').map(String);
  const allocations = invoiceIds
    .map((invoiceId) => ({
      invoiceId,
      amountKobo: String(formData.get(`amount:${invoiceId}`) ?? '').trim(),
    }))
    .filter((line) => line.amountKobo !== '' && Number(line.amountKobo) > 0);

  if (allocations.length === 0) {
    return { error: 'Enter how much is being received against at least one invoice.', message: null };
  }

  const receiptDate = String(formData.get('receiptDate') ?? '').trim();
  const reference = String(formData.get('reference') ?? '').trim();

  try {
    await api('/sales/receipts', {
      method: 'POST',
      body: {
        customerId,
        bankGlAccountId,
        method,
        ...(receiptDate ? { receiptDate: new Date(receiptDate).toISOString() } : {}),
        ...(reference ? { reference } : {}),
        allocations,
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not record that receipt.');
  }

  revalidatePath('/sales/invoices');
  redirect('/sales/invoices?received=1');
}
