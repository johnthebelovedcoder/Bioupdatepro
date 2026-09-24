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

export interface RecipeComponentRow {
  id: string;
  lineNumber: number;
  componentItem: { code: string; description: string };
  quantityPerBatch: string;
  unitOfMeasure: { code: string };
  wastagePercent: string | null;
  optional: boolean;
}

export type RecipeVersionStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';

export interface RecipeVersionRow {
  id: string;
  version: number;
  status: RecipeVersionStatus;
  batchSize: string;
  expectedYieldPercent: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  components: RecipeComponentRow[];
}

export interface RecipeDetail {
  recipe: {
    id: string;
    code: string;
    name: string;
    outputItemId: string;
    outputItem: { code: string; description: string };
  };
  versions: RecipeVersionRow[];
}

export async function getRecipeDetail(id: string): Promise<RecipeDetail | null> {
  try {
    return await api<RecipeDetail>(`/masters/recipes/${id}`);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) return null;
    throw caught;
  }
}

/**
 * Activity cost pools (US-897-015) — overhead, allocated to a routing
 * operation by a measurable driver rather than folded blindly into every
 * unit's cost.
 */
export interface CostPool {
  id: string;
  code: string;
  name: string;
  driverName: string;
  poolCostKobo: string | null;
  practicalCapacity: string | null;
  ratePerUnitKobo: string | null;
  sourceReference: string | null;
}

export async function getCostPools(): Promise<CostPool[]> {
  try {
    return await api<CostPool[]>('/costing/cost-pools');
  } catch {
    return [];
  }
}

/** Labour/machine standards (US-897-014) for one recipe version. */
export interface RoutingOperationRow {
  id: string;
  sequence: number;
  operationName: string;
  resourceType: 'LABOUR' | 'MACHINE';
  setupHours: string;
  runHoursPerUnit: string;
  costCentre: { code: string; name: string };
  costPool: { code: string; name: string };
}

export async function getRoutingOperations(recipeVersionId: string): Promise<RoutingOperationRow[]> {
  try {
    return await api<RoutingOperationRow[]>(`/masters/recipes/${recipeVersionId}/routing`);
  } catch {
    return [];
  }
}

/* --- Routing on an order, and idle capacity ----------------------------- */

export interface ProductionRoutingLine {
  id: string;
  standardHours: string;
  ratePerHourKobo: string;
  standardCostKobo: string;
  routingOperation: {
    sequence: number;
    operationName: string;
    resourceType: string;
    costCentre: { code: string; name: string };
    costPool: { code: string; name: string };
  };
}

/** The routing an order was costed against — snapshotted from its recipe. */
export async function getProductionRouting(orderId: string): Promise<ProductionRoutingLine[]> {
  try {
    return await api<ProductionRoutingLine[]>(`/production/orders/${orderId}/routing`);
  } catch {
    return [];
  }
}

export type UnusedCapacity =
  | { hasRate: false }
  | {
      hasRate: true;
      poolCostKobo: string;
      practicalCapacity: string;
      ratePerUnitKobo: string;
      consumedHours: string;
      unusedCapacity: string;
      unusedCapacityCostKobo: string;
    };

export async function getUnusedCapacity(poolId: string): Promise<UnusedCapacity | null> {
  try {
    return await api<UnusedCapacity>(`/costing/cost-pools/${poolId}/unused-capacity`);
  } catch {
    return null;
  }
}
