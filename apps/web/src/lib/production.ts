import 'server-only';
import { api, ApiError } from './api';

/**
 * Production/processing orders — SnailPro, PoultryPro and Feed Mill
 * (US-897-016 through 020). Every status transition is a distinct API call
 * because each one posts its own journal entries; this file only shapes the
 * reads and the request bodies, none of the accounting.
 */

export type ProductionOrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'RELEASED'
  | 'IN_PRODUCTION'
  | 'COMPLETED'
  | 'CANCELLED';

export type ProductionOrderCycle = 'SNAILPRO' | 'POULTRYPRO' | 'FEED_MILL';

export interface ProductionOrderRow {
  id: string;
  orderNumber: string;
  status: ProductionOrderStatus;
  processingCycle: ProductionOrderCycle;
  plannedOutputQuantity: string;
  finishedGoodsCostKobo: string;
  createdAt: string;
  recipeVersion: {
    recipe: {
      name: string;
      outputItemId: string;
      outputItem: { id: string; code: string; description: string };
    };
  };
}

export interface ProductionOrderComponent {
  id: string;
  lineNumber: number;
  componentItem: { code: string; description: string };
  plannedQuantity: string;
  plannedCostKobo: string;
  issuedQuantity: string | null;
  issuedCostKobo: string | null;
}

export interface ProductionOrderOutputRow {
  id: string;
  item: { code: string; description: string };
  outputType: 'MAIN' | 'BY_PRODUCT';
  quantity: string;
  allocatedCostKobo: string;
}

export interface ProductionOrderLossEvent {
  id: string;
  quantity: string;
  classification: 'NORMAL' | 'ABNORMAL';
  costKobo: string;
  reason: string | null;
  journalEntryId: string | null;
}

export interface ProductionOrderDetail extends ProductionOrderRow {
  branchId: string;
  farmId: string;
  biologicalInputValueKobo: string;
  packagingCostKobo: string;
  standardConversionCostKobo: string;
  actualLabourCostKobo: string;
  actualOverheadCostKobo: string;
  abnormalLossCostKobo: string;
  components: ProductionOrderComponent[];
  outputs: ProductionOrderOutputRow[];
  lossEvents: ProductionOrderLossEvent[];
  sourceGroup: { code: string; speciesKey: string } | null;
  harvestRecord: { harvestedOn: string; count: number; weightKg: string } | null;
}

export async function getProductionOrders(): Promise<ProductionOrderRow[]> {
  try {
    return await api<ProductionOrderRow[]>('/production-orders');
  } catch {
    return [];
  }
}

export async function getProductionOrder(id: string): Promise<ProductionOrderDetail | null> {
  try {
    return await api<ProductionOrderDetail>(`/production-orders/${id}`);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) return null;
    throw caught;
  }
}

export interface AvailableHarvest {
  id: string;
  date: string;
  groupCode: string;
  speciesKey: string;
  count: number;
  weightKg: string;
  grade: string;
}

export async function getAvailableHarvests(): Promise<AvailableHarvest[]> {
  // Restricted to the roles that can actually raise an order — a viewer
  // without that role should still see the order list, just with nothing to
  // pick from in the raise-an-order form.
  try {
    return await api<AvailableHarvest[]>('/production-orders/available-harvests');
  } catch {
    return [];
  }
}

export interface Recipe {
  id: string;
  code: string;
  name: string;
  outputItemId: string;
  outputItemCode: string;
  outputItemDescription: string;
  activeVersionId: string | null;
  activeVersionNumber: number | null;
  batchSize: string | null;
}

export async function getRecipes(): Promise<Recipe[]> {
  return api<Recipe[]>('/masters/recipes');
}
