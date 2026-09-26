import { api } from '@/lib/api';
import { getFarms } from '@/lib/masters';
import { getContext } from '@/lib/org';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { RaiseFeedOrder } from '@/components/feed-mill-forms';

export const metadata = { title: 'Feed plan — BioAssetPro' };

interface PlanGroup {
  code: string;
  speciesKey: string;
  stage: string;
  population: number;
  dailyKg: string;
  basis: 'RECENT_FEEDING' | 'STAGE_STANDARD';
}

interface PlanLine {
  itemId: string;
  itemCode: string;
  description: string;
  unit: string;
  dailyKg: string;
  demandKg: string;
  onHandKg: string;
  openOrdersKg: string;
  shortfallKg: string;
  daysCovered: string | null;
  recipeVersionId: string | null;
  recipeName: string | null;
  groups: PlanGroup[];
}

const kg = (v: string) => Number(v).toLocaleString('en-NG', { maximumFractionDigits: 1 });

/**
 * Feed demand plan (handbook §40 FM-01, FR-FM-03): what the live batches will
 * eat against what is in store and already being milled, and the shortfall
 * to raise a milling order for.
 */
export default async function FeedPlanPage({ searchParams }: { searchParams: Promise<{ horizon?: string }> }) {
  const { horizon } = await searchParams;
  const days = Number(horizon) >= 1 && Number(horizon) <= 120 ? Math.floor(Number(horizon)) : 14;
  const [plan, farms, context] = await Promise.all([
    api<{ horizonDays: number; lines: PlanLine[]; unplanned: PlanGroup[] }>(`/feed-mill/plan?horizon=${days}`),
    getFarms(),
    getContext(),
  ]);

  return (
    <>
      <PageHeader title="Feed plan" subtitle="What the flocks and cohorts will eat, against feed in store and on order" />
      <Tabs />
      <div className="stack">
        <Card
          title={`Next ${plan.horizonDays} days`}
          subtitle="Each batch's daily rate is what it was fed over the last week; with none recorded, its stage's standard grams per head"
          padded={false}
        >
          <form className="row" style={{ gap: 'var(--sp-2)', padding: 'var(--sp-3) var(--sp-4)', alignItems: 'end', flexWrap: 'wrap' }}>
            <label className="field" style={{ margin: 0 }}>
              Days ahead
              <input type="number" name="horizon" min="1" max="120" defaultValue={days} />
            </label>
            <button type="submit" className="btn">
              Plan
            </button>
          </form>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Feed</th>
                  <th className="right" style={{ width: 100 }}>Per day</th>
                  <th className="right" style={{ width: 110 }}>Needed</th>
                  <th className="right" style={{ width: 110 }}>In store</th>
                  <th className="right" style={{ width: 110 }}>Being milled</th>
                  <th className="right" style={{ width: 110 }}>Short</th>
                  <th className="right" style={{ width: 90 }}>Days covered</th>
                  <th style={{ width: 260 }}>Mill it</th>
                </tr>
              </thead>
              <tbody>
                {plan.lines.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="faint">
                      No live batch has feeding recorded against a feed item, or a stage standard to plan from.
                    </td>
                  </tr>
                ) : (
                  plan.lines.map((line) => (
                    <tr key={line.itemId}>
                      <td style={{ textAlign: 'left' }}>
                        <span className="strong">
                          {line.itemCode} — {line.description}
                        </span>
                        <div className="faint" style={{ fontSize: 12 }}>
                          {line.groups.map((g) => `${g.code} (${kg(g.dailyKg)} kg/day${g.basis === 'STAGE_STANDARD' ? ', stage standard' : ''})`).join(', ')}
                        </div>
                      </td>
                      <td className="num right">{kg(line.dailyKg)}</td>
                      <td className="num right">{kg(line.demandKg)}</td>
                      <td className="num right">{kg(line.onHandKg)}</td>
                      <td className="num right">{kg(line.openOrdersKg)}</td>
                      <td className="num right">
                        {Number(line.shortfallKg) > 0 ? <span className="badge badge-danger">{kg(line.shortfallKg)}</span> : '—'}
                      </td>
                      <td className="num right">{line.daysCovered ?? '—'}</td>
                      <td>
                        {Number(line.shortfallKg) <= 0 ? (
                          <span className="faint">Covered</span>
                        ) : line.recipeVersionId ? (
                          <RaiseFeedOrder
                            recipeVersionId={line.recipeVersionId}
                            recipeName={line.recipeName ?? ''}
                            quantity={Number(line.shortfallKg).toFixed(3)}
                            farms={farms.filter((f) => f.active).map((f) => ({ id: f.id, name: f.name }))}
                            branches={context.branches.map((b) => ({ id: b.id, name: b.name }))}
                          />
                        ) : (
                          <span className="faint">No active recipe mills this feed — buy it in.</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
        {plan.unplanned.length > 0 ? (
          <Card title="Not in the plan" subtitle="Live batches with no feed item fed recently and no stage standard to go on">
            <p style={{ margin: 0 }}>
              {plan.unplanned.map((g) => `${g.code} (${g.stage}, ${g.population.toLocaleString('en-NG')})`).join(', ')}. Record their feeding against a
              feed item, or set grams per head for the stage under Setup → Breeds.
            </p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
