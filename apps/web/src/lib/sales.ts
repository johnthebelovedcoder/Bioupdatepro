import 'server-only';
import { api } from './api';

/**
 * Order-to-Cash, read from the API.
 *
 * Same discipline as lib/procurement.ts: real ids, so submissions here name a
 * row that actually exists rather than one the browser made up.
 */

export interface SalesOrderLine {
  id: string;
  lineNumber: number;
  itemCode: string;
  description: string;
  orderedQuantity: string;
  deliveredQuantity: string;
  invoicedQuantity: string;
  unitPriceKobo: string;
}

export interface SalesOrder {
  id: string;
  orderNumber: string;
  customer: string;
  status: string;
  orderDate: string;
  netKobo: string;
  lineCount: number;
  pendingTransactionId: string | null;
  canDeliver: boolean;
  canInvoice: boolean;
  lines: SalesOrderLine[];
}

export interface Delivery {
  id: string;
  deliveryNumber: string;
  deliveryDate: string;
  status: string;
  customer: string;
  orderNumber: string;
  lineCount: number;
  costKobo: string;
  journalEntryId: string | null;
  journalNumber: string | null;
  deferredCogs: boolean;
}

export interface SalesInvoiceRow {
  id: string;
  invoiceNumber: string;
  orderNumber: string | null;
  customerId: string;
  customer: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
  grossAmountKobo: string;
  settledAmountKobo: string;
  outstandingKobo: string;
}

export async function getSalesOrders(): Promise<SalesOrder[]> {
  return safe<SalesOrder[]>('/sales/orders', []);
}

export async function getSalesOrder(id: string): Promise<SalesOrder | null> {
  try {
    return await api<SalesOrder>(`/sales/orders/${id}`);
  } catch {
    return null;
  }
}

export async function getDeliveries(): Promise<Delivery[]> {
  return safe<Delivery[]>('/sales/deliveries', []);
}

export async function getSalesInvoiceRows(): Promise<SalesInvoiceRow[]> {
  return safe<SalesInvoiceRow[]>('/sales/invoices', []);
}

export async function getReceivableInvoices(): Promise<SalesInvoiceRow[]> {
  return safe<SalesInvoiceRow[]>('/sales/invoices/receivable', []);
}

/**
 * Read a list, or an empty one — a farm that has never delivered anything is
 * not an error state.
 */
async function safe<T>(path: string, fallback: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch {
    return fallback;
  }
}
