/**
 * DEMONSTRATION DATA — NOT REAL FARM RECORDS.
 *
 * The operational half of the product (farms, batches, feeding, mortality,
 * production) has no backend yet. These fixtures let the interface be designed
 * and reviewed against realistic shapes and magnitudes before the API exists.
 *
 * Two rules govern everything in this file:
 *
 *   1. Every screen rendering any of it MUST show the <DemoFlag /> marker. The
 *      product specification is explicit that demonstration figures must never
 *      be mistakable for a farm's real performance, and a plausible fake number
 *      on a financial screen is worse than a blank one.
 *
 *   2. Nothing here is imported by a screen that has a real API. The ledger
 *      screens read live data and must stay that way.
 *
 * Every function is async and returns the shape the eventual endpoint should
 * return, so replacing this module with `api()` calls is a swap at one seam
 * rather than a rewrite of the pages.
 *
 * Money is in KOBO, as integers, matching the API's convention exactly.
 */

import { getBatches } from './demo-register';

export { getBatches, getGroups, getGroupDetail } from './demo-register';

export const IS_DEMO = true;

export interface FarmSummary {
  totalBirds: number;
  totalSnails: number;
  eggsToday: number;
  eggsYesterday: number;
  mortalityToday: number;
  mortalityAverage: number;
  feedStockKg: number;
  activeBatches: number;
}

export interface MoneySummary {
  revenueKobo: string;
  expenseKobo: string;
  revenuePriorKobo: string;
  expensePriorKobo: string;
  receivableKobo: string;
}

export interface ProductionPoint {
  date: string;
  eggs: number;
  mortality: number;
}

export interface StockAlert {
  item: string;
  currentKg: number;
  reorderKg: number;
}

export interface UpcomingTask {
  id: string;
  title: string;
  detail: string;
  due: string;
  urgency: 'overdue' | 'today' | 'soon';
}

export interface ActivityEntry {
  id: string;
  time: string;
  title: string;
  detail: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  kind: 'production' | 'feed' | 'mortality' | 'sale' | 'purchase' | 'task';
}

/**
 * One managed population — a poultry flock or a snail cohort.
 *
 * Deliberately species-agnostic in shape. Everything species-specific about it
 * is either a free-text value the farm supplies (breed, purpose, stage) or comes
 * from the module registry's terminology. That is what lets one register render
 * both, and what will let it render a fish stock later.
 */
export interface BatchSummary {
  id: string;
  code: string;
  species: 'POULTRY' | 'SNAIL';
  breed: string;
  purpose: string;
  house: string;
  /** Where in its lifecycle. Values come from the module's `stages`. */
  stage: string;
  population: number;
  openingPopulation: number;
  ageDays: number;
  mortalityRate: number;
  status: 'ACTIVE' | 'CLOSED';
  /** When the population was placed or stocked. */
  startedOn: string;
  source: string;
  /** Cost accumulated against this population so far, in kobo. */
  costToDateKobo: string;
  /** What it has earned so far. Zero until it produces or is sold. */
  revenueToDateKobo: string;
}

export interface GroupEvent {
  id: string;
  occurredOn: string;
  type: 'PLACEMENT' | 'FEED' | 'MORTALITY' | 'PRODUCTION' | 'TREATMENT' | 'STAGE' | 'HARVEST';
  summary: string;
  detail: string;
  quantity: string | null;
  recordedBy: string;
}

export interface GroupDetail extends BatchSummary {
  /** Population on each of the last fourteen days. */
  populationSeries: Array<{ date: string; value: number }>;
  /** Deaths on each of the last fourteen days. */
  mortalitySeries: Array<{ date: string; value: number }>;
  events: GroupEvent[];
  costBreakdown: Array<{ label: string; kobo: string }>;
  expectedEndOn: string | null;
}

/* -------------------------------------------------------------------------- */

export async function getFarmSummary(): Promise<FarmSummary> {
  return {
    totalBirds: 8450,
    totalSnails: 12300,
    eggsToday: 6240,
    eggsYesterday: 6015,
    mortalityToday: 17,
    mortalityAverage: 12,
    feedStockKg: 2800,
    activeBatches: 7,
  };
}

