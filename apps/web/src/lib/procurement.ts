import 'server-only';
import { api } from './api';

/**
 * The buying chain, read from the API.
 *
 * Everything here is the company's own data. The procurement screens used to
 * read a demo module, which is how a client came to ask where the numbers on
 * his farm's app had come from — a fair question with an embarrassing answer.
 */

export interface OrderLine {
  id: string;
  lineNumber: number;
  itemCode: string;
  description: string;
  itemType: string;
  orderedQuantity: string;
  receivedQuantity: string;
  unitPriceKobo: string;
}

export interface PurchaseOrder {
  id: string;
  orderNumber: string;
  supplier: string;
  status: string;
  orderDate: string;
  netKobo: string;
  lineCount: number;
  pendingTransactionId: string | null;
  canReceive: boolean;
  lines: OrderLine[];
}

export interface GoodsReceipt {
  id: string;
  grnNumber: string;
  receiptDate: string;
  status: string;
  qualityStatus: string;
  supplier: string;
  orderNumber: string;
  lineCount: number;
  valueKobo: string;
  journalEntryId: string | null;
  journalNumber: string | null;
}

export interface PendingApproval {
  transactionId: string;
  documentReference: string;
  transactionType: string;
  module: string;
  status: string;
  currentLevel: number | null;
  amountKobo: string;
  waitingSince: string;
  escalated: boolean;
  route: string;
}

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  return safe<PurchaseOrder[]>('/procurement/orders', []);
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
  try {
    return await api<PurchaseOrder>(`/procurement/orders/${id}`);
  } catch {
    return null;
  }
}

export async function getGoodsReceipts(): Promise<GoodsReceipt[]> {
  return safe<GoodsReceipt[]>('/procurement/receipts', []);
}

/** Whatever is waiting on the signed-in user. The API scopes it to them. */
export async function getPendingApprovals(): Promise<PendingApproval[]> {
  return safe<PendingApproval[]>('/workflow/pending', []);
}

/**
 * Read a list, or an empty one.
 *
 * A farm that has never raised an order is not an error state, and neither is
 * an API that has not been reseeded — both should show an empty screen with an
 * explanation rather than a stack trace.
 */
async function safe<T>(path: string, fallback: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch {
    return fallback;
  }
}
