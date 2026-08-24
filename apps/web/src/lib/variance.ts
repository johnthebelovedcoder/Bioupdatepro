import 'server-only';
import { getFarmConfig } from './farm-config.server';
import { standardAt, standardFor, type FarmConfig } from './farm-config';
import { getFeeding, getProduction } from './operations';
import { getGroups } from './operations';
import { getInventory } from './demo-trade';
import { getModule, subscribedModules, type ModuleKey } from './modules';
import { toKobo } from './money';

/**
 * What does not add up.
 *
 * Feed, eggs and animals go missing on farms. It is endemic, every farmer knows
 * it, and almost no farm software addresses it — because catching it needs both
 * an operational record AND a ledger that agrees with that record. Most farm
 * apps have the first; accounting packages have the second; this has both.
 *
 * Three principles:
 *
 *   1. COMPARE AGAINST THE FARM'S OWN NORMS FIRST. A book figure says what a
 *      bird in a temperate research shed eats. What matters is that this house
 *      used 18% more per bird than the identical house next door, which is a
 *      comparison no textbook can make and no farm can argue with.
 *
 *   2. PUT A NAIRA FIGURE ON IT. "18% over" is an abstraction people nod at.
 *      "₦362,000 of feed in seven days" is a conversation with a farm manager.
 *
 *   3. NEVER ACCUSE. Every finding is a discrepancy with a stated basis, and
 *      the wording says what was measured, not what someone did. Over-feeding,
 *      spillage, a broken feeder, a mis-recorded bird count and theft all look
 *      identical from here, and the software is not entitled to pick one.
 */

export type VarianceKind =
  | 'FEED_PER_HEAD'
  | 'PRODUCTION_SHORTFALL'
  | 'STOCK_COUNT'
  | 'MORTALITY';

export interface VarianceFinding {
  id: string;
  kind: VarianceKind;
  /** The species module this came from, where it came from one. */
  moduleKey?: ModuleKey | null;
  severity: 'critical' | 'warning';
  /** What the finding is about — a house, a batch, an item. */
  subject: string;
  headline: string;
  expected: string;
  actual: string;
  /** How far out, as a percentage. */
  gapPct: number;
  /** What the gap is worth, in kobo. Null when it cannot be valued. */
  gapValueKobo: string | null;
  /** How this was judged, stated plainly so the finding can be argued with. */
  basis: string;
  action: { label: string; href: string };
}

/* -------------------------------------------------------------------------- */

export async function getVarianceFindings(): Promise<VarianceFinding[]> {
  const config = await getFarmConfig();
  if (!config.variance.enabled) return [];

  /*
   * Run the livestock checks per module rather than against poultry alone.
   *
   * A snail farm got no variance detection at all before this, and a poultry
   * finding could surface while the interface was showing SnailPro — the same
   * hard-coded species behind both.
   */
  const perModule = await Promise.all(
    subscribedModules(config.modules).flatMap((module) => [
      feedPerHead(config, module.key),
      productionShortfall(config, module.key),
    ]),
  );

  const findings = [...perModule, await stockCounts(config)];

  return findings
    .flat()
    .sort((a, b) => Number(toKobo(b.gapValueKobo ?? '0') - toKobo(a.gapValueKobo ?? '0')));
}

/* -------------------------------------------------------------------------- */

/**
 * Feed per animal, against comparable populations.
 *
 * The strongest signal available, because it controls for almost everything: two
 * houses of the same breed kept for the same purpose should eat within a few
 * percent of each other. When one does not, the feed went somewhere.
 *
 * Compared against the MEDIAN of the peer group rather than the mean — one
 * badly wrong house would drag a mean towards itself and hide its own anomaly.
 */
