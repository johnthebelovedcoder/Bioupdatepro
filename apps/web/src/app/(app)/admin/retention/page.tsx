import { api } from '@/lib/api';
import { formatDate } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Record retention — BioAssetPro' };

interface Retention {
  asOf: string;
  deletes: boolean;
  rules: Array<{
    key: string;
    label: string;
    years: number;
    basis: string;
    after: string;
    keptUntilBefore: string;
    total: number;
    oldest: string | null;
    pastMinimum: number;
  }>;
  years: Array<{ code: string; status: string; startDate: string; endDate: string }>;
}

/**
 * How long each kind of record is kept, and what the farm holds against that.
 * The application deletes nothing: posted records cannot be deleted at all,
 * and a closed year is archived, not removed.
 */
export default async function RetentionPage() {
  const report = await api<Retention>('/retention').catch(() => null);

  return (
    <>
      <PageHeader title="Record retention" subtitle="How long each kind of record is kept. Nothing here is ever deleted by the app." />
      <Tabs />
      <div className="stack">
        {!report ? (
          <Card>
            <p className="faint" style={{ margin: 0 }}>Record retention is shown to administrators, the CFO, the finance controller and auditors.</p>
          </Card>
        ) : (
          <>
            <Card
              title="Retention schedule"
              subtitle={`As of ${formatDate(report.asOf)}. A record past its minimum is only flagged for the company to review.`}
              padded={false}
            >
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Records</th>
                      <th>Kept at least</th>
                      <th className="num">Held</th>
                      <th>Oldest</th>
                      <th className="num">Past minimum</th>
                      <th>After that</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rules.map((r) => (
                      <tr key={r.key}>
                        <td>
                          <div className="strong">{r.label}</div>
                          <div className="faint" style={{ fontSize: 13 }}>{r.basis}</div>
                        </td>
                        <td>{r.years} years</td>
                        <td className="num">{r.total.toLocaleString('en-NG')}</td>
                        <td>{formatDate(r.oldest)}</td>
                        <td className="num">{r.pastMinimum > 0 ? <span className="badge badge-warning">{r.pastMinimum.toLocaleString('en-NG')}</span> : '0'}</td>
                        <td className="faint" style={{ fontSize: 13 }}>{r.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Financial years" subtitle="A year is archived by the year-end close. Archived years stay readable and cannot change." padded={false}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>From</th>
                      <th>To</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.years.map((y) => (
                      <tr key={y.code}>
                        <td className="strong">{y.code}</td>
                        <td>{formatDate(y.startDate)}</td>
                        <td>{formatDate(y.endDate)}</td>
                        <td>
                          <span className="badge">{y.status.toLowerCase().replace(/_/g, ' ')}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
