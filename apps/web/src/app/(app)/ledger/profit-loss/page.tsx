import { api, ApiError } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { defaultYear, getContext } from '@/lib/org';
import { TrialBalanceFilters } from '../trial-balance/filters';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Profit & loss — BioAssetPro' };

interface Line {
  accountNumber: string;
  accountName: string;
  amountKobo: string;
}

interface ProfitLoss {
  revenueKobo: string;
  costOfSalesKobo: string;
  grossProfitKobo: string;
  operatingExpenseKobo: string;
  profitBeforeTaxKobo: string;
  revenueLines: Line[];
  costOfSalesLines: Line[];
  operatingExpenseLines: Line[];
}

/**
 * Revenue, cost of sales and operating expense, read from the same posted
 * journal lines the trial balance already proves is balanced.
 *
 * Cost of sales vs. operating expense is a convention this screen states
 * rather than hides: the chart carries no field that marks an expense
 * account either way, so the split follows the two accounts the client's own
 * numbering already singles out for production cost (5001, 5305) — anything
 * else EXPENSE-typed is operating.
 */
export default async function ProfitLossPage({
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

  const query = new URLSearchParams();
  if (year) query.set('financialYearId', year.id);
  if (periodId) query.set('financialPeriodId', periodId);
  if (branchId) query.set('branchId', branchId);
  if (costCentreId) query.set('costCentreId', costCentreId);
  if (farmId) query.set('farmId', farmId);

  let report: ProfitLoss | null = null;
  let error: string | null = null;
  try {
    report = await api<ProfitLoss>(`/reporting/profit-loss?${query.toString()}`);
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not build the statement.';
  }

  return (
    <div className="stack">
      <PageHeader
        title="Profit & loss"
        subtitle="Revenue and expense for the period, from posted journal lines only"
      />

      <Tabs />

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

      {error ? <div className="notice notice-error">{error}</div> : null}

      {report ? (
        <Card
          title={year?.code ?? 'This year'}
          subtitle={periodId ? year?.periods.find((p) => p.id === periodId)?.name : 'Year to date'}
          padded={false}
        >
          <div className="table-wrap">
            <table className="data">
              <tbody>
                <SectionHeader label="Revenue" />
                {report.revenueLines.length === 0 ? (
                  <EmptyLine />
                ) : (
                  report.revenueLines.map((line) => <LineRow key={line.accountNumber} line={line} />)
                )}
                <TotalRow label="Total revenue" amountKobo={report.revenueKobo} />

                <SectionHeader label="Cost of sales" />
                {report.costOfSalesLines.length === 0 ? (
                  <EmptyLine />
                ) : (
                  report.costOfSalesLines.map((line) => (
                    <LineRow key={line.accountNumber} line={line} />
                  ))
                )}
                <TotalRow label="Total cost of sales" amountKobo={report.costOfSalesKobo} />

                <TotalRow label="Gross profit" amountKobo={report.grossProfitKobo} strong />

                <SectionHeader label="Operating expense" />
                {report.operatingExpenseLines.length === 0 ? (
                  <EmptyLine />
                ) : (
                  report.operatingExpenseLines.map((line) => (
                    <LineRow key={line.accountNumber} line={line} />
                  ))
                )}
                <TotalRow label="Total operating expense" amountKobo={report.operatingExpenseKobo} />

                <TotalRow label="Profit before tax" amountKobo={report.profitBeforeTaxKobo} strong final />
              </tbody>
            </table>
          </div>
          <div className="card-footer">
            <span className="faint">
              No tax line — this company&rsquo;s tax rates and treatment have not been configured
              yet, so profit before tax is where this statement stops.
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

function EmptyLine() {
  return (
    <tr>
      <td colSpan={2} className="faint">
        Nothing posted
      </td>
    </tr>
  );
}

function LineRow({ line }: { line: Line }) {
  return (
    <tr>
      <td style={{ paddingLeft: 'var(--sp-4)' }}>
        <span className="faint num">{line.accountNumber}</span> {line.accountName}
      </td>
      <td className="num right">{formatNaira(line.amountKobo)}</td>
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
