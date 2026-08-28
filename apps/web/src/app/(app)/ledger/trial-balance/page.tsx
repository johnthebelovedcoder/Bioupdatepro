import { api, ApiError } from '@/lib/api';
import { formatNaira, toKobo } from '@/lib/money';
import { defaultYear, getContext } from '@/lib/org';
import { TrialBalanceFilters } from './filters';
import { PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { TableSearch } from '@/components/table-search';

export const metadata = { title: 'Trial balance — BioAssetPro' };

interface Row {
  glAccountId: string;
  accountNumber: string;
  accountName: string;
  accountType: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  totalDebitKobo: string;
  totalCreditKobo: string;
  netKobo: string;
  displayedBalanceKobo: string;
}

interface TrialBalance {
  rows: Row[];
  totalDebitKobo: string;
  totalCreditKobo: string;
  balanced: boolean;
}

const TYPE_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const context = await getContext();

  if (!context.company) {
    return (
      <div className="notice notice-warning">
        No company has been set up yet. Run <code>npm run db:seed</code> first.
      </div>
    );
  }

  const year =
    context.financialYears.find((candidate) => candidate.id === params.financialYearId) ??
    defaultYear(context);
  const periodId = params.financialPeriodId ?? '';
  const branchId = params.branchId ?? '';
  const costCentreId = params.costCentreId ?? '';
  const farmId = params.farmId ?? '';

  const dimensions = await api<{
    costCentres: Array<{ id: string; code: string; name: string }>;
    farms: Array<{ id: string; code: string; name: string }>;
  }>('/reporting/dimensions');

  // No companyId here or below: the API resolves it from the signed-in user,
  // so a company the client is not entitled to cannot be asked for.
  const query = new URLSearchParams();
  if (year) query.set('financialYearId', year.id);
  if (periodId) query.set('financialPeriodId', periodId);
  if (branchId) query.set('branchId', branchId);
  if (costCentreId) query.set('costCentreId', costCentreId);
  if (farmId) query.set('farmId', farmId);

  let report: TrialBalance | null = null;
  let error: string | null = null;
  try {
    report = await api<TrialBalance>(`/reporting/trial-balance?${query.toString()}`);
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not build the trial balance.';
  }

  const rows = [...(report?.rows ?? [])].sort((a, b) => {
    const byType = TYPE_ORDER.indexOf(a.accountType) - TYPE_ORDER.indexOf(b.accountType);
    return byType !== 0 ? byType : a.accountNumber.localeCompare(b.accountNumber);
  });

  return (
    <div className="stack">
      <PageHeader
        title="Trial balance"
        subtitle="Posted journal lines only. Drafts are not accounting records."
      />

      <Tabs />

      {error ? <div className="notice notice-error">{error}</div> : null}

      {report ? (
        <TableSearch
          placeholder="Search accounts"
          filter={
            <TrialBalanceFilters
              years={context.financialYears}
              branches={context.branches}
              costCentres={dimensions.costCentres}
              farms={dimensions.farms}
              selected={{
                financialYearId: year?.id ?? '',
                financialPeriodId: periodId,
                branchId,
                costCentreId,
                farmId,
              }}
            />
          }
        >
        <div className="card">
          <div className="card-header">
            <h2>
              {year?.code ?? 'All years'}
              {periodId
                ? ` · ${year?.periods.find((p) => p.id === periodId)?.name ?? 'Period'}`
                : ''}
            </h2>
            <span className={`badge ${report.balanced ? 'badge-success' : 'badge-danger'}`}>
              {report.balanced ? 'Debits equal credits' : 'OUT OF BALANCE'}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="card-body muted">
              Nothing has been posted to this selection yet.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Account</th>
                    <th>Name</th>
                    <th style={{ width: 100 }}>Type</th>
                    <th className="right" style={{ width: 150 }}>
                      Debit
                    </th>
                    <th className="right" style={{ width: 150 }}>
                      Credit
                    </th>
                    <th className="right" style={{ width: 160 }}>
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.glAccountId}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {row.accountNumber}
                      </td>
                      <td>{row.accountName}</td>
                      <td className="faint">{row.accountType.toLowerCase()}</td>
                      <td className="num num-debit">
                        <Amount value={row.totalDebitKobo} />
                      </td>
                      <td className="num num-credit">
                        <Amount value={row.totalCreditKobo} />
                      </td>
                      <td className="num">
                        <Balance netKobo={row.netKobo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total</td>
                    <td className="num num-debit">{formatNaira(report.totalDebitKobo)}</td>
                    <td className="num num-credit">{formatNaira(report.totalCreditKobo)}</td>
                    <td className="num">
                      {report.balanced ? (
                        <span style={{ color: 'var(--success)' }}>Balanced</span>
                      ) : (
                        <span style={{ color: 'var(--danger)' }}>
                          {formatNaira(
                            (
                              toKobo(report.totalDebitKobo) - toKobo(report.totalCreditKobo)
                            ).toString(),
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        </TableSearch>
      ) : null}
    </div>
  );
}

/**
 * A balance, stated with the side it actually sits on.
 *
 * `netKobo` is debit-positive, so its sign IS the side — which is what a reader
 * needs. Showing the signed "displayed balance" instead would put a debit-normal
 * account carrying a credit balance in parentheses and then label it "Dr",
 * which says two contradictory things at once.
 */
function Balance({ netKobo }: { netKobo: string }) {
  const net = toKobo(netKobo);
  if (net === 0n) return <span className="num-zero">—</span>;

  const debit = net > 0n;
  return (
    <>
      {formatNaira(debit ? net : -net, { symbol: false })}
      <span className={debit ? 'num-debit' : 'num-credit'} style={{ marginLeft: 6 }}>
        {debit ? 'Dr' : 'Cr'}
      </span>
    </>
  );
}

/** Zero reads as a dash: a column of 0.00 hides the figures that matter. */
function Amount({ value }: { value: string }) {
  return toKobo(value) === 0n ? (
    <span className="num-zero">—</span>
  ) : (
    <>{formatNaira(value, { symbol: false })}</>
  );
}
