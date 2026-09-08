import 'server-only';
import { api } from './api';
import type { BatchSummary, GroupDetail } from './demo';
import type {
  FeedingRow,
  HarvestRow,
  HealthEvent,
  PerformanceRow,
  ProductionRow,
  StageBucket,
} from './demo-ops';
import { getModule } from './modules';
import { getFarmConfig } from './farm-config.server';
import { standardAt, standardFor } from './farm-config';
import { toKobo } from './money';

/**
 * The livestock reads, from the database instead of a fixture.
 *
 * These return exactly the types the fixtures returned, and that is the point:
 * every screen was written against those shapes, so swapping the source changes
 * one thing at a time. If a page looks different after this, the difference is
 * the data — not a shape that quietly moved underneath it.
 *
 * What this does NOT cover is as important. Money, stock, customers, staff and
 * the activity feed still come from fixtures, because nothing links a sale or a
 * purchase to a population yet. Mixing "real" and "illustrative" without saying
 * which is which is precisely how a demo becomes a lie, so the callers keep
 * their Demo data badges over the parts that are still invented.
 *
 * Every call is server-side. `api()` is server-only and attaches the session
 * token, and the API resolves the company from that token — so there is no
 * company parameter to get wrong here.
 */

/** Populations of one species, newest placement first. */
export async function getGroups(moduleKey: string): Promise<BatchSummary[]> {
  return api<BatchSummary[]>(`/operations/groups?species=${encodeURIComponent(moduleKey)}`);
}

export async function getGroupDetail(
  moduleKey: string,
  code: string,
): Promise<GroupDetail | null> {
  try {
    return await api<GroupDetail>(`/operations/groups/${encodeURIComponent(code)}`);
  } catch {
    // A code that does not resolve is a 404 from the API, which for a page
    // means "no such population" rather than an error worth showing.
    return null;
  }
}

/**
 * Populations whose acquisition has never posted to the ledger.
 *
 * `/biological-assets/groups` already carries `acquisitionPosted` — this just
 * reads it. Nothing downstream of an unposted acquisition can post either:
 * mortality, stage transfers and valuations all price themselves off the
 * carrying value acquisition sets, so a group stuck here is the root cause,
 * not one symptom among several.
 */
export async function getUnpostedAcquisitions(): Promise<
  Array<{ id: string; code: string }>
> {
  const groups = await api<
    Array<{ id: string; code: string; acquisitionCostKobo: string; acquisitionPosted: boolean }>
  >('/biological-assets/groups');
  return groups
    .filter((group) => !group.acquisitionPosted && BigInt(group.acquisitionCostKobo) > 0n)
    .map((group) => ({ id: group.id, code: group.code }));
}

export async function getProduction(moduleKey: string, days = 30): Promise<ProductionRow[]> {
  return api<ProductionRow[]>(
    `/operations/production?species=${encodeURIComponent(moduleKey)}&days=${days}`,
  );
}

export async function getFeeding(moduleKey: string, days = 30): Promise<FeedingRow[]> {
  return api<FeedingRow[]>(
    `/operations/feeding?species=${encodeURIComponent(moduleKey)}&days=${days}`,
  );
}

export async function getHealth(moduleKey: string): Promise<HealthEvent[]> {
  return api<HealthEvent[]>(`/operations/health?species=${encodeURIComponent(moduleKey)}`);
}

export async function getHarvests(moduleKey: string): Promise<HarvestRow[]> {
  return api<HarvestRow[]>(`/operations/harvests?species=${encodeURIComponent(moduleKey)}`);
}

/**
 * Population by lifecycle stage.
 *
 * The stage ORDER comes from the module registry and is sent to the API, which
 * has no opinion about what a snail's stages are and should not acquire one —
 * that is the same rule that keeps species out of the schema.
 */
export async function getStageBreakdown(
  moduleKey: string,
  stages: string[],
): Promise<StageBucket[]> {
  const query = new URLSearchParams({ species: moduleKey, stages: stages.join(',') });
  return api<StageBucket[]>(`/operations/stages?${query.toString()}`);
}

export interface ModuleMetricFigure {
  value: string;
}

export interface ModuleSummary {
  groupCount: number;
  /** Keyed by the metric keys the module registry declares — see modules.ts. */
  metrics: Record<string, ModuleMetricFigure | undefined>;
}

/** Today's date in the timezone the rest of the dashboard already uses. */
function todayInLagos(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
}

/**
 * The dashboard's per-module summary card — real figures, replacing what
 * `lib/demo.ts`'s `getModuleOverview()` used to invent wholesale (a fixed
 * "84.7% hatch rate", "6,240" eggs, etc. that never changed no matter what a
 * farm actually recorded).
 *
 * Built entirely from reads this app already has real endpoints for —
 * `getGroups` for population and mortality, `getFeeding`/`getProduction` for
 * what happened today — rather than a new backend surface. Population and
 * mortality are real for every module; eggs-today is real for poultry, whose
 * production fields name a 'whole' egg count. A module with no real source
 * for a metric (snail's hatch rate has none of this app's daily-round data
 * behind it yet) simply omits that key rather than inventing a figure — the
 * card already renders whichever keys are present and skips the rest.
 */
