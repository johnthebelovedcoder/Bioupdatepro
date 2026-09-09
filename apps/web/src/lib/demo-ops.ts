/**
 * Type contracts for the operational reads, plus one fixture still in use.
 *
 * `lib/operations.ts` now reads production, feeding, health, performance,
 * stage-breakdown and harvest data from the real API — this file used to
 * generate all of it. What is left is the interfaces those real functions are
 * written against (so a page and its data source cannot quietly disagree on
 * shape), and `getBreedingCycles()`, which stays a fixture because no
 * breeding/incubation model exists in the backend yet. Screens using it still
 * show the `<DemoFlag />` marker.
 *
 * Money is in KOBO as integer strings, matching the API.
 */

import type { BatchSummary } from './demo';

const ANCHOR = Date.UTC(2026, 7, 10);

function daysAgo(days: number): string {
  return new Date(ANCHOR - days * 86_400_000).toISOString();
}

/* -------------------------------------------------------------------------- */

export interface ProductionRow {
  date: string;
  groupCode: string;
  house: string;
  /** Keyed by the module's production field keys. */
  values: Record<string, number>;
  /** Layers only: eggs as a percentage of live birds that day. */
  rate: number | null;
  population: number;
}

export interface FeedingRow {
  date: string;
  groupCode: string;
  house: string;
  feedType: string;
  kg: number;
  population: number;
  /** Grams per animal per day — the figure a manager actually watches. */
  gramsPerHead: number;
  costKobo: string;
}

export interface HealthEvent {
  id: string;
  groupCode: string;
  house: string;
  kind: 'VACCINATION' | 'TREATMENT' | 'INCIDENT';
  name: string;
  detail: string;
  dueOn: string;
  administeredOn: string | null;
  administeredBy: string | null;
  status: 'DONE' | 'DUE' | 'OVERDUE' | 'OPEN';
}

export interface PerformanceRow {
  group: BatchSummary;
  /** Feed conversion: kg feed per kg gain, or per 1,000 eggs for layers. */
  fcr: number | null;
  /** Hen-day production, layers only. */
  layRate: number | null;
  mortalityRate: number;
  /** The breed standard for comparison, where one is configured. */
  standardMortality: number | null;
  standardLayRate: number | null;
  costPerHeadKobo: string;
  feedCostShare: number;
}

/* -------------------------------------------------------------------------- */

export interface BreedingCycle {
  id: string;
  colonyCode: string;
  setOn: string;
  breeders: number;
  eggsLaid: number;
  hatchlings: number | null;
  hatchRate: number | null;
  status: 'INCUBATING' | 'HATCHED';
}

export async function getBreedingCycles(): Promise<BreedingCycle[]> {
  return [
    {
      id: 'bc4',
      colonyCode: 'S-001',
      setOn: daysAgo(12),
      breeders: 320,
      eggsLaid: 468,
      hatchlings: null,
      hatchRate: null,
      status: 'INCUBATING',
    },
    {
      id: 'bc3',
      colonyCode: 'S-001',
      setOn: daysAgo(44),
      breeders: 300,
      eggsLaid: 450,
      hatchlings: 381,
      hatchRate: 84.7,
      status: 'HATCHED',
    },
    {
      id: 'bc2',
      colonyCode: 'S-001',
      setOn: daysAgo(78),
      breeders: 285,
      eggsLaid: 412,
      hatchlings: 340,
      hatchRate: 82.5,
      status: 'HATCHED',
    },
    {
      id: 'bc1',
      colonyCode: 'S-001',
      setOn: daysAgo(112),
      breeders: 270,
      eggsLaid: 398,
      hatchlings: 349,
      hatchRate: 87.7,
      status: 'HATCHED',
    },
  ];
}

/* -------------------------------------------------------------------------- */

export interface StageBucket {
  stage: string;
  population: number;
  groups: string[];
}

/* -------------------------------------------------------------------------- */

export interface HarvestRow {
  id: string;
  date: string;
  colonyCode: string;
  kg: number;
  count: number;
  grade: string;
  destination: string;
  valueKobo: string;
}
