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
  /** Hatching eggs' own price per unit; null = the table price. */
  hatchingValuePerUnitKobo: string | null;
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
  /** Timesheet hours in the period — only on the HOURS basis. */
  hours: string | null;
  weight: string;
  amountKobo: string;
}

export type AllocationBasis = 'ANIMAL_DAYS' | 'HOURS';

export interface AllocationRow {
  id: string;
  reference: string;
  basis: AllocationBasis;
  period: string;
  totalKobo: string;
  createdAt: string;
  journalNumber: string | null;
  reversedBy: string | null;
  lines: Array<{ group: string; speciesKey: string; animalDays: string; hours: string | null; amountKobo: string }>;
}

export async function getEggValuePolicies(): Promise<EggValuePolicy[]> {
  return api<EggValuePolicy[]>('/poultry/eggs/value-policies');
}

export async function getAllocationSources(periodId: string): Promise<AllocationSource[]> {
  return api<AllocationSource[]>(`/cost-allocation/sources?periodId=${encodeURIComponent(periodId)}`);
}

/** Each population's weight on a basis; `amountKobo` is zero because no amount is chosen yet. */
export async function getPopulationShares(periodId: string, basis: AllocationBasis = 'ANIMAL_DAYS'): Promise<PopulationShare[]> {
  return api<PopulationShare[]>(`/cost-allocation/preview?periodId=${encodeURIComponent(periodId)}&totalKobo=0&basis=${basis}`);
}

export interface TimesheetRow {
  id: string;
  workDate: string;
  employeeId: string;
  employee: string;
  groupId: string;
  group: string;
  hours: string;
  notes: string | null;
}

export async function getTimesheets(from: string, to: string): Promise<TimesheetRow[]> {
  return api<TimesheetRow[]>(`/cost-allocation/timesheets?from=${from}&to=${to}`);
}

export async function getTimesheetChoices(): Promise<{
  employees: Array<{ id: string; name: string; number: string }>;
  groups: Array<{ id: string; code: string; speciesKey: string }>;
}> {
  return api('/cost-allocation/timesheets/choices');
}

export async function getAllocations(): Promise<AllocationRow[]> {
  return api<AllocationRow[]>('/cost-allocation');
}