export async function getModuleSummary(moduleKey: string): Promise<ModuleSummary> {
  const groups = await getGroups(moduleKey);
  const active = groups.filter((group) => group.status === 'ACTIVE');
  const population = active.reduce((sum, group) => sum + group.population, 0);

  const openingTotal = active.reduce((sum, group) => sum + group.openingPopulation, 0);
  const mortalityRate =
    openingTotal > 0
      ? active.reduce((sum, group) => sum + group.mortalityRate * group.openingPopulation, 0) /
        openingTotal
      : 0;

  const today = todayInLagos();
  const feeding = await getFeeding(moduleKey, 1);
  const feedToday = feeding
    .filter((row) => row.date.slice(0, 10) === today)
    .reduce((sum, row) => sum + row.kg, 0);

  const metrics: ModuleSummary['metrics'] = {
    population: { value: population.toLocaleString('en-NG') },
    mortality: { value: `${mortalityRate.toFixed(1)}%` },
    feed: { value: feedToday >= 1000 ? `${(feedToday / 1000).toFixed(2)} t` : `${feedToday.toLocaleString('en-NG')} kg` },
  };

  if (moduleKey === 'poultry') {
    const production = await getProduction(moduleKey, 1);
    const eggsToday = production
      .filter((row) => row.date.slice(0, 10) === today)
      .reduce((sum, row) => sum + (row.values.whole ?? 0), 0);
    metrics.eggs = { value: eggsToday.toLocaleString('en-NG') };
  }

  return { groupCount: active.length, metrics };
}

export interface TodayActivityItem {
  id: string;
  kind: 'feed' | 'production' | 'harvest';
  title: string;
  detail: string;
}

/**
 * What actually happened today, across a farm's subscribed modules —
 * replacing `lib/demo.ts`'s `getRecentActivity()`, which showed the same
 * seven invented entries ("Adaeze Okonkwo", "Sunrise Foods") regardless of
 * what a farm had done or who was signed in.
 *
 * Built from feeding, production and harvest reads, all real. Deliberately
 * NOT a claimed exact time of day — `FeedingRow`/`ProductionRow`/`HarvestRow`
 * carry a day, not a timestamp, because that is what a `DailyRecord` actually
 * records. Inventing a clock time the data does not have would be exactly
 * the kind of number this whole pass exists to stop showing. Sales,
 * purchases and other document-driven activity are not included yet — those
 * screens are still on their own fixtures (see the broader migration this is
 * the first slice of).
 */
export async function getTodayActivity(moduleKeys: string[]): Promise<TodayActivityItem[]> {
  const today = todayInLagos();
  const items: TodayActivityItem[] = [];

  for (const moduleKey of moduleKeys) {
    const module = getModule(moduleKey);
    if (!module) continue;

    const [feeding, production, harvests] = await Promise.all([
      getFeeding(moduleKey, 1),
      getProduction(moduleKey, 1),
      getHarvests(moduleKey),
    ]);

    for (const row of feeding) {
      if (row.date.slice(0, 10) !== today || row.kg <= 0) continue;
      items.push({
        id: `feed-${moduleKey}-${row.groupCode}`,
        kind: 'feed',
        title: 'Feed distributed',
        detail: `${row.house} · ${row.kg.toLocaleString('en-NG')} kg ${row.feedType}`,
      });
    }

    for (const row of production) {
      if (row.date.slice(0, 10) !== today) continue;
      const total = Object.values(row.values).reduce((sum, value) => sum + value, 0);
      if (total <= 0) continue;
      const parts = Object.entries(row.values)
        .filter(([, value]) => value > 0)
        .map(([key, value]) => {
          const field = module.productionFields.find((f) => f.key === key);
          return `${value.toLocaleString('en-NG')} ${field?.label.toLowerCase() ?? key}`;
        });
      items.push({
        id: `production-${moduleKey}-${row.groupCode}`,
        kind: 'production',
        title: `${module.terms.productionRecord} recorded`,
        detail: `${row.house} · ${parts.join(', ')}`,
      });
    }

    for (const row of harvests) {
      if (row.date.slice(0, 10) !== today) continue;
      items.push({
        id: `harvest-${moduleKey}-${row.id}`,
        kind: 'harvest',
        title: 'Harvest recorded',
        detail: `${row.colonyCode} · ${row.kg.toLocaleString('en-NG')} kg, ${row.count.toLocaleString('en-NG')} ${row.count === 1 ? module.terms.animal.one : module.terms.animal.many}`,
      });
    }
  }

  return items;
}

export interface UpcomingTaskItem {
  id: string;
  title: string;
  detail: string;
  due: string;
  urgency: 'overdue' | 'today' | 'soon';
}

