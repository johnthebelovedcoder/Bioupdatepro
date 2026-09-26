import Link from 'next/link';
import { getTimesheetChoices, getTimesheets } from '@/lib/farm-costing';
import { formatDate } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconClipboard } from '@/components/icons';
import { TimesheetForm } from '@/components/timesheet-form';
import { approveHours, removeHours } from './actions';

export const metadata = { title: 'Timesheets — BioAssetPro' };

/**
 * Hours people worked on each batch — what "share wages by hours worked"
 * uses on Books → Farm costing (PCR-028: approved hours × actual payroll
 * rate). One month at a time.
 */
export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ month?: string; error?: string }> }) {
  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const month = /^\d{4}-\d{2}$/.test(params.month ?? '') ? params.month! : today.slice(0, 7);
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const from = `${month}-01`;
  const to = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
  const previous = new Date(Date.UTC(year, mon - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 7);

  const [entries, choices] = await Promise.all([
    getTimesheets(from, to).catch(() => []),
    getTimesheetChoices().catch(() => ({ employees: [], groups: [], orders: [] })),
  ]);
  const monthName = new Date(Date.UTC(year, mon - 1, 1)).toLocaleString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const pending = entries.filter((e) => e.status === 'PENDING');

  // Totals by person and by batch, so the month can be checked at a glance.
  const byPerson = new Map<string, number>();
  const byBatch = new Map<string, number>();
  for (const e of entries) {
    byPerson.set(e.employee, (byPerson.get(e.employee) ?? 0) + Number(e.hours));
    byBatch.set(e.group, (byBatch.get(e.group) ?? 0) + Number(e.hours));
  }

  return (
    <div className="stack">
      <PageHeader
        title="Timesheets"
        subtitle="Hours people worked on each batch — used to share wages by hours worked"
        actions={<TimesheetForm employees={choices.employees} groups={choices.groups} orders={choices.orders ?? []} today={today} />}
      />
      <Tabs />

      {params.error ? <div className="notice notice-error">{params.error}</div> : null}
      {pending.length > 0 ? (
        <div className="notice notice-warning row" style={{ justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <span>
            {pending.length} entr{pending.length === 1 ? 'y is' : 'ies are'} waiting for approval. Only approved hours are used to
            share wages.
          </span>
          <form action={approveHours}>
            <input type="hidden" name="ids" value={pending.map((e) => e.id).join(',')} />
            <button type="submit" className="btn btn-sm btn-primary">
              Approve all {pending.length}
            </button>
          </form>
        </div>
      ) : null}

      {choices.employees.length === 0 ? (
        <div className="notice notice-warning">
          No active staff yet. Hours are logged against people in the staff register, so add them there first.
        </div>
      ) : null}

      <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
        <Link href={`/finance/timesheets?month=${previous}`} className="btn btn-sm btn-ghost">
          ← Previous
        </Link>
        <strong>{monthName}</strong>
        {next <= today.slice(0, 7) ? (
          <Link href={`/finance/timesheets?month=${next}`} className="btn btn-sm btn-ghost">
            Next →
          </Link>
        ) : null}
      </div>

      {entries.length > 0 ? (
        <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
          <Card title="By person">
            {[...byPerson].map(([name, hours]) => (
              <div key={name} className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-4)' }}>
                <span>{name}</span>
                <span className="num">{hours.toLocaleString('en-NG')} h</span>
              </div>
            ))}
          </Card>
          <Card title="By batch">
            {[...byBatch].map(([code, hours]) => (
              <div key={code} className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-4)' }}>
                <span>{code}</span>
                <span className="num">{hours.toLocaleString('en-NG')} h</span>
              </div>
            ))}
          </Card>
        </div>
      ) : null}

      <Card title={`Hours in ${monthName}`} padded={false}>
        {entries.length === 0 ? (
          <EmptyState icon={<IconClipboard size={22} />} title="No hours logged" body="Log hours above as people work on each batch." />
        ) : (
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Who</th>
                  <th>Batch or order</th>
                  <th className="right">Hours</th>
                  <th>Note</th>
                  <th>Status</th>
                  <th style={{ width: 170 }} />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.workDate)}</td>
                    <td>{e.employee}</td>
                    <td className="strong">{e.group}</td>
                    <td className="num">{Number(e.hours).toLocaleString('en-NG')}</td>
                    <td className="faint">{e.notes ?? ''}</td>
                    <td>
                      {e.status === 'APPROVED' ? (
                        <span className="badge badge-success">{e.selfApproved ? 'self-approved' : 'approved'}</span>
                      ) : (
                        <span className="badge badge-warning">pending</span>
                      )}
                    </td>
                    <td className="row" style={{ gap: 'var(--sp-1)' }}>
                      {e.status === 'PENDING' ? (
                        <form action={approveHours}>
                          <input type="hidden" name="ids" value={e.id} />
                          <button type="submit" className="btn btn-sm btn-ghost">
                            Approve
                          </button>
                        </form>
                      ) : null}
                      <form action={removeHours}>
                        <input type="hidden" name="id" value={e.id} />
                        <button type="submit" className="btn btn-sm btn-ghost">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
