import 'server-only';
import { api } from './api';

/**
 * PoultryPro egg production, incubation and hatching (Poultry_Egg_Production
 * P-EGG-01 through P-EGG-08). Three real, enforced stages — collect, set,
 * hatch — each posted to the ledger once the farm has set an egg value
 * (DEC-002, answered 2026-09-24; see EggPostingService and Books → Farm
 * costing).
 */

export interface EggBatch {
  id: string;
  code: string;
  collectedOn: string;
  totalCount: number;
  hatchingCount: number;
  tableCount: number;
  rejectCount: number;
  hatchingRemaining: number;
  notes: string | null;
  sourceGroup: { code: string; breed: string };
  incubationBatches: Array<{
    id: string;
    code: string;
    setQuantity: number;
    status: 'SET' | 'HATCHED';
  }>;
}

export interface IncubationBatch {
  id: string;
  code: string;
  setOn: string;
  setQuantity: number;
  incubator: string | null;
  status: 'SET' | 'HATCHED';
  eggBatch: { code: string };
  hatchEvent: { hatchedCount: number; unhatchedCount: number; damagedCount: number } | null;
}

export interface LayingGroup {
  id: string;
  code: string;
  stage: string;
  population: number;
}

export async function getEggBatches(): Promise<EggBatch[]> {
  return api<EggBatch[]>('/poultry/eggs/collections');
}

export async function getIncubationBatches(): Promise<IncubationBatch[]> {
  return api<IncubationBatch[]>('/poultry/eggs/incubations');
}

/**
 * `null` when the list could not be read at all, which is not the same as the
 * farm having no flocks: swallowing a refusal into an empty array made the
 * collection form tell a supervisor "No active poultry flock" while four were
 * laying. The caller has to say which it is.
 */
export async function getLayingGroups(): Promise<LayingGroup[] | null> {
  try {
    return await api<LayingGroup[]>('/poultry/eggs/groups');
  } catch (caught) {
    console.error('Could not read the laying flocks for the egg collection form', caught);
    return null;
  }
}
