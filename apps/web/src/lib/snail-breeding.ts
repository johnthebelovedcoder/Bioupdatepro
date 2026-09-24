import 'server-only';
import { api } from './api';

export interface SnailBreedingCycle {
  id: string;
  code: string;
  breederGroupCode: string | null;
  setOn: string;
  breeders: number;
  eggsLaid: number;
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
