import Link from 'next/link';
import { defaultYear, getContext } from '@/lib/org';
import {
  getCloseLog,
  getYearBalances,
  validateYearEnd,
  type YearBalance,
} from '@/lib/closing';
import { getGlAccounts } from '@/lib/trade';
import { formatDate, formatDateTime, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconClipboard } from '@/components/icons';
import { YearEndCloseForm } from '@/components/year-end-close-form';

export const metadata = { title: 'Year-end close — BioAssetPro' };

/**
 * Rolling one financial year into the next.
 *
 * The monthly close lives under Period close; this is the step after the
 * twelfth month is closed — sweep the year's result into retained earnings,
 * record closing balances, open the next year with them carried in.
 */
export default async function YearEndPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const [context, params] = await Promise.all([getContext(), searchParams]);
  const years = context.financialYears;
  const year = years.find((y) => y.id === params.year) ?? defaultYear(context);

  if (!year) {
    return (
      <>
        <PageHeader title="Year-end close" />
        <Tabs />
        <Card>
          <EmptyState
            icon={<IconClipboard size={22} />}
            title="No financial years yet"
            body="A financial year is set up with the company. There is nothing to close."
          />
        </Card>
      </>
    );
  }

  const [closing, opening, log, accounts] = await Promise.all([
    getYearBalances(year.id, false),
    getYearBalances(year.id, true),
    getCloseLog(year.id),
    getGlAccounts().catch(() => []),
  ]);
  const closed = closing.length > 0;
  const validation = closed ? null : await validateYearEnd(year.id);
  const equityAccounts = accounts.filter((account) => account.accountType === 'EQUITY');
  const closedPeriods = year.periods.filter(
    (p) => p.status === 'CLOSED' || p.status === 'ARCHIVED',
  ).length;

  return (
    <>
      <PageHeader
        title="Year-end close"
        subtitle="Sweep the year's result to retained earnings and carry balances into the next"
      />

      <Tabs />

      <div className="stack">
        {years.length > 1 ? (
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {years.map((y) => (
              <Link
                key={y.id}
                href={`/ledger/year-end?year=${y.id}`}
                className={`btn btn-sm ${y.id === year.id ? 'btn-primary' : 'btn-ghost'}`}
              >
                {y.code}
              </Link>
            ))}
          </div>
        ) : null}

        <Card title={year.code}>
          <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`badge ${closed ? 'badge-success' : ''}`}>
              {closed ? 'closed' : year.status.toLowerCase()}
            </span>
            <span className="faint">
              {formatDate(year.startDate)} – {formatDate(year.endDate)}
            </span>
            <span className="faint">
              {closedPeriods} of {year.periods.length} periods closed —{' '}
              <Link href="/ledger/period-close">Period close</Link>
            </span>
          </div>
        </Card>

        {validation ? (
          <Card
            title="Before it can close"
            subtitle={validation.canClose ? 'Every blocking check passes' : 'Blocking checks remain'}
          >
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Check</th>
                      <th style={{ width: 100 }}>Blocking</th>
                      <th style={{ width: 100 }}>Result</th>
                      <th>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.findings.map((finding) => (
                      <tr key={finding.code}>
                        <td style={{ textAlign: 'left' }}>{finding.name}</td>
                        <td>{finding.blocking ? 'Yes' : 'No'}</td>
                        <td>
                          <span
                            className={`badge ${
                              finding.passed
                                ? 'badge-success'
                                : finding.blocking
                                  ? 'badge-danger'
                                  : 'badge-warning'
                            }`}
                          >
                            {finding.passed ? 'pass' : finding.blocking ? 'fail' : 'warning'}
                          </span>
                        </td>
                        <td className="faint" style={{ textAlign: 'left' }}>
                          {finding.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <YearEndCloseForm
                financialYearId={year.id}
                yearCode={year.code}
                canClose={validation.canClose}
                equityAccounts={equityAccounts}
              />
            </div>
          </Card>
        ) : !closed ? (
          <div className="notice notice-error">
            The year-end checks could not be run. Year-end close is open to the Finance
            Controller and CFO.
          </div>
        ) : null}

        {closed ? (
          <BalancesCard
            title="Closing balances"
            subtitle="Recorded when the year closed — the figures the next year opened from"
            rows={closing}
          />
        ) : null}

        {opening.length > 0 ? (
          <BalancesCard
            title="Opening balances"
            subtitle="Carried in from the year before"
            rows={opening}
          />
        ) : null}

        {log.length > 0 ? (
          <Card title="Close log" subtitle="Every close, soft-close and reopen in this year" padded={false}>
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>When</th>
                    <th style={{ width: 130 }}>Action</th>
                    <th>Period</th>
                    <th style={{ width: 180 }}>Status</th>
                    <th>By</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((entry, index) => (
                    <tr key={`${entry.occurredAt}-${index}`}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDateTime(entry.occurredAt)}
                      </td>
                      <td>{entry.action.toLowerCase().replace(/_/g, ' ')}</td>
                      <td style={{ textAlign: 'left' }}>{entry.period ?? 'Whole year'}</td>
                      <td className="faint">
                        {entry.fromStatus && entry.toStatus
                          ? `${entry.fromStatus.toLowerCase()} → ${entry.toStatus.toLowerCase()}`
                          : '—'}
                      </td>
                      <td style={{ textAlign: 'left' }}>{entry.performedBy}</td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {entry.reason ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function BalancesCard({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle: string;
  rows: YearBalance[];
}) {
  return (
    <Card title={title} subtitle={subtitle} padded={false}>
      <div className="table-wrap">
        <table className="data wide">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Account</th>
              <th>Name</th>
              <th style={{ width: 110 }}>Type</th>
              <th className="right" style={{ width: 150 }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.accountNumber}>
                <td className="num" style={{ textAlign: 'left' }}>
                  {row.accountNumber}
                </td>
                <td style={{ textAlign: 'left' }}>{row.accountName}</td>
                <td className="faint">{row.accountType.toLowerCase()}</td>
                <td className="num">{formatNaira(row.balanceKobo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
