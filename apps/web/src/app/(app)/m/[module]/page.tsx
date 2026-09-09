import { notFound } from 'next/navigation';
import { getModule, title } from '@/lib/modules';
import { getGroups, getModuleSummary, getModuleTrend } from '@/lib/operations';
import { Card, PageHeader, Stat } from '@/components/ui';
import { TrendChart } from '@/components/trend-chart';
import { PeriodFilter } from '@/components/period-filter';
import { resolvePeriod, type PeriodKey } from '@/lib/period';
import { getFarmConfig } from '@/lib/farm-config.server';

/**
 * The overview for whichever species module is selected.
 *
 * ONE page serves poultry, snails and every module added later. Everything that
 * differs — the nouns, the metrics, the name of a production record — comes
 * from the module registry. Adding FishPro does not add a route.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module: key } = await params;
  const module = getModule(key);
  return { title: module ? `${module.productName} — BioAssetPro` : 'BioAssetPro' };
}

export default async function ModuleOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { module: key } = await params;
  const config = await getFarmConfig();
  const period = resolvePeriod(
    (await searchParams).period,
    config.organisation.financialYearStartMonth,
  );
  const module = getModule(key);

  // An unknown module, or one the organisation has not subscribed to, is not
  // reachable. The switcher hides them, but hiding a control is not access
  // control.
  if (!module || !module.subscribed) notFound();

  const [summary, groups, trend] = await Promise.all([
    getModuleSummary(module.key),
    getGroups(module.key),
    getModuleTrend(module, period.days),
  ]);
  const active = groups.filter((group) => group.status === 'ACTIVE');

  return (
    <>
      <PageHeader
        title={`${title(module.terms.animal.many)} overview`}
        subtitle={`${module.productName} · ${summary.groupCount} active ${
          summary.groupCount === 1 ? module.terms.group.one : module.terms.group.many
        }`}
      />

      <div className="stack">
        <PeriodFilter active={period.key as PeriodKey} />

        {/* Whichever metrics the module declares — a module with no real
            source for one (snail's hatch rate has no backing data yet)
            simply has no figure for that key, and the card skips it rather
            than showing an invented number. */}
        <div className="stat-grid">
          {module.metrics.map((metric) => {
            const figure = summary.metrics[metric.key];
            if (!figure) return null;
            return (
              <Stat
                key={metric.key}
                label={metric.label}
                value={figure.value}
                goodWhen={metric.goodWhen}
                {...(metric.hint ? { hint: metric.hint } : {})}
              />
            );
          })}
        </div>

        <Card
          title={trend.chartTitle}
          subtitle={period.caption}
        >
          <TrendChart points={trend.outputSeries} valueLabel={trend.chartUnit} />
        </Card>

        <Card
          title="Daily mortality"
          subtitle={`All ${module.terms.group.many}, last 14 recorded days`}
        >
          {/* Separate from the chart above rather than a second line on it.
              Output runs orders of magnitude above mortality; sharing an axis
              would need two scales, and where two such lines cross would be an
              artefact of the scales chosen rather than a fact about the farm.
              The window here is fixed rather than following the period filter
              above — each population's mortality record only ever carries its
              own last 14 recorded days, so a wider period would not add days,
              only claim a caption the data cannot back. */}
          <TrendChart
            points={trend.mortalitySeries}
            kind="bar"
            tone="danger"
            valueLabel="deaths"
          />
        </Card>

        <Card
          title={title(module.terms.group.many)}
          subtitle={`Every active ${module.terms.group.one}`}
          padded={false}
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>{title(module.terms.group.one)}</th>
                  <th>Breed</th>
                  <th style={{ width: 150 }}>{title(module.terms.housing.one)}</th>
                  <th className="right" style={{ width: 120 }}>
                    {title(module.terms.animal.many)}
                  </th>
                  <th className="right" style={{ width: 110 }}>
                    Mortality
                  </th>
                  <th style={{ width: 90 }}>Age</th>
                </tr>
              </thead>
              <tbody>
                {active.map((group) => (
                  <tr key={group.id}>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      {group.code}
                    </td>
                    <td>
                      {group.breed}
                      <div className="faint">{group.purpose}</div>
                    </td>
                    <td>{group.house}</td>
                    <td className="num">{group.population.toLocaleString('en-NG')}</td>
                    <td className="num">
                      <span
                        className={
                          group.mortalityRate > 5 ? 'num-credit' : undefined
                        }
                      >
                        {group.mortalityRate.toFixed(2)}%
                      </span>
                    </td>
                    <td className="faint">{formatAge(group.ageDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function formatAge(days: number): string {
  if (days < 70) return `${days} d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 60) return `${weeks} wk`;
  return `${Math.floor(days / 30)} mo`;
}
