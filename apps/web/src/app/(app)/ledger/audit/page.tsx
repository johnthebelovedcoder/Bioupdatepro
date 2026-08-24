import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/money';
import { Pagination } from '@/components/pagination';
import { AuditFilters } from './filters';
import { PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Audit trail — BioAssetPro' };

interface Record_ {
  id: string;
  occurredAt: string;
  module: string;
  entityType: string;
  entityId: string;
  action: string;
  status: string;
  user: string;
  ipAddress: string | null;
  device: string | null;
  comments: string | null;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;

  const query = new URLSearchParams();
  if (params.module) query.set('module', params.module);
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', params.page);

  const result = await api<{
    total: number;
    page: number;
    pageCount: number;
    modules: string[];
    records: Record_[];
  }>(`/reporting/audit?${query.toString()}`);

  return (
    <div className="stack">
      <PageHeader
        title="Audit trail"
        subtitle="Every workflow event and every posting, with the user, time, IP and device that produced it. Append-only in the database."
      />

      <Tabs />

      <AuditFilters
        modules={result.modules}
        selected={{ module: params.module ?? '', search: params.search ?? '' }}
      />

      <div className="card">
        {result.records.length === 0 ? (
          <div className="card-body muted">No audit records match this selection.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>When</th>
                    <th style={{ width: 110 }}>Module</th>
                    <th style={{ width: 130 }}>Action</th>
                    <th>Entity</th>
                    <th style={{ width: 150 }}>User</th>
                    <th style={{ width: 120 }}>Origin</th>
                  </tr>
                </thead>
                <tbody>
                  {result.records.map((record) => (
                    <tr key={record.id}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDateTime(record.occurredAt)}
                      </td>
                      <td className="faint">{record.module}</td>
                      <td>
                        <span className="badge badge-accent">{record.action}</span>
                      </td>
                      <td>
                        {record.entityType}
                        <div className="faint num" style={{ textAlign: 'left' }}>
                          {record.entityId}
                        </div>
                        {record.comments ? (
                          <div className="faint">{record.comments}</div>
                        ) : null}
                      </td>
                      <td>
                        {record.user}
                        <div className="faint">{record.status}</div>
                      </td>
                      <td className="faint">
                        <div className="num" style={{ textAlign: 'left' }}>
                          {record.ipAddress ?? '—'}
                        </div>
                        <div title={record.device ?? ''}>
                          {shortDevice(record.device)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              noun="record"
            />
          </>
        )}
      </div>
    </div>
  );
}

/** A full user-agent string is unreadable in a table; the browser name is enough. */
function shortDevice(device: string | null): string {
  if (!device) return '—';
  for (const name of ['Edg', 'Chrome', 'Firefox', 'Safari']) {
    if (device.includes(name)) return name === 'Edg' ? 'Edge' : name;
  }
  return device.slice(0, 18);
}
