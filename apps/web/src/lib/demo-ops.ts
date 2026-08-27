/**
 * DEMONSTRATION DATA — NOT REAL FARM RECORDS.
 *
 * Fixtures for the operational screens: production, feeding, health,
 * performance, breeding, growth, harvest, farm structure and the activity log.
 *
 * Shapes are what the eventual endpoints should return, so each page swaps to
 * `api()` at one seam. Money is in KOBO as integer strings, matching the API.
 * Every screen rendering any of it shows the <DemoFlag /> marker.
 */

import { getGroups } from './demo-register';
import type { BatchSummary } from './demo';

const ANCHOR = Date.UTC(2026, 7, 10);

function daysAgo(days: number): string {
  return new Date(ANCHOR - days * 86_400_000).toISOString();
}

/** Deterministic pseudo-random, so the fixture does not change between loads. */
function wobble(seed: number, spread: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * spread;
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

/**
 * Fourteen days of production per producing population.
 *
 * Only populations that actually produce appear — a batch of growers lays no
 * eggs, and padding the table with zero rows would bury the ones that matter.
 */
export async function getProduction(
  moduleKey: string,
  days = 14,
): Promise<ProductionRow[]> {
  const groups = (await getGroups(moduleKey)).filter((group) => group.status === 'ACTIVE');
  const rows: ProductionRow[] = [];

  for (const group of groups) {
    const producing =
      moduleKey === 'snail'
        ? group.purpose !== 'Juveniles'
        : group.stage === 'Layer' || group.stage === 'Point-of-lay';
    if (!producing) continue;

    for (let day = days - 1; day >= 0; day -= 1) {
      const seed = group.id.length * 31 + day;
      if (moduleKey === 'snail') {
        // Harvest is episodic, not daily.
        const harvesting = day % 4 === 1;
        if (!harvesting) continue;
        const kg = Math.round(55 + wobble(seed, 18));
        rows.push({
          date: daysAgo(day),
          groupCode: group.code,
          house: group.house,
          values: { harvestKg: kg, harvestCount: kg * 12, eggsLaid: Math.max(0, Math.round(6 + wobble(seed, 4))) },
          rate: null,
          population: group.population,
        });
      } else {
        const rate = 0.84 + wobble(seed, 0.06);
        const whole = Math.round(group.population * rate);
        rows.push({
          date: daysAgo(day),
          groupCode: group.code,
          house: group.house,
          values: {
            whole,
            cracked: Math.max(0, Math.round(whole * 0.015 + wobble(seed, 4))),
            dirty: Math.max(0, Math.round(whole * 0.019 + wobble(seed, 5))),
          },
          rate: Number((rate * 100).toFixed(1)),
          population: group.population,
        });
      }
    }
  }

  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/* -------------------------------------------------------------------------- */

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

export async function getFeeding(moduleKey: string, days = 14): Promise<FeedingRow[]> {
  const groups = (await getGroups(moduleKey)).filter((group) => group.status === 'ACTIVE');
  const snail = moduleKey === 'snail';
  const rows: FeedingRow[] = [];

  for (const group of groups) {
    for (let day = days - 1; day >= 0; day -= 1) {
      const seed = group.code.length * 17 + day;

      /*
       * L-2026-003 deliberately runs about 18% heavy on feed.
       *
       * A detector that never fires cannot be reviewed, so the fixture contains
       * one genuine, plausible anomaly for the variance watch to find: a single
       * layer house consistently over-consuming against its identical
       * neighbour. On a real farm this pattern is over-feeding, a jammed
       * feeder, a mis-counted flock, or feed leaving the property — which is
       * exactly why the finding reports the discrepancy and refuses to name a
       * cause.
       */
      const bias = group.code === 'L-2026-003' ? 1.18 : 1;
      const perHead = snail
        ? 2.1 + wobble(seed, 0.3)
        : (118 + wobble(seed, 9)) * bias;
      const kg = Math.max(1, Math.round((group.population * perHead) / 1000));
      // ₦620/kg poultry feed, ₦410/kg snail concentrate — illustrative.
      const rate = snail ? 41_000 : 62_000;
      rows.push({
        date: daysAgo(day),
        groupCode: group.code,
        house: group.house,
        feedType: snail ? 'Snail feed concentrate' : feedFor(group),
        kg,
        population: group.population,
        gramsPerHead: Number(perHead.toFixed(1)),
        costKobo: String(kg * rate),
      });
    }
  }

  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

function feedFor(group: BatchSummary): string {
  if (group.purpose === 'Broiler') return group.ageDays > 21 ? 'Broiler finisher' : 'Broiler starter';
  if (group.purpose === 'Pullet') return 'Grower mash';
  return 'Layer mash';
}

/* -------------------------------------------------------------------------- */

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

export async function getHealth(moduleKey: string): Promise<HealthEvent[]> {
  const groups = (await getGroups(moduleKey)).filter((group) => group.status === 'ACTIVE');
  const events: HealthEvent[] = [];

  if (moduleKey === 'snail') {
    for (const group of groups) {
      events.push({
        id: `${group.id}-h1`,
        groupCode: group.code,
        house: group.house,
        kind: 'INCIDENT',
        name: 'Shell softening',
        detail: 'Calcium supplementation increased; pen humidity raised to 80%',
        dueOn: daysAgo(9),
        administeredOn: daysAgo(9),
        administeredBy: 'Chinedu Eze',
        status: 'DONE',
      });
      events.push({
        id: `${group.id}-h2`,
        groupCode: group.code,
        house: group.house,
        kind: 'TREATMENT',
        name: 'Pen disinfection',
        detail: 'Routine — every 28 days',
        dueOn: daysAgo(-3),
        administeredOn: null,
        administeredBy: null,
        status: 'DUE',
      });
    }
    return events.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  }

  // A standard Nigerian layer/broiler programme. Days are from placement.
  const schedule = [
    { day: 1, name: "Marek's disease", detail: 'Subcutaneous, at the hatchery' },
    { day: 10, name: 'Gumboro (IBD)', detail: 'Drinking water' },
    { day: 14, name: 'Newcastle (Lasota)', detail: 'Drinking water' },
    { day: 21, name: 'Gumboro booster', detail: 'Drinking water' },
    { day: 28, name: 'Fowl pox', detail: 'Wing web' },
    { day: 56, name: 'Newcastle booster', detail: 'Drinking water' },
  ];

  /*
   * The demo farm is modelled as behind on one vaccination.
   *
   * Every active batch is older than the last item in the programme, so a farm
   * that is perfectly up to date leaves nothing due and nothing overdue — which
   * makes the overdue alert and the record-a-treatment path unreachable, and
   * the screens that matter most when something has been missed are the ones
   * nobody would ever see. Being behind on something is also the ordinary state
   * of a real farm.
   */
  const missed = new Set(['B-2026-007:28']);

  for (const group of groups) {
    for (const item of schedule) {
      // Four weeks of lookahead rather than two: a vaccination that needs
      // ordering is worth seeing before the week it is due.
      if (item.day > group.ageDays + 28) continue;
      const done = !missed.has(`${group.code}:${item.day}`) && item.day <= group.ageDays - 2;
      const overdue = !done && item.day < group.ageDays;
      events.push({
        id: `${group.id}-${item.day}`,
        groupCode: group.code,
        house: group.house,
        kind: 'VACCINATION',
        name: item.name,
        detail: item.detail,
        dueOn: daysAgo(group.ageDays - item.day),
        administeredOn: done ? daysAgo(group.ageDays - item.day) : null,
        administeredBy: done ? 'Ibrahim Danjuma' : null,
        status: done ? 'DONE' : overdue ? 'OVERDUE' : 'DUE',
      });
    }
  }

  return events.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/* -------------------------------------------------------------------------- */

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

export async function getPerformance(moduleKey: string): Promise<PerformanceRow[]> {
  const groups = (await getGroups(moduleKey)).filter((group) => group.status === 'ACTIVE');

  return groups.map((group) => {
    const layer = group.stage === 'Layer' || group.stage === 'Point-of-lay';
    const cost = BigInt(group.costToDateKobo);
    return {
      group,
      fcr: moduleKey === 'snail' ? null : layer ? null : Number((1.62 + wobble(group.code.length, 0.12)).toFixed(2)),
      layRate: layer ? Number((84 + wobble(group.code.length, 3)).toFixed(1)) : null,
      mortalityRate: group.mortalityRate,
      // Null on purpose: no breed standard has been supplied, and inventing one
      // would put a fabricated benchmark next to a real number.
      standardMortality: null,
      standardLayRate: null,
      costPerHeadKobo: group.population > 0 ? String(cost / BigInt(group.population)) : '0',
      feedCostShare: moduleKey === 'snail' ? 0.42 : 0.55,
    };
  });
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

/** Population by lifecycle stage — the shape of the flock or cohort. */
export async function getStageBreakdown(
  moduleKey: string,
  stages: string[],
): Promise<StageBucket[]> {
  const groups = (await getGroups(moduleKey)).filter((group) => group.status === 'ACTIVE');
  return stages
    .map((stage) => {
      const members = groups.filter((group) => group.stage === stage);
      return {
        stage,
        population: members.reduce((sum, group) => sum + group.population, 0),
        groups: members.map((group) => group.code),
      };
    })
    .filter((bucket) => bucket.population > 0);
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

export async function getHarvests(): Promise<HarvestRow[]> {
  const rows: Array<[number, string, number, string]> = [
    [1, 'S-004', 78, 'Table size'],
    [4, 'S-004', 55, 'Table size'],
    [8, 'S-004', 61, 'Table size'],
    [12, 'S-004', 42, 'Table size'],
    [16, 'S-001', 34, 'Breeding stock'],
  ];
  return rows.map(([day, colony, kg, grade], index) => ({
    id: `h${index}`,
    date: daysAgo(day),
    colonyCode: colony,
    kg,
    count: kg * 12,
    grade,
    destination: grade === 'Breeding stock' ? 'Cohort S-006' : 'Finished goods',
    valueKobo: String(kg * 350_000),
  }));
}

/* -------------------------------------------------------------------------- */

export interface HouseNode {
  name: string;
  capacity: number;
  populations: Array<{ code: string; population: number; purpose: string; stage: string }>;
}

export interface FarmNode {
  name: string;
  code: string;
  state: string;
  manager: string;
  houses: HouseNode[];
}

/** The farm hierarchy, with what is actually living in each house. */
export async function getFarmStructure(): Promise<FarmNode[]> {
  const [poultry, snail] = await Promise.all([getGroups('poultry'), getGroups('snail')]);
  const active = [...poultry, ...snail].filter((group) => group.status === 'ACTIVE');

  const capacities: Record<string, number> = {
    'Poultry House 1': 2200,
    'Poultry House 2': 2200,
    'Brooder House': 3000,
    'Broiler Pen 1': 5000,
    'Broiler Pen 2': 5000,
    'Snail Section A': 4000,
    'Snail Section B': 12000,
    'Snail Nursery': 6000,
  };

  const houseNames = [...new Set(active.map((group) => group.house))].sort();
  const houses: HouseNode[] = houseNames.map((name) => ({
    name,
    capacity: capacities[name] ?? 0,
    populations: active
      .filter((group) => group.house === name)
      .map((group) => ({
        code: group.code,
        population: group.population,
        purpose: group.purpose,
        stage: group.stage,
      })),
  }));

  return [
    {
      name: 'Main Farm',
      code: 'MAIN-FARM',
      state: 'Ogun',
      manager: 'Chinedu Eze',
      houses,
    },
  ];
}

/* -------------------------------------------------------------------------- */

export interface ActivityDay {
  date: string;
  entries: Array<{
    id: string;
    time: string;
    title: string;
    detail: string;
    kind: 'production' | 'feed' | 'mortality' | 'sale' | 'purchase' | 'health' | 'task';
    by: string;
  }>;
}

/** The farm's operational history, grouped by day. */
export async function getActivityLog(): Promise<ActivityDay[]> {
  return [
    {
      date: daysAgo(0),
      entries: [
        { id: 'a1', time: '18:00', title: 'Daily round submitted', detail: 'PoultryPro · 4 houses', kind: 'task', by: 'Adaeze Okonkwo' },
        { id: 'a2', time: '16:40', title: 'Egg order created', detail: 'Sunrise Foods · 120 crates', kind: 'sale', by: 'Funmilayo Adeyemi' },
        { id: 'a3', time: '14:20', title: 'Layer mash received', detail: '2,000 kg from Greenfields Feeds', kind: 'purchase', by: 'Chinedu Eze' },
        { id: 'a4', time: '11:30', title: 'Snail feeding completed', detail: 'Cohort S-001 · 18 kg', kind: 'feed', by: 'Adaeze Okonkwo' },
        { id: 'a5', time: '09:00', title: 'Mortality recorded', detail: 'Flock L-2026-001 · 5 birds · heat stress', kind: 'mortality', by: 'Adaeze Okonkwo' },
        { id: 'a6', time: '08:15', title: 'Egg collection recorded', detail: 'Poultry House 1 · 1,602 whole, 24 cracked', kind: 'production', by: 'Adaeze Okonkwo' },
        { id: 'a7', time: '06:30', title: 'Feed distributed', detail: 'Poultry House 1 · 245 kg layer mash', kind: 'feed', by: 'Adaeze Okonkwo' },
      ],
    },
    {
      date: daysAgo(1),
      entries: [
        { id: 'b1', time: '17:20', title: 'Daily round submitted', detail: 'SnailPro · 3 pens', kind: 'task', by: 'Chinedu Eze' },
        { id: 'b2', time: '15:05', title: 'Harvest recorded', detail: 'Cohort S-004 · 78 kg table size', kind: 'production', by: 'Chinedu Eze' },
        { id: 'b3', time: '10:40', title: 'Newcastle booster administered', detail: 'Flock L-2026-003 · 1,950 birds', kind: 'health', by: 'Ibrahim Danjuma' },
        { id: 'b4', time: '08:10', title: 'Egg collection recorded', detail: 'Poultry House 2 · 1,588 whole', kind: 'production', by: 'Adaeze Okonkwo' },
      ],
    },
    {
      date: daysAgo(2),
      entries: [
        { id: 'c1', time: '16:00', title: 'Customer payment received', detail: 'Sunrise Foods · ₦450,000', kind: 'sale', by: 'Funmilayo Adeyemi' },
        { id: 'c2', time: '12:15', title: 'Mortality recorded', detail: 'Cohort S-004 · 24 snails · desiccation', kind: 'mortality', by: 'Chinedu Eze' },
        { id: 'c3', time: '08:05', title: 'Egg collection recorded', detail: 'Poultry House 1 · 1,640 whole', kind: 'production', by: 'Adaeze Okonkwo' },
      ],
    },
  ];
}

/* -------------------------------------------------------------------------- */

/**
 * What each population had recorded against it yesterday.
 *
 * Feeds the daily round's "same as yesterday" shortcut. Keyed by population and
 * split across the farm's collection times, so the carried-over figures land in
 * the same fields the worker is being asked to fill.
 */
export async function getYesterday(
  moduleKey: string,
  collectionLabels: string[],
): Promise<Record<string, { feedKg: number; production: Record<string, number> }>> {
  const [feeding, production] = await Promise.all([
    getFeeding(moduleKey, 2),
    getProduction(moduleKey, 2),
  ]);

  const result: Record<string, { feedKg: number; production: Record<string, number> }> = {};

  for (const row of feeding) {
    const current = result[row.groupCode] ?? { feedKg: 0, production: {} };
    // Rows come newest first; the first one seen per group is the latest day.
    if (current.feedKg === 0) current.feedKg = row.kg;
    result[row.groupCode] = current;
  }

  for (const row of production) {
    const current = result[row.groupCode] ?? { feedKg: 0, production: {} };
    if (Object.keys(current.production).length > 0) continue;

    for (const [key, value] of Object.entries(row.values)) {
      if (collectionLabels.length > 1 && key === 'whole') {
        // Split the day's total across the collections, remainder on the first,
        // so the parts always add back to exactly what was recorded.
        const each = Math.floor(value / collectionLabels.length);
        collectionLabels.forEach((label, index) => {
          const share = index === 0 ? value - each * (collectionLabels.length - 1) : each;
          current.production[`whole:${label.toLowerCase()}`] = share;
        });
      } else {
        current.production[key] = value;
      }
    }
    result[row.groupCode] = current;
  }

  return result;
}
