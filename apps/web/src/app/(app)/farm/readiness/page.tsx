import Link from 'next/link';
import { api } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Harvest readiness — BioAssetPro' };

type Check = { status: 'PASS' | 'FAIL' | 'NO_DATA'; detail: string };

interface Readiness {
  groupId: string;
  code: string;
  speciesKey: string;
  breed: string;
  farm: string;
  pen: string;
  stage: string;
  population: number;
  ageDays: number;
  ready: boolean;
  safeToSellFrom: string | null;
  checks: { age: Check; weight: Check; stage: Check; health: Check; withdrawal: Check };
}

const COLUMNS: Array<[keyof Readiness['checks'], string]> = [
  ['age', 'Age'],
  ['weight', 'Weight'],
  ['stage', 'Stage'],
  ['health', 'Health'],
  ['withdrawal', 'Withdrawal'],
];

const MARK: Record<Check['status'], { text: string; tone: string }> = {
  PASS: { text: 'pass', tone: 'badge-success' },
  FAIL: { text: 'not yet', tone: 'badge-danger' },
  NO_DATA: { text: 'no data', tone: 'badge-warning' },
};

/**
 * Harvest/QA readiness (handbook §59.4 and §59.5): age alone never releases
 * a batch — weight, stage, health and any withdrawal period must pass too.
 */
export default async function ReadinessPage({ searchParams }: { searchParams: Promise<{ on?: string }> }) {
  const { on } = await searchParams;
  const valid = on && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : undefined;
  const rows = await api<Readiness[]>(`/operations/harvest-readiness${valid ? `?on=${valid}` : ''}`);
  const ready = rows.filter((r) => r.ready);

  return (
    <>
      <PageHeader
        title="Harvest readiness"
        subtitle="Every active batch against age, weight, stage, health and withdrawal — ready only when all five pass"
      />
      <Tabs />
      <div className="stack">
        <Card
          title={`${ready.length} of ${rows.length} batches ready${valid ? ` on ${valid}` : ' today'}`}
          subtitle="Withdrawal comes from treatments given; weight from the current approved weighing against the breed's last stage"
          padded={false}
        >
          <form className="row" style={{ gap: 'var(--sp-2)', padding: 'var(--sp-3) var(--sp-4)', flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="field" style={{ margin: 0 }}>
              As of
              <input type="date" name="on" defaultValue={valid ?? ''} />
            </label>
            <button type="submit" className="btn">
              Show
            </button>
          </form>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Batch</th>
                  <th>Where</th>
                  <th className="right" style={{ width: 90 }}>Alive</th>
                  <th className="right" style={{ width: 80 }}>Days</th>
                  {COLUMNS.map(([, label]) => (
                    <th key={label} style={{ width: 110 }}>
                      {label}
                    </th>
                  ))}
                  <th style={{ width: 110 }}>Ready</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="faint">
                      No active batches.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.groupId}>
                      <td className="strong" style={{ textAlign: 'left' }}>
                        <Link href={`/m/${r.speciesKey}/${r.speciesKey === 'snail' ? 'cohorts' : 'flocks'}/${encodeURIComponent(r.code)}`}>{r.code}</Link>
                        <div className="faint" style={{ fontSize: 12 }}>
                          {r.breed}, {r.stage}
                        </div>
                      </td>
                      <td>
                        {r.farm} · {r.pen}
                      </td>
                      <td className="num right">{r.population.toLocaleString('en-NG')}</td>
                      <td className="num right">{r.ageDays}</td>
                      {COLUMNS.map(([key]) => (
                        <td key={key} title={r.checks[key].detail}>
                          <span className={`badge ${MARK[r.checks[key].status].tone}`}>{MARK[r.checks[key].status].text}</span>
                          {r.checks[key].status !== 'PASS' ? (
                            <div className="faint" style={{ fontSize: 12 }}>
                              {r.checks[key].detail}
                            </div>
                          ) : null}
                        </td>
                      ))}
                      <td>
                        <span className={`badge ${r.ready ? 'badge-success' : ''}`}>{r.ready ? 'ready' : 'not ready'}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
