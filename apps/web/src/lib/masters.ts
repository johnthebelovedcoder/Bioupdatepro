import 'server-only';
import { api } from './api';

/**
 * Farms and the pens/houses inside them, from the database.
 *
 * `FarmStructureService`'s own docblock is explicit about what is real and
 * what is not: a pen is deliberately thin — a code, a name, the farm it
 * belongs to — because capacity, house type and environmental limits are not
 * in any source document yet, and inventing a capacity field would put a
 * number on screen nobody had measured. Callers that used to show a capacity
 * meter have nothing here to show one with, and should not invent one either.
 */

export interface Farm {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export async function getFarms(): Promise<Farm[]> {
  return api<Farm[]>('/masters/farms');
}

export interface Pen {
  id: string;
  code: string;
  name: string;
  active: boolean;
  farmId: string;
  farmName: string;
}

export async function getPens(): Promise<Pen[]> {
  return api<Pen[]>('/masters/pens');
}

/**
 * Stock on hand, from the `StockMovement` ledger — never a stored balance.
 * Money in kobo as integer strings, matching the API's own convention.
 */
export interface StockItem {
  id: string;
  code: string;
  name: string;
  category: string | null;
  unit: string;
  onHand: number;
  /** Null when nobody has configured one — distinct from a reorder level of zero. */
  reorderLevel: number | null;
  unitCostKobo: string;
  valueKobo: string;
  lastMovedOn: string | null;
}

export async function getStockItems(): Promise<StockItem[]> {
  return api<StockItem[]>('/masters/items/stock');
}

export interface StockMovementRow {
  id: string;
  itemCode: string;
  itemName: string;
  unit: string;
  direction: 'IN' | 'OUT';
  quantity: number;
  reference: string;
  date: string;
}

export async function getStockMovements(limit = 30): Promise<StockMovementRow[]> {
  return api<StockMovementRow[]>(`/masters/stock-movements?limit=${limit}`);
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  type: string;
  active: boolean;
}

export async function getWarehouses(): Promise<Warehouse[]> {
  return api<Warehouse[]>('/masters/warehouses');
}
