import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { IconAlert } from '@/components/icons';

export const metadata = { title: 'Mortality and cull — BioAssetPro' };

interface Report {
  totals: { placed: number; deaths: number; culls: number; mortalityPercent: string | null; cullPercent: string | null };
  batches: Array<{
    code: string;
    stage: string;
    status: string;
    placed: number;
    alive: number;
    deaths: number;
    abnormalDeaths: number;
    culls: number;
    mortalityPercent: string | null;
    cullPercent: string | null;
    survivalPercent: string | null;
  }>;
  byCause: Array<{ key: string; deaths: number }>;
  byStage: Array<{ key: string; deaths: number }>;
}

const SPECIES = [
  { key: 'poultry', label: 'Poultry' },
  { key: 'snail', label: 'Snails' },
];
const n = (v: number) => v.toLocaleString('en-NG');
const pct = (v: string | null) => (v === null ? '—' : `${v}%`);

/**
 * Mortality, survival and cull (REPORT_KPI_CATALOG SNL-005, PLY-004): by
 * batch, by cause and by the stage the animals were at when they died.
 */
export default async function MortalityPage({ searchParams }: { searchParams: Promise<{ species?: string }> }) {
  const { species: asked } = await searchParams;
  const species = SPECIES.find((s) => s.key === asked) ?? SPECIES[0]!;
  let report: Report | null = null;
  let error: string | null = null;
  try {
    report = await api<Report>(`/operations/mortality?species=${species.key}`);
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not load the mortality report.';
  }

  return (
    <>
      <PageHeader title="Mortality and cull" subtitle="Deaths and culls by batch, cause and stage — each as a share of what was placed" />
      <div className="chip-row" role="group" aria-label="Species" style={{ marginBottom: 'var(--sp-4)' }}>
        {SPECIES.map((s) => (
          <Link key={s.key} href={`/farm/mortality?species=${s.key}`} className="chip" aria-pressed={s.key === species.key}>
            {s.label}
          </Link>
        ))}
      </div>
      {error ? <div className="notice notice-error">{error}</div> : null}

      {report ? (
        <div className="stack">
          <div className="stat-grid">
            <Stat label="Placed" value={n(report.totals.placed)} />
            <Stat label="Died" value={n(report.totals.deaths)} hint={`Mortality ${pct(report.totals.mortalityPercent)}`} goodWhen="down" />
            <Stat label="Culled" value={n(report.totals.culls)} hint={`Cull rate ${pct(report.totals.cullPercent)}`} goodWhen="down" />
          </div>

          <Card title="By batch" padded={false}>
            {report.batches.length === 0 ? (
              <EmptyState icon={<IconAlert size={22} />} title="Nothing placed yet" body="Batches appear here once they are placed." />
            ) : (
              <div className="table-wrap">
                <table className="data wide">
                  <thead>
                    <tr>
                      <th>Batch</th>
                      <th className="num">Placed</th>
                      <th className="num">Died</th>
                      <th className="num">of which abnormal</th>
                      <th className="num">Culled</th>
                      <th className="num">Alive</th>
                      <th className="num">Mortality</th>
                      <th className="num">Cull rate</th>
                      <th className="num">Survival</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.batches.map((b) => (
                      <tr key={b.code}>
                        <td>
                          {b.code}
                          <div className="faint">
                            {b.stage}
                            {b.status !== 'ACTIVE' ? ` · ${b.status.toLowerCase()}` : ''}
                          </div>
                        </td>
                        <td className="num">{n(b.placed)}</td>
                        <td className="num">{n(b.deaths)}</td>
                        <td className="num">{n(b.abnormalDeaths)}</td>
                        <td className="num">{n(b.culls)}</td>
                        <td className="num">{n(b.alive)}</td>
                        <td className="num strong">{pct(b.mortalityPercent)}</td>
                        <td className="num">{pct(b.cullPercent)}</td>
                        <td className="num">{pct(b.survivalPercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid-auto">
            {[
              { title: 'By cause', rows: report.byCause, empty: 'No deaths recorded.' },
              { title: 'By stage when they died', rows: report.byStage, empty: 'No deaths recorded.' },
            ].map((block) => (
              <Card key={block.title} title={block.title} padded={false}>
                {block.rows.length === 0 ? (
                  <p className="faint" style={{ padding: 'var(--sp-4)' }}>
                    {block.empty}
                  </p>
                ) : (
                  <table className="data">
                    <tbody>
                      {block.rows.map((row) => (
                        <tr key={row.key}>
                          <td>{row.key}</td>
                          <td className="num">{n(row.deaths)}</td>
                          <td className="num faint">{report!.totals.deaths ? `${((row.deaths / report!.totals.deaths) * 100).toFixed(1)}%` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
