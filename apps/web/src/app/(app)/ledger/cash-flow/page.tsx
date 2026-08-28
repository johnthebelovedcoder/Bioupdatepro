import { api, ApiError } from '@/lib/api';
import { formatNaira, formatDate } from '@/lib/money';
import { getContext } from '@/lib/org';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { CashFlowFilters } from './filters';

export const metadata = { title: 'Cash flow — BioAssetPro' };

interface CashFlow {
  openingCashKobo: string;
  netIncomeKobo: string;
  depreciationAddBackKobo: string;
  receivablesChangeKobo: string;
  inventoryChangeKobo: string;
  payablesChangeKobo: string;
  netCashFromOperationsKobo: string;
  fixedAssetAcquisitionsKobo: string;
  netCashFromInvestingKobo: string;
  netChangeInCashKobo: string;
  closingCashKobo: string;
  bankAccountClosingKobo: string;
  reconciled: boolean;
}

/**
 * Cash flow, indirect method — the only method the data supports, since
 * nothing is tagged "this moved cash" at the point of posting.
 *
 * One period at a time, defaulting to whichever period covers today. No
 * financing section: nothing in the chart represents a loan or share
 * issuance yet, so it is correctly absent rather than shown as zero.
 */
export default async function CashFlowPage({
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

  const periodId = params.financialPeriodId ?? '';
  const today = new Date().toISOString().slice(0, 10);

  const periods = context.financialYears.flatMap((year) =>
    year.periods.map((period) => ({
      id: period.id,
      label: `${year.code} · ${period.name}`,
      startDate: period.startDate,
      endDate: period.endDate,
    })),
  );

  const selectedPeriod =
    periods.find((period) => period.id === periodId) ??
    periods.find((period) => period.startDate <= today && today <= period.endDate);

  const query = new URLSearchParams();
  if (periodId) query.set('financialPeriodId', periodId);

  let report: CashFlow | null = null;
  let error: string | null = null;
  try {
    const result = await api<CashFlow | { error: string }>(
      `/reporting/cash-flow?${query.toString()}`,
    );
    if ('error' in result) error = result.error;
    else report = result;
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not build the statement.';
  }

  return (
    <div className="stack">
      <PageHeader title="Cash flow" subtitle="Where the cash moved, for one period, indirect method" />

      <Tabs />

      <CashFlowFilters
        periods={periods.map(({ id, label }) => ({ id, label }))}
        selected={periodId}
      />

      {error ? <div className="notice notice-error">{error}</div> : null}

      {report ? (
        <Card
          title={selectedPeriod?.label ?? 'Current period'}
          padded={false}
          action={
            <span className={`badge ${report.reconciled ? 'badge-success' : 'badge-danger'}`}>
              {report.reconciled ? 'Reconciled' : 'NOT RECONCILED'}
            </span>
          }
        >
          <div className="table-wrap">
            <table className="data">
              <tbody>
                <SectionHeader label="Operating activities" />
                <LineRow label="Net income" amountKobo={report.netIncomeKobo} />
                <LineRow label="Add: depreciation" amountKobo={report.depreciationAddBackKobo} />
                <LineRow label="Change in receivables" amountKobo={report.receivablesChangeKobo} />
                <LineRow label="Change in inventory" amountKobo={report.inventoryChangeKobo} />
                <LineRow label="Change in payables" amountKobo={report.payablesChangeKobo} />
                <TotalRow
                  label="Net cash from operating activities"
                  amountKobo={report.netCashFromOperationsKobo}
                  strong
                />

                <SectionHeader label="Investing activities" />
                <LineRow
                  label="Fixed asset acquisitions"
                  amountKobo={report.fixedAssetAcquisitionsKobo}
                />
                <TotalRow
                  label="Net cash from investing activities"
                  amountKobo={report.netCashFromInvestingKobo}
                  strong
                />

                <TotalRow label="Net change in cash" amountKobo={report.netChangeInCashKobo} strong />
                <LineRow label="Opening cash" amountKobo={report.openingCashKobo} />
                <TotalRow label="Closing cash" amountKobo={report.closingCashKobo} strong final />
              </tbody>
            </table>
          </div>
          <div className="card-footer">
            <span className="faint">
              No financing section — nothing in the chart represents a loan or share issuance
              yet. Closing cash reconciles to the Bank account&rsquo;s own trial-balance closing
              figure of {formatNaira(report.bankAccountClosingKobo)}
              {selectedPeriod ? ` as at ${formatDate(selectedPeriod.endDate)}` : ''}.
            </span>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr>
      <td colSpan={2} className="faint" style={{ paddingTop: 'var(--sp-3)' }}>
        {label}
      </td>
    </tr>
  );
}

function LineRow({ label, amountKobo }: { label: string; amountKobo: string }) {
  return (
    <tr>
      <td style={{ paddingLeft: 'var(--sp-4)' }}>{label}</td>
      <td className="num right">{formatNaira(amountKobo)}</td>
    </tr>
  );
}

function TotalRow({
  label,
  amountKobo,
  strong = false,
  final = false,
}: {
  label: string;
  amountKobo: string;
  strong?: boolean;
  final?: boolean;
}) {
  return (
    <tr style={final ? { borderTop: '2px solid var(--border-strong)' } : undefined}>
      <td style={strong ? { fontWeight: 600 } : undefined}>{label}</td>
      <td className="num right" style={strong ? { fontWeight: 600 } : undefined}>
        {formatNaira(amountKobo)}
      </td>
    </tr>
  );
}
