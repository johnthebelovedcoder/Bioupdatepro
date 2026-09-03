import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Reports — BioAssetPro' };

interface ReportDefinition {
  key: string;
  name: string;
  purpose: string;
  owner: string;
  frequency: string;
  webPath: string;
  exportSupported: boolean;
  drillThroughSupported: boolean;
}

/**
 * An index of every report this company can run — now a real, metadata-
 * driven catalogue (US-897-033): GET /reporting/catalogue reads
 * ReportDefinition rows (purpose/owner/frequency/filters/measures), not a
 * hardcoded array. This page is the consumer that was missing before —
 * building the governed table without one would have been scope invented
 * ahead of any need, which is why this stayed a plain list for as long as
 * it did.
 */
export default async function ReportsPage() {
  let reports: ReportDefinition[] = [];
  let error: string | null = null;
  try {
    reports = await api<ReportDefinition[]>('/reporting/catalogue');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not load the report catalogue.';
  }

  return (
    <div className="stack">
      <PageHeader title="Reports" subtitle="Every report this company can run, in one place" />

      <Tabs />

      {error ? <div className="notice notice-error">{error}</div> : null}

      <div className="stat-grid">
        {reports.map((report) => (
          <Link
            key={report.key}
            href={report.webPath}
            className="stat"
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
          >
            <div className="stat-label">{report.name}</div>
            <p className="faint" style={{ marginTop: 'var(--sp-2)', fontSize: 13 }}>
              {report.purpose}
            </p>
            <p className="faint" style={{ marginTop: 'var(--sp-2)', fontSize: 12 }}>
              {report.owner} · {report.frequency}
              {report.exportSupported ? ' · CSV export' : ''}
              {report.drillThroughSupported ? ' · drill-through' : ''}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
