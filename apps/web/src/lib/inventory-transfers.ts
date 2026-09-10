import 'server-only';
import { api } from './api';

/** §14 — PCR-012/013/014. A transfer moves stock between stores; a write-off removes it with a reason. */
export interface InventoryTransfer {
  id: string;
  transferNumber: string;
  itemCode: string;
  itemName: string;
  unit: string;
  fromWarehouse: string;
  toWarehouse: string;
  quantity: string;
  valueKobo: string;
  status: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED';
  issuedAt: string | null;
  receivedAt: string | null;
  createdBy: string;
}

export interface InventoryWriteOff {
  id: string;
  itemCode: string;
  itemName: string;
  unit: string;
  warehouse: string;
  quantity: string;
  valueKobo: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

async function safe<T>(path: string, fallback: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch {
    return fallback;
  }
}

export async function getTransfers(): Promise<InventoryTransfer[]> {
  return safe<InventoryTransfer[]>('/inventory/transfers', []);
}

export async function getWriteOffs(): Promise<InventoryWriteOff[]> {
  return safe<InventoryWriteOff[]>('/inventory/write-offs', []);
}
