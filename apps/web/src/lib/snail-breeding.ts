import 'server-only';
import { api, optional } from './api';

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
  return api<SnailBreedingCycle[]>('/snail-breeding/cycles');
}

export async function getBreederGroups(): Promise<BreederGroup[]> {
  return optional('the breeder groups', () => api<BreederGroup[]>('/snail-breeding/breeders'), []);
}

export async function getSnailEggCostSources(): Promise<SnailEggCostSource[]> {
  return optional('the egg cost sources', () => api<SnailEggCostSource[]>('/snail-breeding/egg-cost-sources'), []);
}
