import 'server-only';
import { api } from './api';

/**
 * Farm costing — the three postings built on 2026-09-24 to the farm's own
 * answers: eggs at a dated value per crate (PCR-067), labour and overhead
 * shared across populations by animal-days (PCR-028/043/064), and machine
 * depreciation to its processing line (PCR-031, set on Fixed assets).
 */

export interface EggValuePolicy {
  id: string;
  effectiveFrom: string;
  eggsPerUnit: number;
  valuePerUnitKobo: string;
  item: { id: string; code: string; description: string } | null;
}

export interface AllocationSource {
  glAccountId: string;
  accountNumber: string;
  accountName: string;
  costCentreId: string | null;
  costCentre: string | null;
  availableKobo: string;
}

export interface PopulationShare {
  groupId: string;
  code: string;
  speciesKey: string;
  animalDays: string;
  amountKobo: string;
}

export interface AllocationRow {
  id: string;
  reference: string;
  period: string;
  totalKobo: string;
  createdAt: string;
  journalNumber: string | null;
  reversedBy: string | null;
  lines: Array<{ group: string; speciesKey: string; animalDays: string; amountKobo: string }>;
}

export async function getEggValuePolicies(): Promise<EggValuePolicy[]> {
  return api<EggValuePolicy[]>('/poultry/eggs/value-policies');
}

export async function getAllocationSources(periodId: string): Promise<AllocationSource[]> {
  return api<AllocationSource[]>(`/cost-allocation/sources?periodId=${encodeURIComponent(periodId)}`);
}

/** Animal-days per population; `amountKobo` is zero because no amount is chosen yet. */
export async function getPopulationShares(periodId: string): Promise<PopulationShare[]> {
  return api<PopulationShare[]>(`/cost-allocation/preview?periodId=${encodeURIComponent(periodId)}&totalKobo=0`);
}

export async function getAllocations(): Promise<AllocationRow[]> {
  return api<AllocationRow[]>('/cost-allocation');
}
