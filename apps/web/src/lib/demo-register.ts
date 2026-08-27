/**
 * DEMONSTRATION DATA — NOT REAL FARM RECORDS.
 *
 * The register: every managed population, and the detail behind one of them.
 * Split out of `demo.ts` because it is the largest fixture and will be the
 * first to be replaced by real endpoints.
 *
 * Shapes here are what the eventual API should return, so swapping this module
 * for `api()` calls is a change at one seam rather than across the pages. Money
 * is in KOBO as integer strings, matching the API's convention exactly.
 *
 * Every screen rendering any of it must show the <DemoFlag /> marker.
 */

import type { BatchSummary, GroupDetail } from './demo';

const ANCHOR = Date.UTC(2026, 7, 10);

/**
 * Dates are derived from a fixed anchor rather than "now", so the fixture does
 * not silently change shape between page loads while the UI is being reviewed.
 */
function daysAgo(days: number): string {
  return new Date(ANCHOR - days * 86_400_000).toISOString();
}

function fortnight(): string[] {
  return Array.from({ length: 14 }, (_, index) => daysAgo(13 - index));
}

/**
 * Split a whole number across buckets in proportion to their weights, so the
 * parts sum to exactly the total.
 *
 * Largest remainder: floor everything, then hand the shortfall to the buckets
 * with the biggest fractional loss. Rounding each bucket independently would
 * drift, and a mortality series that does not sum to the deaths it claims to
 * describe is the same class of error as a ledger that does not balance.
 */
function distribute(total: number, weights: number[]): number[] {
  if (total <= 0) return weights.map(() => 0);

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) return weights.map(() => 0);

  const exact = weights.map((weight) => (weight / weightSum) * total);
  const floored = exact.map((value) => Math.floor(value));
  let shortfall = total - floored.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);

  for (const { index } of order) {
    if (shortfall <= 0) break;
    floored[index] = (floored[index] ?? 0) + 1;
    shortfall -= 1;
  }

  return floored;
}

export async function getBatches(): Promise<BatchSummary[]> {
  return [
    {
      id: 'L-2026-001',
      code: 'L-2026-001',
      species: 'POULTRY',
      breed: 'ISA Brown',
      purpose: 'Layer',
      house: 'Poultry House 1',
      stage: 'Layer',
      population: 1945,
      openingPopulation: 2000,
      ageDays: 284,
      mortalityRate: 2.75,
      status: 'ACTIVE',
      startedOn: daysAgo(284),
      source: 'CHI Farms',
      costToDateKobo: '3604000000',
      revenueToDateKobo: '4188000000',
    },
    {
      id: 'L-2026-003',
      code: 'L-2026-003',
      species: 'POULTRY',
      breed: 'Lohmann Brown',
      purpose: 'Layer',
      house: 'Poultry House 2',
      stage: 'Layer',
      population: 1950,
      openingPopulation: 2000,
      ageDays: 196,
      mortalityRate: 2.5,
      status: 'ACTIVE',
      startedOn: daysAgo(196),
      source: 'Zartech Hatchery',
      costToDateKobo: '2216000000',
      revenueToDateKobo: '2094000000',
    },
    {
      id: 'L-2026-004',
      code: 'L-2026-004',
      species: 'POULTRY',
      breed: 'ISA Brown',
      purpose: 'Pullet',
      house: 'Brooder House',
      stage: 'Grower',
      population: 2480,
      openingPopulation: 2500,
      ageDays: 63,
      mortalityRate: 0.8,
      status: 'ACTIVE',
      startedOn: daysAgo(63),
      source: 'CHI Farms',
      costToDateKobo: '641000000',
      revenueToDateKobo: '0',
    },
    {
      id: 'B-2026-007',
      code: 'B-2026-007',
      species: 'POULTRY',
      breed: 'Cobb 500',
      purpose: 'Broiler',
      house: 'Broiler Pen 1',
      stage: 'Grower',
      population: 4555,
      openingPopulation: 4750,
      ageDays: 31,
      mortalityRate: 4.11,
      status: 'ACTIVE',
      startedOn: daysAgo(31),
      source: 'Zartech Hatchery',
      costToDateKobo: '1389000000',
      revenueToDateKobo: '0',
    },
    {
      id: 'B-2026-005',
      code: 'B-2026-005',
      species: 'POULTRY',
      breed: 'Cobb 500',
      purpose: 'Broiler',
      house: 'Broiler Pen 2',
      stage: 'Spent',
      population: 0,
      openingPopulation: 4500,
      ageDays: 48,
      mortalityRate: 3.62,
      status: 'CLOSED',
      startedOn: daysAgo(102),
      source: 'Zartech Hatchery',
      costToDateKobo: '1841000000',
      revenueToDateKobo: '2255000000',
    },
    {
      id: 'S-001',
      code: 'S-001',
      species: 'SNAIL',
      breed: 'Archachatina marginata',
      purpose: 'Breeder cohort',
      house: 'Snail Section A',
      stage: 'Breeder',
      population: 3200,
      openingPopulation: 3300,
      ageDays: 412,
      mortalityRate: 3.03,
      status: 'ACTIVE',
      startedOn: daysAgo(412),
      source: 'Own breeding stock',
      costToDateKobo: '284600000',
      revenueToDateKobo: '412000000',
    },
    {
      id: 'S-004',
      code: 'S-004',
      species: 'SNAIL',
      breed: 'Achatina achatina',
      purpose: 'Growers',
      house: 'Snail Section B',
      stage: 'Grower',
      population: 9100,
      openingPopulation: 9800,
      ageDays: 147,
      mortalityRate: 7.14,
      status: 'ACTIVE',
      startedOn: daysAgo(147),
      source: 'Cohort S-001',
      costToDateKobo: '431800000',
      revenueToDateKobo: '618000000',
    },
    {
      id: 'S-006',
      code: 'S-006',
      species: 'SNAIL',
      breed: 'Archachatina marginata',
      purpose: 'Juveniles',
      house: 'Snail Nursery',
      stage: 'Juvenile',
      population: 4380,
      openingPopulation: 4520,
      ageDays: 54,
      mortalityRate: 3.1,
      status: 'ACTIVE',
      startedOn: daysAgo(54),
      source: 'Cohort S-001',
      costToDateKobo: '96400000',
      revenueToDateKobo: '0',
    },
    {
      id: 'S-002',
      code: 'S-002',
      species: 'SNAIL',
      breed: 'Lissachatina fulica',
      purpose: 'Growers',
      house: 'Snail Section A',
      stage: 'Grower',
      population: 0,
      openingPopulation: 6200,
      ageDays: 168,
      mortalityRate: 9.4,
      status: 'CLOSED',
      startedOn: daysAgo(240),
      source: 'Own breeding stock',
      costToDateKobo: '502100000',
      revenueToDateKobo: '388000000',
    },
  ];
}

