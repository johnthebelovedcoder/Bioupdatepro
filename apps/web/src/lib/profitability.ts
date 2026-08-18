import 'server-only';
import { getGroupDetail, getGroups } from './operations';
import { toKobo } from './money';
import type { BatchSummary } from './demo';

/**
 * What each population made, or lost.
 *
 * This is the payoff for the entire accounting spine. Every farm app can show
 * how many birds died; none of the four competitors reviewed can tell a farmer
 * which batch made money, because that needs cost to accumulate against the
 * batch as a real cost object rather than being summed out of an expense list
 * afterwards.
 *
 * Two distinctions matter and are kept throughout:
 *
 *   CLOSED batches have a FINAL result. Everything is in: the stock is gone,
 *   the cost is complete, the profit is the profit.
 *
 *   OPEN batches have a POSITION, not a result. A broiler batch at day 31 has
 *   consumed feed and sold nothing, so it shows a large "loss" that is not a
 *   loss at all — it is work in progress. Presenting the two the same way would
 *   be actively misleading, so they are separated and labelled.
 */

export interface BatchResult {
  group: BatchSummary;
  costKobo: string;
  revenueKobo: string;
  /** Revenue less cost. Negative is a loss for a closed batch, WIP for an open one. */
  marginKobo: string;
  /** Margin over cost. Null when nothing has been spent. */
  roiPct: number | null;
  /** Cost divided by the animals still alive, or originally placed if closed. */
  costPerAnimalKobo: string;
  breakdown: Array<{ label: string; kobo: string; sharePct: number }>;
  /** What dominates the cost. Almost always feed, and worth saying so. */
  biggestCost: { label: string; sharePct: number } | null;
  final: boolean;
}

export async function getBatchResults(): Promise<BatchResult[]> {
  // Both species, because this ranks the whole farm's populations against one
  // another — an owner comparing a broiler batch with a snail colony is the
  // point of the screen.
  const [poultry, snail] = await Promise.all([getGroups('poultry'), getGroups('snail')]);
  const batches: BatchSummary[] = [...poultry, ...snail];

  const results = await Promise.all(
    batches.map(async (group: BatchSummary) => {
      const detail = await getGroupDetail(
        group.species === 'SNAIL' ? 'snail' : 'poultry',
        group.id,
      );

      const cost = toKobo(group.costToDateKobo);
      const revenue = toKobo(group.revenueToDateKobo);
      const margin = revenue - cost;

      const breakdown = (detail?.costBreakdown ?? []).map((line) => ({
        label: line.label,
        kobo: line.kobo,
        sharePct: cost > 0n ? Number((toKobo(line.kobo) * 1000n) / cost) / 10 : 0,
      }));

      const biggest = [...breakdown].sort((a, b) => b.sharePct - a.sharePct)[0] ?? null;

      // Cost per animal is only meaningful against a live population; for a
      // closed batch the sensible denominator is what was placed.
      const denominator =
        group.status === 'CLOSED' ? group.openingPopulation : group.population;

      return {
        group,
        costKobo: cost.toString(),
        revenueKobo: revenue.toString(),
        marginKobo: margin.toString(),
        roiPct: cost > 0n ? Number((margin * 1000n) / cost) / 10 : null,
        costPerAnimalKobo:
          denominator > 0 ? (cost / BigInt(denominator)).toString() : '0',
        breakdown,
        biggestCost: biggest ? { label: biggest.label, sharePct: biggest.sharePct } : null,
        final: group.status === 'CLOSED',
      };
    }),
  );

  // Best first. A farmer opening this wants to know what worked, then what did
  // not — and the losses sort to the bottom where they are impossible to miss.
  return results.sort((a: BatchResult, b: BatchResult) =>
    Number(toKobo(b.marginKobo) - toKobo(a.marginKobo)),
  );
}
