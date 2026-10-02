import 'server-only';
import { api } from './api';

export interface SnailBreedingCycle {
  id: string;
  code: string;
  breederGroupCode: string | null;
  setOn: string;
  breeders: number;
  eggsLaid: number;
  eggGroupCode: string | null;
  eggValueBasis: 'FVLCTS' | 'ATTRIBUTABLE_COST' | null;
  eggValuePerUnitKobo: string;
  eggValueEvidence: string | null;
  eggFairValueUnreliableReason: string | null;
  status: 'SET' | 'HATCHED' | 'FAILED';
  hatchedOn: string | null;
  hatchedCount: number | null;
  unhatchedCount: number | null;
  hatchRate: number | null;
  hatchlingGroupCode: string | null;
  failedReason: string | null;
  notes: string | null;
}

export interface BreederGroup {
  id: string;
  code: string;
  stage: string;
  population: number;
}

export interface SnailEggCostSource { id: string; accountNumber: string; name: string }

export async function getSnailBreedingCycles(): Promise<SnailBreedingCycle[]> {
  try {
    return await api<SnailBreedingCycle[]>('/snail-breeding/cycles');
  } catch {
    return [];
  }
}

export async function getBreederGroups(): Promise<BreederGroup[]> {
  try {
    return await api<BreederGroup[]>('/snail-breeding/breeders');
  } catch {
    return [];
  }
}

export async function getSnailEggCostSources(): Promise<SnailEggCostSource[]> {
  try { return await api<SnailEggCostSource[]>('/snail-breeding/egg-cost-sources'); } catch { return []; }
}