/** Every population belonging to one species module. */
export async function getGroups(moduleKey: string): Promise<BatchSummary[]> {
  const species = moduleKey === 'snail' ? 'SNAIL' : 'POULTRY';
  const all = await getBatches();
  return all.filter((group) => group.species === species);
}

/**
 * Split a population's cost into categories.
 *
 * DERIVED from the batch's actual total, not a fixed list of amounts. It was a
 * fixed list, and when the totals were corrected the parts no longer belonged
 * to them — one batch reported "Feed 189%" of its own cost. Percentages that do
 * not add to a hundred destroy confidence in every other figure on the page.
 *
 * Proportions are typical of Nigerian commercial production: feed dominates
 * everything, which is exactly what the chart should make obvious.
 */
function splitCost(
  totalKobo: string,
  snail: boolean,
): Array<{ label: string; kobo: string }> {
  const categories = snail
    ? [
        { label: 'Feed', weight: 45 },
        { label: 'Labour', weight: 25 },
        { label: 'Pen maintenance', weight: 12 },
        { label: 'Overhead allocated', weight: 18 },
      ]
    : [
        { label: 'Day-old chicks', weight: 10 },
        { label: 'Feed', weight: 62 },
        { label: 'Medication & vaccines', weight: 5 },
        { label: 'Labour', weight: 12 },
        { label: 'Overhead allocated', weight: 11 },
      ];

  const total = Number(totalKobo);
  const parts = distribute(
    total,
    categories.map((category) => category.weight),
  );

  return categories.map((category, index) => ({
    label: category.label,
    kobo: String(parts[index] ?? 0),
  }));
}

/**
 * One population in full.
 *
 * The population series is DERIVED by walking the deaths backwards from today's
 * count, not stored independently — which is how the real thing must work too.
 * A population that can be edited separately from its own event history is a
 * population that will eventually disagree with it.
 */