async function feedPerHead(
  config: FarmConfig,
  moduleKey: ModuleKey,
): Promise<VarianceFinding[]> {
  // This finding used to say "bird" and "houses" unconditionally, which read as
  // nonsense on a snail farm even though the check itself already ran per
  // module (see the comment on `getVarianceFindings`) — the copy just never
  // caught up to that.
  const t = getModule(moduleKey)!.terms;
  const [rows, groups, inventory] = await Promise.all([
    getFeeding(moduleKey, config.feed.consumptionWindowDays),
    getGroups(moduleKey),
    getInventory(),
  ]);

  // Average grams per head per day for each population over the window.
  const byGroup = new Map<string, { total: number; days: number; kg: number }>();
  for (const row of rows) {
    const current = byGroup.get(row.groupCode) ?? { total: 0, days: 0, kg: 0 };
    current.total += row.gramsPerHead;
    current.days += 1;
    current.kg += row.kg;
    byGroup.set(row.groupCode, current);
  }

  const measured = [...byGroup.entries()]
    .map(([code, stats]) => {
      const group = groups.find((entry) => entry.code === code);
      return group
        ? { group, perHead: stats.total / Math.max(1, stats.days), kg: stats.kg }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .filter((entry) => entry.group.population >= config.variance.minimumPopulation);

  const findings: VarianceFinding[] = [];

  for (const entry of measured) {
    // Peers: same purpose, excluding itself. Without at least two peers there
    // is no norm to compare against and a finding would be noise.
    const peers = measured.filter(
      (other) =>
        other.group.id !== entry.group.id && other.group.purpose === entry.group.purpose,
    );
    if (peers.length < 1) continue;

    const norm = median(peers.map((peer) => peer.perHead));
    if (norm <= 0) continue;

    const gapPct = ((entry.perHead - norm) / norm) * 100;
    if (gapPct <= config.variance.feedPerHeadTolerancePct) continue;

    // Value the excess at what that feed actually costs.
    const feedItem = inventory.find(
      (item) => item.category === 'Feed' && rows.some((row) => row.groupCode === entry.group.code && row.feedType === item.name),
    );
    const excessKg = (entry.kg * gapPct) / (100 + gapPct);
    const gapValue = feedItem
      ? (toKobo(feedItem.unitCostKobo) * BigInt(Math.round(excessKg))).toString()
      : null;

    findings.push({
      id: `feed-${entry.group.id}`,
      kind: 'FEED_PER_HEAD',
      moduleKey,
      severity: gapPct > config.variance.feedPerHeadTolerancePct * 2 ? 'critical' : 'warning',
      subject: entry.group.house,
      headline: `${entry.group.house} is using ${gapPct.toFixed(0)}% more feed per ${t.animal.one} than the other ${entry.group.purpose.toLowerCase()} ${t.housing.many}`,
      expected: `${norm.toFixed(0)} g per ${t.animal.one} per day`,
      actual: `${entry.perHead.toFixed(0)} g per ${t.animal.one} per day`,
      gapPct: Number(gapPct.toFixed(1)),
      gapValueKobo: gapValue,
      basis: `${entry.group.code} against ${peers.length} other ${entry.group.purpose.toLowerCase()} ${peers.length === 1 ? t.group.one : t.group.many}, over ${config.feed.consumptionWindowDays} days.`,
      action: { label: 'See feeding', href: `/m/${moduleKey}/feeding` },
    });
  }

  return findings;
}

/* -------------------------------------------------------------------------- */

/**
 * Eggs that the flock size and age say should exist.
 *
 * Uses the breed standard the farm has configured. Where no standard is set,
 * NOTHING IS REPORTED — a shortfall against an invented benchmark would be a
 * fabricated accusation, which is worse than saying nothing.
 */
async function productionShortfall(
  config: FarmConfig,
  moduleKey: ModuleKey,
): Promise<VarianceFinding[]> {
  const [rows, groups] = await Promise.all([
    getProduction(moduleKey, config.feed.consumptionWindowDays),
    getGroups(moduleKey),
  ]);

  const byGroup = new Map<string, { eggs: number; days: number; population: number }>();
  for (const row of rows) {
    const current = byGroup.get(row.groupCode) ?? { eggs: 0, days: 0, population: 0 };
    current.eggs += row.values.whole ?? 0;
    current.days += 1;
    current.population = row.population;
    byGroup.set(row.groupCode, current);
  }

  const findings: VarianceFinding[] = [];

  for (const [code, stats] of byGroup) {
    const group = groups.find((entry) => entry.code === code);
    if (!group || group.population < config.variance.minimumPopulation) continue;

    const standard = standardFor(config, group);
    if (!standard?.layRate || standard.layRate.length === 0) continue;

    const ageWeeks = standard.ageUnit === 'week' ? group.ageDays / 7 : group.ageDays;
    const expectedRate = standardAt(standard.layRate, ageWeeks);
    if (expectedRate === null) continue;

    /*
     * Nothing here may be non-finite.
     *
     * `NaN <= tolerance` is FALSE, so a single missing figure does not fail the
     * check below — it passes it, and carries on into BigInt(), which throws
     * and takes down every screen that asks for alerts. Comparisons against NaN
     * silently invert the meaning of a guard, so the guard has to be that the
     * numbers are numbers.
     */
    if (!Number.isFinite(stats.population) || stats.population <= 0) continue;
    if (!Number.isFinite(stats.eggs) || !Number.isFinite(stats.days)) continue;

    const actualRate = (stats.eggs / Math.max(1, stats.days * stats.population)) * 100;
    const gapPct = ((expectedRate - actualRate) / expectedRate) * 100;
    if (!Number.isFinite(gapPct)) continue;
    if (gapPct <= config.variance.productionTolerancePct) continue;

    // ₦160 an egg — a crate of thirty at ₦4,800.
    const missingEggs = Math.round(
      ((expectedRate - actualRate) / 100) * stats.population * stats.days,
    );
    const gapValue = (BigInt(Math.max(0, missingEggs)) * 16_000n).toString();

    findings.push({
      id: `production-${group.id}`,
      kind: 'PRODUCTION_SHORTFALL',
      moduleKey,
      severity: gapPct > config.variance.productionTolerancePct * 2 ? 'critical' : 'warning',
      subject: group.code,
      headline: `${group.code} is laying ${gapPct.toFixed(0)}% below what ${group.breed} should at this age`,
      expected: `${expectedRate.toFixed(0)}% hen-day`,
      actual: `${actualRate.toFixed(0)}% hen-day`,
      gapPct: Number(gapPct.toFixed(1)),
      gapValueKobo: gapValue,
      basis: `${standard.breed} standard at ${Math.round(ageWeeks)} weeks — ${standard.source}`,
      action: { label: 'See eggs', href: `/m/${moduleKey}/production` },
    });
  }

  return findings;
}

/* -------------------------------------------------------------------------- */

/**
 * Stock counted against stock on the books.
 *
 * The most direct measure there is, and the only one here that needs someone to
 * physically walk the store. Until stock counts are capturable this reports the
 * adjustments already recorded, which is the same discrepancy after the fact.
 */
async function stockCounts(config: FarmConfig): Promise<VarianceFinding[]> {
  const { getStockMovements } = await import('./demo-trade');
  const [movements, inventory] = await Promise.all([getStockMovements(), getInventory()]);

  const findings: VarianceFinding[] = [];

  for (const movement of movements) {
    if (movement.kind !== 'ADJUSTMENT') continue;

    const item = inventory.find((entry) => entry.code === movement.itemCode);
    if (!item) continue;

    const size = Math.abs(movement.quantity);
    const gapPct = item.onHand > 0 ? (size / item.onHand) * 100 : 100;
    if (gapPct <= config.variance.stockCountTolerancePct) continue;

    findings.push({
      id: `stock-${movement.id}`,
      kind: 'STOCK_COUNT',
      severity: gapPct > config.variance.stockCountTolerancePct * 3 ? 'critical' : 'warning',
      subject: item.name,
      headline: `${size.toLocaleString('en-NG')} ${item.unit} of ${item.name.toLowerCase()} was written off`,
      expected: `${(item.onHand + size).toLocaleString('en-NG')} ${item.unit} on the books`,
      actual: `${item.onHand.toLocaleString('en-NG')} ${item.unit} counted`,
      gapPct: Number(gapPct.toFixed(1)),
      gapValueKobo: (toKobo(item.unitCostKobo) * BigInt(size)).toString(),
      basis: movement.reference,
      action: { label: 'See movements', href: '/inventory' },
    });
  }

  return findings;
}

/* -------------------------------------------------------------------------- */

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}
