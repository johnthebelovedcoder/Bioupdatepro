import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Reports — BioAssetPro' };

interface ReportEntry {
  id: string;
  key: string;
  module: 'AgriPro' | 'SnailPro' | 'PoultryPro';
  name: string;
  purpose: string;
  owner: string;
  frequency: string;
  webPath: string | null;
  status: 'BUILT' | 'PARTIAL' | 'NOT_BUILT';
  gap: string | null;
  exportSupported: boolean;
  drillThroughSupported: boolean;
}

const MODULES: Array<{ module: ReportEntry['module']; title: string }> = [
  { module: 'AgriPro', title: 'Finance, stores and people' },
  { module: 'SnailPro', title: 'Snails' },
  { module: 'PoultryPro', title: 'Poultry' },
];

/**
 * Every report in the client's catalogue (REPORT_KPI_CATALOG) and where it
 * lives — GET /reporting/catalogue, owned by the API's code so every farm
 * sees the same list. A report not fully built says what is missing rather
 * than linking to a screen that does not answer it.
 */
export default async function ReportsPage() {
  let reports: ReportEntry[] = [];
  let error: string | null = null;
  try {
    reports = await api<ReportEntry[]>('/reporting/catalogue');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not load the report catalogue.';
  }
  const built = reports.filter((r) => r.status === 'BUILT').length;

  return (
    <div className="stack">
      <PageHeader title="Reports" subtitle={`Every report in the catalogue — ${built} of ${reports.length} ready`} />

      <Tabs />

      {error ? <div className="notice notice-error">{error}</div> : null}

      {MODULES.map(({ module, title }) => {
        const rows = reports.filter((r) => r.module === module);
        if (rows.length === 0) return null;
        return (
          <section key={module} className="stack" style={{ gap: 'var(--sp-3)' }}>
            <h2 className="section-title">{title}</h2>
            <div className="stat-grid">
              {rows.map((report) => {
                const body = (
                  <>
                    <div className="stat-label">
                      {report.name}
                      {report.status !== 'BUILT' ? (
                        <span className={`badge ${report.status === 'PARTIAL' ? 'badge-warning' : ''}`} style={{ marginLeft: 8 }}>
                          {report.status === 'PARTIAL' ? 'in part' : 'not built'}
                        </span>
                      ) : null}
                    </div>
                    <p className="faint" style={{ marginTop: 'var(--sp-2)', fontSize: 13 }}>
                      {report.purpose}
                    </p>
                    {report.gap ? (
                      <p className="faint" style={{ marginTop: 'var(--sp-2)', fontSize: 12 }}>
                        <strong>Not yet: </strong>
                        {report.gap}
                      </p>
                    ) : null}
                    <p className="faint" style={{ marginTop: 'var(--sp-2)', fontSize: 12 }}>
                      {report.id.startsWith('APP-') ? '' : `${report.id} · `}
                      {report.owner} · {report.frequency}
                      {report.exportSupported ? ' · CSV export' : ''}
                      {report.drillThroughSupported ? ' · drill-through' : ''}
                    </p>
                  </>
                );
                return report.webPath ? (
                  <Link key={report.id} href={report.webPath} className="stat" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                    {body}
                  </Link>
                ) : (
                  <div key={report.id} className="stat" style={{ opacity: 0.7 }}>
                    {body}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
