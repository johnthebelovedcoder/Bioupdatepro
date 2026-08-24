import { api } from '@/lib/api';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { defaultYear, getContext } from '@/lib/org';
import { Pagination } from '@/components/pagination';
import { JournalFilters } from './filters';
import { PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Journal entries — BioAssetPro' };

interface Line {
  lineNumber: number;
  accountNumber: string;
  accountName: string;
  costCentre: string | null;
  description: string;
  debitKobo: string;
  creditKobo: string;
}

interface Entry {
  id: string;
  journalNumber: string;
  journalDate: string;
  narration: string;
  status: string;
  sourceModule: string;
  sourceDocumentType: string;
  reversalOfId: string | null;
  period: string | null;
  createdBy: string | null;
  postedBy: string | null;
  postedAt: string | null;
  totalDebitKobo: string;
  totalCreditKobo: string;
  lines: Line[];
}

export default async function JournalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const context = await getContext();

  if (!context.company) {
    return <div className="notice notice-warning">No company has been set up yet.</div>;
  }

  const year =
    context.financialYears.find((candidate) => candidate.id === params.financialYearId) ??
    defaultYear(context);

  // No companyId: the API resolves it from the signed-in user.
  const query = new URLSearchParams();
  if (year) query.set('financialYearId', year.id);
  if (params.financialPeriodId) query.set('financialPeriodId', params.financialPeriodId);
  if (params.status) query.set('status', params.status);
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', params.page);

  const result = await api<{
    total: number;
    page: number;
    pageCount: number;
    entries: Entry[];
  }>(`/reporting/journals?${query.toString()}`);

  return (
    <div className="stack">
      <PageHeader
        title="Journal entries"
        subtitle="Every posting in the ledger, whichever module raised it. Posted entries cannot be edited or deleted — a correction is a reversal."
      />

      <Tabs />

      <JournalFilters
        years={context.financialYears}
        selected={{
          financialYearId: year?.id ?? '',
          financialPeriodId: params.financialPeriodId ?? '',
          status: params.status ?? '',
          search: params.search ?? '',
        }}
      />

      <div className="card">
        {result.entries.length === 0 ? (
          <div className="card-body muted">No journal entries match this selection.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>Journal</th>
                    <th style={{ width: 100 }}>Date</th>
                    <th>Narration</th>
                    <th style={{ width: 120 }}>Source</th>
                    <th className="right" style={{ width: 130 }}>
                      Amount
                    </th>
                    <th style={{ width: 90 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.entries.map((entry) => (
                    <JournalRow key={entry.id} entry={entry} />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={result.page}
              pageCount={result.pageCount}
              total={result.total}
              noun="entry"
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The header row expands to its lines. A journal is only meaningful with both
 * sides visible, so the lines are rendered inline rather than behind a click
 * through to another page.
 */
function JournalRow({ entry }: { entry: Entry }) {
  const balanced = toKobo(entry.totalDebitKobo) === toKobo(entry.totalCreditKobo);

  return (
    <>
      <tr>
        <td className="num" style={{ textAlign: 'left', fontWeight: 600 }}>
          {entry.journalNumber}
        </td>
        <td>{formatDate(entry.journalDate)}</td>
        <td>
          {entry.narration}
          {entry.reversalOfId ? (
            <span className="badge badge-warning" style={{ marginLeft: 6 }}>
              reversal
            </span>
          ) : null}
          <div className="faint">
            {entry.period ?? '—'} · raised by {entry.createdBy ?? '—'}
            {entry.postedBy ? ` · posted by ${entry.postedBy}` : ''}
          </div>
        </td>
        <td className="faint">
          {entry.sourceModule}
          <div>{entry.sourceDocumentType}</div>
        </td>
        <td className="num">
          {formatNaira(entry.totalDebitKobo)}
          {!balanced ? (
            <div style={{ color: 'var(--danger)', fontSize: 11 }}>unbalanced</div>
          ) : null}
        </td>
        <td>
          <span
            className={`badge ${
              entry.status === 'POSTED'
                ? 'badge-success'
                : entry.status === 'DRAFT'
                  ? 'badge-warning'
                  : 'badge-danger'
            }`}
          >
            {entry.status.toLowerCase()}
          </span>
        </td>
      </tr>
      <tr>
        <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid var(--border)' }}>
          <table className="data" style={{ background: 'var(--surface-sunken)' }}>
            <tbody>
              {entry.lines.map((line) => (
                <tr key={line.lineNumber}>
                  <td style={{ width: 130, paddingLeft: 34 }} className="faint">
                    {line.lineNumber}
                  </td>
                  <td style={{ width: 90 }} className="num">
                    {line.accountNumber}
                  </td>
                  <td>
                    {line.accountName}
                    <span className="faint"> · {line.description}</span>
                  </td>
                  <td style={{ width: 90 }} className="faint">
                    {line.costCentre ?? ''}
                  </td>
                  <td className="num num-debit" style={{ width: 130 }}>
                    {toKobo(line.debitKobo) === 0n
                      ? ''
                      : formatNaira(line.debitKobo, { symbol: false })}
                  </td>
                  <td className="num num-credit" style={{ width: 130 }}>
                    {toKobo(line.creditKobo) === 0n
                      ? ''
                      : formatNaira(line.creditKobo, { symbol: false })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </td>
      </tr>
    </>
  );
}
