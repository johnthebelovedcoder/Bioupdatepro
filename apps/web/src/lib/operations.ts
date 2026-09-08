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