export async function getMoneySummary(): Promise<MoneySummary> {
  return {
    revenueKobo: '480000000', // ₦4,800,000.00
    expenseKobo: '310000000', // ₦3,100,000.00
    revenuePriorKobo: '426000000',
    expensePriorKobo: '298000000',
    receivableKobo: '87500000',
  };
}

/**
 * Daily production, ending at a fixed anchor.
 *
 * The last fortnight is written out so the chart has a real shape — a dip and a
 * mortality spike on the same days, which is what makes the two charts worth
 * reading side by side. Anything longer is generated around the same level.
 *
 * Dates come from a fixed anchor rather than "today", so the series does not
 * silently change shape between page loads while the UI is being reviewed.
 */
export async function getProductionSeries(days = 14): Promise<ProductionPoint[]> {
  const recentEggs = [
    5980, 6040, 6110, 6075, 6180, 6220, 6150, 5890, 5620, 5740, 5980, 6100, 6015, 6240,
  ];
  const recentMortality = [9, 11, 8, 10, 12, 9, 13, 24, 31, 19, 14, 11, 13, 17];

  const anchor = Date.UTC(2026, 7, 10);
  const points: ProductionPoint[] = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    // Index back from the end, so the hand-written fortnight always lands on
    // the most recent days whatever window is asked for.
    const recentIndex = recentEggs.length - 1 - offset;
    const known = recentIndex >= 0;
    const wave = Math.sin(offset / 5.5);
    points.push({
      date: new Date(anchor - offset * 86_400_000).toISOString(),
      eggs: known ? (recentEggs[recentIndex] ?? 0) : Math.round(6050 + wave * 190),
      mortality: known ? (recentMortality[recentIndex] ?? 0) : Math.round(13 + wave * 5),
    });
  }

  return points;
}

export async function getStockAlerts(): Promise<StockAlert[]> {
  return [
    { item: 'Layer mash', currentKg: 240, reorderKg: 500 },
    { item: 'Snail feed concentrate', currentKg: 70, reorderKg: 100 },
    { item: 'Broiler finisher', currentKg: 430, reorderKg: 500 },
  ];
}

export async function getUpcomingTasks(): Promise<UpcomingTask[]> {
  return [
    {
      id: 't1',
      title: 'Feed inventory restock',
      detail: 'Layer mash below reorder level',
      due: 'Today',
      urgency: 'today',
    },
    {
      id: 't2',
      title: 'Vaccination — Flock L-2026-003',
      detail: 'Lasota booster, 1,950 birds',
      due: 'Tomorrow',
      urgency: 'soon',
    },
    {
      id: 't3',
      title: 'Weekly stock count',
      detail: 'Feed store and packaging',
      due: 'In 2 days',
      urgency: 'soon',
    },
    {
      id: 't4',
      title: 'Generator service',
      detail: '250 hours since last service',
      due: 'In 3 days',
      urgency: 'soon',
    },
  ];
}

export async function getRecentActivity(): Promise<ActivityEntry[]> {
  return [
    {
      id: 'a1',
      time: '18:00',
      title: 'Daily farm report submitted',
      detail: 'Adaeze Okonkwo · Main Farm',
      tone: 'neutral',
      kind: 'task',
    },
    {
      id: 'a2',
      time: '16:40',
      title: 'Egg order created',
      detail: 'Sunrise Foods · 120 crates',
      tone: 'success',
      kind: 'sale',
    },
    {
      id: 'a3',
      time: '14:20',
      title: 'Layer mash received',
      detail: '2,000 kg from Greenfields Feeds',
      tone: 'info',
      kind: 'purchase',
    },
    {
      id: 'a4',
      time: '11:30',
      title: 'Snail feeding completed',
      detail: 'Cohort S-001 · 18 kg',
      tone: 'neutral',
      kind: 'feed',
    },
    {
      id: 'a5',
      time: '09:00',
      title: 'Mortality recorded',
      detail: 'Flock L-2026-001 · 5 birds · heat stress',
      tone: 'danger',
      kind: 'mortality',
    },
    {
      id: 'a6',
      time: '08:15',
      title: 'Egg collection recorded',
      detail: 'Poultry House 1 · 1,602 whole, 24 cracked',
      tone: 'success',
      kind: 'production',
    },
    {
      id: 'a7',
      time: '06:30',
      title: 'Feed distributed',
      detail: 'Poultry House 1 · 245 kg layer mash',
      tone: 'neutral',
      kind: 'feed',
    },
  ];
}

