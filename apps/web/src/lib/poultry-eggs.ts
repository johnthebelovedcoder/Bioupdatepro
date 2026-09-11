import 'server-only';
import { api } from './api';

/**
 * PoultryPro egg production, incubation and hatching (Poultry_Egg_Production
 * P-EGG-01 through P-EGG-08). Three real, enforced stages — collect, set,
 * hatch — with no GL posting yet (DEC-002, egg recognition, is still open;
 * see the API's own PoultryEggService doc comment).
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
  try {
    return await api<EggBatch[]>('/poultry/eggs/collections');
  } catch {
    return [];
  }
}

export async function getIncubationBatches(): Promise<IncubationBatch[]> {
  try {
    return await api<IncubationBatch[]>('/poultry/eggs/incubations');
  } catch {
    return [];
  }
}

export async function getLayingGroups(): Promise<LayingGroup[]> {
  try {
    return await api<LayingGroup[]>('/poultry/eggs/groups');
  } catch {
    return [];
  }
}