export async function getGroupDetail(
  moduleKey: string,
  id: string,
): Promise<GroupDetail | null> {
  const groups = await getGroups(moduleKey);
  const group = groups.find((candidate) => candidate.id === id);
  if (!group) return null;

  const dates = fortnight();
  const snail = group.species === 'SNAIL';

  /*
   * The fortnight of deaths is derived from the population's OWN lifetime
   * mortality, not invented independently.
   *
   * Getting this wrong is not cosmetic. An earlier version scaled a fixed shape
   * by population size and produced 65 deaths over fourteen days for a batch
   * that had lost 55 birds in its entire 284-day life — which made the
   * population chart open at 2,008 birds for a batch where only 2,000 were ever
   * placed. Layers do not reproduce, so that reads as broken software.
   *
   * Deaths in the window are apportioned from lifetime deaths by elapsed time,
   * then distributed across the days using a shape as relative weights.
   */
  const shape = snail
    ? [4, 3, 5, 7, 9, 6, 4, 5, 8, 11, 6, 4, 5, 7]
    : [2, 3, 2, 4, 3, 2, 5, 9, 12, 7, 4, 3, 4, 5];

  const lifetimeDeaths = group.openingPopulation - group.population;
  const windowDays = Math.min(dates.length, group.ageDays);
  const deathsInWindow =
    group.status === 'CLOSED' || group.ageDays === 0
      ? 0
      : Math.round((lifetimeDeaths * windowDays) / group.ageDays);

  const deaths = distribute(deathsInWindow, shape);

  // Walk backwards from today's count so the series always ends exactly on the
  // current population and never exceeds what was placed.
  let running = group.population + deaths.reduce((sum, value) => sum + value, 0);
  const populationSeries = dates.map((date, index) => {
    running -= deaths[index] ?? 0;
    return { date, value: group.status === 'CLOSED' ? 0 : running };
  });

  const opening = group.openingPopulation.toLocaleString('en-NG');

  return {
    ...group,
    populationSeries,
    mortalitySeries: dates.map((date, index) => ({ date, value: deaths[index] ?? 0 })),
    expectedEndOn: group.purpose === 'Broiler' ? daysAgo(-11) : null,
    costBreakdown: splitCost(group.costToDateKobo, snail),
    events: snail
      ? [
          {
            id: 'e1',
            occurredOn: daysAgo(0),
            type: 'FEED',
            summary: 'Feed issued',
            detail: '18 kg snail feed concentrate',
            quantity: '18 kg',
            recordedBy: 'Adaeze Okonkwo',
          },
          {
            id: 'e2',
            occurredOn: daysAgo(1),
            type: 'MORTALITY',
            summary: 'Mortality recorded',
            detail: 'Desiccation — humidity fell below 75%',
            quantity: `${deaths[12] ?? 0} snails`,
            recordedBy: 'Adaeze Okonkwo',
          },
          {
            id: 'e3',
            occurredOn: daysAgo(4),
            type: 'HARVEST',
            summary: 'Harvest',
            detail: '78 kg table-size snails moved to finished goods',
            quantity: '78 kg',
            recordedBy: 'Chinedu Eze',
          },
          {
            id: 'e4',
            occurredOn: daysAgo(21),
            type: 'STAGE',
            summary: 'Stage change',
            detail: 'Juvenile to Grower',
            quantity: `${opening} snails`,
            recordedBy: 'Chinedu Eze',
          },
          {
            id: 'e5',
            occurredOn: group.startedOn,
            type: 'PLACEMENT',
            summary: 'Stocking',
            detail: `${opening} from ${group.source}`,
            quantity: `${opening} snails`,
            recordedBy: 'Chinedu Eze',
          },
        ]
      : [
          {
            id: 'e1',
            occurredOn: daysAgo(0),
            type: 'PRODUCTION',
            summary: 'Egg collection',
            detail: '1,602 whole · 24 cracked · 31 dirty',
            quantity: '1,657 eggs',
            recordedBy: 'Adaeze Okonkwo',
          },
          {
            id: 'e2',
            occurredOn: daysAgo(0),
            type: 'FEED',
            summary: 'Feed issued',
            detail: '245 kg layer mash',
            quantity: '245 kg',
            recordedBy: 'Adaeze Okonkwo',
          },
          {
            id: 'e3',
            occurredOn: daysAgo(0),
            type: 'MORTALITY',
            summary: 'Mortality recorded',
            detail: 'Heat stress',
            quantity: `${deaths[13] ?? 0} birds`,
            recordedBy: 'Adaeze Okonkwo',
          },
          {
            id: 'e4',
            occurredOn: daysAgo(6),
            type: 'TREATMENT',
            summary: 'Vaccination',
            detail: 'Newcastle disease (Lasota), administered in drinking water',
            quantity: `${group.population.toLocaleString('en-NG')} birds`,
            recordedBy: 'Ibrahim Danjuma',
          },
          {
            id: 'e5',
            occurredOn: group.startedOn,
            type: 'PLACEMENT',
            summary: 'Placement',
            detail: `${opening} day-old chicks from ${group.source}`,
            quantity: `${opening} birds`,
            recordedBy: 'Chinedu Eze',
          },
        ],
  };
}