/* -------------------------------------------------------------------------- */

export interface MetricFigure {
  value: string;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string };
}

export interface ModuleOverview {
  groupCount: number;
  /** Keyed by the metric keys the module registry declares. */
  metrics: Record<string, MetricFigure | undefined>;
  chartTitle: string;
  chartUnit: string;
  outputSeries: Array<{ date: string; value: number }>;
  mortalitySeries: Array<{ date: string; value: number }>;
  groups: BatchSummary[];
}

/**
 * The overview figures for one species module.
 *
 * Keyed by module so the same page serves poultry, snails and anything added
 * later. The metric keys returned must match those the module registry
 * declares, which is what lets the page render whichever three a module cares
 * about without knowing what they mean.
 */
export async function getModuleOverview(key: string, days = 14): Promise<ModuleOverview> {
  const series = await getProductionSeries(days);
  const all = await getBatches();

  if (key === 'snail') {
    // Active only: the overview describes what is running now, and the page
    // labels this count 'active'. Including closed populations made it
    // disagree with the register, which filters them out by default.
    const groups = all.filter(
      (batch) => batch.species === 'SNAIL' && batch.status === 'ACTIVE',
    );
    const population = groups.reduce((sum, group) => sum + group.population, 0);
    // Snail output is harvested weight, on a slower cadence than egg laying.
    // Repeat the pattern to fill whatever window was asked for; harvesting is
    // episodic, so most days are legitimately zero.
    const harvestCycle = [0, 0, 42, 0, 0, 61, 0, 0, 0, 55, 0, 0, 78, 0];
    const deathCycle = [14, 11, 9, 16, 21, 13, 10, 12, 19, 24, 15, 11, 13, 17];
    const harvest = series.map((_, i) => harvestCycle[i % harvestCycle.length] ?? 0);
    const deaths = series.map((_, i) => deathCycle[i % deathCycle.length] ?? 0);
    return {
      groupCount: groups.length,
      metrics: {
        population: { value: population.toLocaleString('en-NG') },
        hatchRate: { value: '84.7%', trend: { direction: 'up', label: '2.1%' } },
        mortality: { value: '5.1%', trend: { direction: 'down', label: '0.4%' } },
        feed: { value: '46 kg' },
      },
      chartTitle: 'Harvest weight',
      chartUnit: 'kg',
      outputSeries: series.map((point, index) => ({
        date: point.date,
        value: harvest[index] ?? 0,
      })),
      mortalitySeries: series.map((point, index) => ({
        date: point.date,
        value: deaths[index] ?? 0,
      })),
      groups,
    };
  }

  const groups = all.filter(
    (batch) => batch.species === 'POULTRY' && batch.status === 'ACTIVE',
  );
  const population = groups.reduce((sum, group) => sum + group.population, 0);
  return {
    groupCount: groups.length,
    metrics: {
      population: { value: population.toLocaleString('en-NG') },
      eggs: {
        value: '6,240',
        trend: { direction: 'up', label: '3.7%' },
      },
      mortality: { value: '3.1%', trend: { direction: 'up', label: '0.6%' } },
      feed: { value: '1.24 t' },
    },
    chartTitle: 'Egg production',
    chartUnit: 'eggs',
    outputSeries: series.map((point) => ({ date: point.date, value: point.eggs })),
    mortalitySeries: series.map((point) => ({ date: point.date, value: point.mortality })),
    groups,
  };
}

