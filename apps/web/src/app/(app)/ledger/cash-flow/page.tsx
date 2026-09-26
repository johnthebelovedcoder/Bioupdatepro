import { api, ApiError } from '@/lib/api';
import { formatNaira, formatDate } from '@/lib/money';
import { getContext } from '@/lib/org';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { CashFlowFilters } from './filters';
import { ExportLink } from '@/components/export-link';

export const metadata = { title: 'Cash flow — BioAssetPro' };

interface CashFlow {
  openingCashKobo: string;
  netIncomeKobo: string;
  depreciationAddBackKobo: string;
  /** IAS 41: the fair-value gain (negative) or loss (positive) on biological assets, which is not cash. */
  fairValueAdjustmentKobo?: string;
  receivablesChangeKobo: string;
  inventoryChangeKobo: string;
  payablesChangeKobo: string;
  netCashFromOperationsKobo: string;
  fixedAssetAcquisitionsKobo: string;
  netCashFromInvestingKobo: string;
  netCashFromFinancingKobo?: string;
  netChangeInCashKobo: string;
  closingCashKobo: string;
  bankAccountClosingKobo: string;
  reconciled: boolean;
  direct?: {
    customerReceiptsKobo: string;
    supplierPaymentsKobo: string;
    employeePaymentsKobo: string;
    taxesPaidKobo: string;
    otherOperatingKobo: string;
    netCashFromOperationsKobo: string;
    investingKobo: string;
    financingKobo: string;
    netChangeInCashKobo: string;
    openingCashKobo: string;
    closingCashKobo: string;
    journals: number;
  };
  checks?: { directKobo: string; indirectKobo: string; directVsIndirectOperatingKobo: string };
}

/**
 * Cash flow, both methods side by side (500_Cash_Flow, AC-ENT-001): direct —
 * the bank's own movements, classified by what they paid for — and indirect —
 * profit adjusted for what was not cash. Both must reach the bank's closing
 * balance, and their operating cash must agree.
 *
 * One period at a time, defaulting to whichever period covers today.
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
      <PageHeader
        title="Cash flow"
        subtitle="Where the cash moved, for one period, by the direct and indirect methods"
        actions={<ExportLink report="cash-flow" filters={Object.fromEntries(query)} />}
      />

      <Tabs />

      <CashFlowFilters
        periods={periods.map(({ id, label }) => ({ id, label }))}
        selected={periodId}
      />

      {error ? <div className="notice notice-error">{error}</div> : null}

      {report ? (
        <>
          {report.checks ? (
            <Card title="Checks" subtitle="Each is zero when the statements agree with each other and with the bank">
              <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                <Check label="Direct closing cash less bank" amountKobo={report.checks.directKobo} />
                <Check label="Indirect closing cash less bank" amountKobo={report.checks.indirectKobo} />
                <Check label="Direct less indirect operating cash" amountKobo={report.checks.directVsIndirectOperatingKobo} />
              </div>
            </Card>
          ) : null}

          <div className="grid-auto" style={{ alignItems: 'start' }}>
            {report.direct ? (
              <Card title="Direct method" subtitle={`${selectedPeriod?.label ?? 'Current period'} · ${report.direct.journals} bank movements`} padded={false}>
                <div className="table-wrap">
                  <table className="data">
                    <tbody>
                      <SectionHeader label="Operating activities" />
                      <LineRow label="Received from customers" amountKobo={report.direct.customerReceiptsKobo} />
                      <LineRow label="Paid to suppliers" amountKobo={report.direct.supplierPaymentsKobo} />
                      <LineRow label="Paid to and for employees" amountKobo={report.direct.employeePaymentsKobo} />
                      <LineRow label="Taxes paid" amountKobo={report.direct.taxesPaidKobo} />
                      {report.direct.otherOperatingKobo !== '0' ? <LineRow label="Other operating" amountKobo={report.direct.otherOperatingKobo} /> : null}
                      <TotalRow label="Net cash from operating activities" amountKobo={report.direct.netCashFromOperationsKobo} strong />
                      <SectionHeader label="Investing activities" />
                      <TotalRow label="Net cash from investing activities" amountKobo={report.direct.investingKobo} strong />
                      <SectionHeader label="Financing activities" />
                      <TotalRow label="Net cash from financing activities" amountKobo={report.direct.financingKobo} strong />
                      <TotalRow label="Net change in cash" amountKobo={report.direct.netChangeInCashKobo} strong />
                      <LineRow label="Opening cash" amountKobo={report.direct.openingCashKobo} />
                      <TotalRow label="Closing cash" amountKobo={report.direct.closingCashKobo} strong final />
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}

            <Card
              title="Indirect method"
              subtitle={selectedPeriod?.label ?? 'Current period'}
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
                    <LineRow label="Profit after tax" amountKobo={report.netIncomeKobo} />
                    <LineRow label="Add: depreciation" amountKobo={report.depreciationAddBackKobo} />
                    {report.fairValueAdjustmentKobo !== undefined ? (
                      <LineRow label="Fair-value (gain)/loss on biological assets" amountKobo={report.fairValueAdjustmentKobo} />
                    ) : null}
                    <LineRow label="Change in receivables" amountKobo={report.receivablesChangeKobo} />
                    <LineRow label="Change in inventory and biological assets" amountKobo={report.inventoryChangeKobo} />
                    <LineRow label="Change in payables" amountKobo={report.payablesChangeKobo} />
                    <TotalRow label="Net cash from operating activities" amountKobo={report.netCashFromOperationsKobo} strong />
                    <SectionHeader label="Investing activities" />
                    <LineRow label="Fixed asset acquisitions" amountKobo={report.fixedAssetAcquisitionsKobo} />
                    <TotalRow label="Net cash from investing activities" amountKobo={report.netCashFromInvestingKobo} strong />
                    <SectionHeader label="Financing activities" />
                    <TotalRow label="Net cash from financing activities" amountKobo={report.netCashFromFinancingKobo ?? '0'} strong />
                    <TotalRow label="Net change in cash" amountKobo={report.netChangeInCashKobo} strong />
                    <LineRow label="Opening cash" amountKobo={report.openingCashKobo} />
                    <TotalRow label="Closing cash" amountKobo={report.closingCashKobo} strong final />
                  </tbody>
                </table>
              </div>
              <div className="card-footer">
                <span className="faint">
                  The bank&rsquo;s own closing balance: {formatNaira(report.bankAccountClosingKobo)}
                  {selectedPeriod ? ` as at ${formatDate(selectedPeriod.endDate)}` : ''}. Financing is the same under both methods.
                </span>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Check({ label, amountKobo }: { label: string; amountKobo: string }) {
  const ok = amountKobo === '0';
  return (
    <div className="stack" style={{ gap: 2, minWidth: 200 }}>
      <span className="faint" style={{ fontSize: 13 }}>{label}</span>
      <span className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
        <strong className="num">{formatNaira(amountKobo)}</strong>
        <span className={`badge ${ok ? 'badge-success' : 'badge-danger'}`}>{ok ? 'agrees' : 'differs'}</span>
      </span>
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