/**
 * Vaccinations and treatments due soon — replacing `lib/demo.ts`'s
 * `getUpcomingTasks()`, which mixed one real category (vaccinations) with
 * two this app has no backing for at all ("Weekly stock count", "Generator
 * service" — no stock-count or maintenance-schedule model exists anywhere).
 * Rather than invent those two, this only returns what `getHealth()` — the
 * same real DUE/OVERDUE data `lib/alerts.ts`'s vaccination alert already
 * uses — can actually back.
 */
export async function getUpcomingHealthTasks(moduleKeys: string[]): Promise<UpcomingTaskItem[]> {
  const items: UpcomingTaskItem[] = [];

  for (const moduleKey of moduleKeys) {
    const events = await getHealth(moduleKey);
    for (const event of events) {
      if (event.status !== 'DUE' && event.status !== 'OVERDUE') continue;
      const dueDate = new Date(event.dueOn);
      items.push({
        id: `health-${moduleKey}-${event.id}`,
        title: `${event.kind === 'VACCINATION' ? 'Vaccination' : 'Treatment'} — ${event.groupCode}`,
        detail: event.name,
        due: dueDate.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
        urgency: event.status === 'OVERDUE' ? 'overdue' : 'today',
      });
    }
  }

  return items;
}

/**
 * How each population is doing, against its breed standard where one exists.
 *
 * The fixture this replaces invented two of these figures: FCR came out of
 * `1.62 + wobble()` and the lay rate out of `84 + wobble()`, and both were
 * displayed beside real numbers with nothing to say which was which. That is
 * the specific failure the product's own rules forbid.
 *
 * So the lay rate is now measured — the hen-day figures actually recorded over
 * the window — and FCR is NULL, because feed conversion needs live weights and
 * nothing on the farm records them yet. A blank is the honest answer to a
 * question the data cannot answer.
 */
export async function getPerformance(moduleKey: string): Promise<PerformanceRow[]> {
  const [groups, production, feeding, config] = await Promise.all([
    getGroups(moduleKey),
    getProduction(moduleKey, 30),
    getFeeding(moduleKey, 30),
    getFarmConfig(),
  ]);

  const active = groups.filter((group) => group.status === 'ACTIVE');

  return active.map((group) => {
    const rates = production
      .filter((row) => row.groupCode === group.code)
      .map((row) => row.rate)
      .filter((rate): rate is number => rate !== null);
    const layRate = rates.length
      ? Number((rates.reduce((sum, rate) => sum + rate, 0) / rates.length).toFixed(1))
      : null;

    const feedKobo = feeding
      .filter((row) => row.groupCode === group.code)
      .reduce((sum, row) => sum + toKobo(row.costKobo), 0n);
    const cost = toKobo(group.costToDateKobo);

    const standard = standardFor(config, group);
    // Layer guides are published by week, broiler guides by day. Asking a
    // curve for the wrong unit is how a 40-week hen gets compared against a
    // 40-day chick.
    const age = standard?.ageUnit === 'week' ? group.ageDays / 7 : group.ageDays;

    return {
      group,
      // Needs live weights, which nothing records. Not a placeholder — a blank.
      fcr: null,
      layRate,
      mortalityRate: group.mortalityRate,
      standardMortality:
        standard && standard.mortality.length > 0 ? standardAt(standard.mortality, age) : null,
      standardLayRate:
        standard?.layRate && standard.layRate.length > 0
          ? standardAt(standard.layRate, age)
          : null,
      costPerHeadKobo: group.population > 0 ? String(cost / BigInt(group.population)) : '0',
      feedCostShare: cost > 0n ? Number(feedKobo) / Number(cost) : 0,
    };
  });
}

/**
 * Yesterday's figures for one population, for the "same as yesterday" shortcut.
 *
 * Derived from the production rows rather than given its own endpoint: it is
 * the same data asked a different way, and a second endpoint would be a second
 * place for the two to disagree.
 */
export async function getYesterday(
  moduleKey: string,
  collectionLabels: string[],
): Promise<Record<string, { production: Record<string, number>; feedKg: number }>> {
  const module = getModule(moduleKey);
  if (!module) return {};

  const [production, feeding] = await Promise.all([
    getProduction(moduleKey, 2),
    getFeeding(moduleKey, 2),
  ]);

  const dates = [...new Set(production.map((row) => row.date))].sort();
  const latest = dates[dates.length - 1];
  if (!latest) return {};

  const result: Record<string, { production: Record<string, number>; feedKg: number }> = {};
  for (const row of production.filter((entry) => entry.date === latest)) {
    result[row.groupCode] = { production: row.values, feedKg: 0 };
  }
  for (const row of feeding.filter((entry) => entry.date === latest)) {
    const existing = result[row.groupCode] ?? { production: {}, feedKg: 0 };
    existing.feedKg = row.kg;
    result[row.groupCode] = existing;
  }
  // `collectionLabels` is accepted so the signature matches the fixture it
  // replaces; per-collection figures are not stored separately yet.
  void collectionLabels;
  return result;
}
