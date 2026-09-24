import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Pagination } from '@/components/pagination';
import { IconClipboard } from '@/components/icons';

export const metadata = { title: 'Account detail — BioAssetPro' };

interface DrillThrough {
  accountNumber: string;
  accountName: string;
  page: number;
  pageCount: number;
  total: number;
  lines: Array<{
    journalEntryId: string;
    journalNumber: string;
    journalDate: string;
    narration: string | null;
    sourceModule: string | null;
    costCentre: string | null;
    description: string | null;
    debitKobo: string;
    creditKobo: string;
  }>;
}

const FILTERS = ['financialYearId', 'financialPeriodId', 'branchId', 'costCentreId', 'farmId'];

/**
 * Every posted line behind one trial-balance figure, under the same filters
 * the trial balance was showing — so the lines here add up to the number
 * that was clicked.
 */
export default async function AccountDrillThroughPage({
  params,
  searchParams,
}: {
  params: Promise<{ account: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ account }, filters] = await Promise.all([params, searchParams]);
  const accountNumber = decodeURIComponent(account);

  const query = new URLSearchParams({ accountNumber });
  const back = new URLSearchParams();
  for (const name of FILTERS) {
    const value = filters[name];
    if (value) {
      query.set(name, value);
      back.set(name, value);
    }
  }
  if (filters.page) query.set('page', filters.page);

  let report: DrillThrough | null = null;
  let error: string | null = null;
  try {
    report = await api<DrillThrough>(`/reporting/trial-balance/drill-through?${query}`);
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not open this account.';
  }

  const pageDebit = report?.lines.reduce((sum, line) => sum + toKobo(line.debitKobo), 0n) ?? 0n;
  const pageCredit = report?.lines.reduce((sum, line) => sum + toKobo(line.creditKobo), 0n) ?? 0n;

  return (
    <>
      <PageHeader
        title={report ? `${report.accountNumber} — ${report.accountName}` : accountNumber}
        subtitle="Every posted line behind this balance, newest first"
        actions={
          <Link href={`/ledger/trial-balance${back.size ? `?${back}` : ''}`} className="btn btn-ghost">
            Back to trial balance
          </Link>
        }
      />

      <div className="stack">
        {error ? <div className="notice notice-error">{error}</div> : null}

        {report ? (
          <Card padded={false}>
            {report.lines.length === 0 ? (
              <EmptyState
                icon={<IconClipboard size={22} />}
                title="Nothing posted"
                body="No posted journal lines hit this account under these filters."
              />
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data wide">
                    <thead>
                      <tr>
                        <th style={{ width: 110 }}>Date</th>
                        <th style={{ width: 140 }}>Journal</th>
                        <th>Narration</th>
                        <th style={{ width: 110 }}>Source</th>
                        <th style={{ width: 100 }}>Cost centre</th>
                        <th className="right" style={{ width: 130 }}>Debit</th>
                        <th className="right" style={{ width: 130 }}>Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.lines.map((line, index) => (
                        <tr key={`${line.journalEntryId}-${index}`}>
                          <td className="num" style={{ textAlign: 'left' }}>
                            {formatDate(line.journalDate)}
                          </td>
                          <td className="num" style={{ textAlign: 'left' }}>
                            <Link href={`/ledger/journals?search=${encodeURIComponent(line.journalNumber)}`}>
                              {line.journalNumber}
                            </Link>
                          </td>
                          <td style={{ textAlign: 'left' }}>
                            {line.narration ?? '—'}
                            {line.description && line.description !== line.narration ? (
                              <div className="faint">{line.description}</div>
                            ) : null}
                          </td>
                          <td className="faint">{line.sourceModule?.toLowerCase() ?? '—'}</td>
                          <td className="faint">{line.costCentre ?? '—'}</td>
                          <td className="num">
                            {toKobo(line.debitKobo) > 0n ? formatNaira(line.debitKobo) : ''}
                          </td>
                          <td className="num">
                            {toKobo(line.creditKobo) > 0n ? formatNaira(line.creditKobo) : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5} className="faint" style={{ textAlign: 'left' }}>
                          {report.pageCount > 1 ? 'This page' : 'Total'}
                        </td>
                        <td className="num strong">{formatNaira(pageDebit)}</td>
                        <td className="num strong">{formatNaira(pageCredit)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {report.pageCount > 1 ? (
                  <Pagination
                    page={report.page}
                    pageCount={report.pageCount}
                    total={report.total}
                    noun="line"
                  />
                ) : null}
              </>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
