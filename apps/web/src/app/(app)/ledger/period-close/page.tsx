import Link from 'next/link';
import { getContext, defaultYear } from '@/lib/org';
import { formatDate } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconClipboard } from '@/components/icons';
import { ClosePackCheck } from '@/components/close-pack-check';
import { api } from '@/lib/api';

interface ClosePack {
  id: string;
  scope: 'PERIOD' | 'YEAR';
  period: string | null;
  year: string | null;
  sha256: string;
  closedAt: string;
  closedBy: string | null;
}

export const metadata = { title: 'Period close — BioAssetPro' };

const STATUS_TONE: Record<string, string> = {
  OPEN: '',
  SOFT_CLOSED: 'badge-warning',
  CLOSED: 'badge-success',
  ARCHIVED: '',
};

/**
 * §8 — the checklist, the validations, and the workflow-governed close and
 * reopen for one month at a time. Year-end rollover is a separate, larger
 * step and lives on its own screen.
 */
export default async function PeriodClosePage() {
  const context = await getContext();
  const year = defaultYear(context);
  // Not every role that sees this page may read the packs; they simply do not see the card.
  const packs = year ? await api<ClosePack[]>(`/close-packs?financialYearId=${year.id}`).catch(() => null) : null;

  return (
    <>
      <PageHeader
        title="Period close"
        subtitle="Checklist, validation and close — one financial period at a time"
      />

      <Tabs />

      <div className="stack">
        {!year || year.periods.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconClipboard size={22} />}
              title="No financial periods yet"
              body="Periods are set up under company configuration before any can be closed."
            />
          </Card>
        ) : (
          <Card title={year.code} subtitle={`${year.periods.length} periods`} padded={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>#</th>
                    <th>Period</th>
                    <th style={{ width: 130 }}>Starts</th>
                    <th style={{ width: 130 }}>Ends</th>
                    <th style={{ width: 130 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {year.periods.map((period) => (
                    <tr key={period.id}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {period.periodNumber}
                      </td>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        <Link href={`/ledger/period-close/${period.id}`}>{period.name}</Link>
                      </td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(period.startDate)}
                      </td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(period.endDate)}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_TONE[period.status] ?? ''}`}>
                          {period.status.toLowerCase().replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {packs ? (
          <Card
            title="Close packs"
            subtitle="The trial balance stored at each close, with its SHA-256 fingerprint. Check one to see it is unaltered and still agrees with the ledger."
            padded={false}
          >
            {packs.length === 0 ? (
              <div style={{ padding: 'var(--sp-5)' }}>
                <span className="faint">None yet. A pack is stored when a period is closed, and at year end.</span>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Closed</th>
                      <th>Period</th>
                      <th>By</th>
                      <th>Fingerprint</th>
                      <th style={{ width: 260 }}>Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packs.map((p) => (
                      <tr key={p.id}>
                        <td>{formatDate(p.closedAt.slice(0, 10))}</td>
                        <td className="strong">{p.scope === 'YEAR' ? `Year ${p.year ?? ''}` : p.period}</td>
                        <td>{p.closedBy ?? '—'}</td>
                        <td>
                          <code title={p.sha256} style={{ fontSize: 12 }}>{p.sha256.slice(0, 16)}…</code>
                        </td>
                        <td>
                          <ClosePackCheck packId={p.id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
