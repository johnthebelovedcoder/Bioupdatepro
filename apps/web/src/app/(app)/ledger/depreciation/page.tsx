import { api, ApiError } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { getContext } from '@/lib/org';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { CashFlowFilters } from '../cash-flow/filters';

export const metadata = { title: 'Depreciation schedule — BioAssetPro' };

interface ScheduleRow {
  assetId: string;
  assetNumber: string;
  name: string;
  assetClass: string;
  acquisitionDate: string;
  usefulLifeMonths: number;
  processingLine: string | null;
  status: string;
  disposedOn: string | null;
  costKobo: string;
  openingAccumulatedKobo: string;
  chargeKobo: string;
  toProfitAndLossKobo: string;
  absorbedKobo: Record<string, string>;
  disposalWriteOffKobo: string;
  closingAccumulatedKobo: string;
  netBookValueKobo: string;
}

interface Schedule {
  financialYear: string;
  throughPeriod: string;
  rows: ScheduleRow[];
  totals: {
    costKobo: string;
    openingAccumulatedKobo: string;
    chargeKobo: string;
    toProfitAndLossKobo: string;
    absorbedKobo: Record<string, string>;
    absorbedTotalKobo: string;
    disposalWriteOffKobo: string;
    closingAccumulatedKobo: string;
    netBookValueKobo: string;
  };
  checks: { chargeVsPostedKobo: string; accumulatedVsLedgerKobo: string; costVsLedgerKobo: string };
  ledger: { ppeKobo: string; accumulatedDepreciationKobo: string };
}

const sum = (values: Record<string, string>) => Object.values(values).reduce((s, v) => s + BigInt(v), 0n).toString();

/**
 * The depreciation schedule (POL-010, AC-MFG-009): each asset's charge for
 * the year to date, split between depreciation expense and the processing
 * lines that absorbed it, and checked against the ledger.
 */
export default async function DepreciationSchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const context = await getContext();
  const periodId = params.financialPeriodId ?? '';
  const periods = context.financialYears.flatMap((year) => year.periods.map((p) => ({ id: p.id, label: `${year.code} · ${p.name}` })));

  let schedule: Schedule | null = null;
  let error: string | null = null;
  try {
    const result = await api<Schedule | { error: string }>(`/reporting/depreciation-schedule${periodId ? `?financialPeriodId=${periodId}` : ''}`);
    if ('error' in result) error = result.error;
    else schedule = result;
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not build the schedule.';
  }
  const lines = schedule ? [...new Set(schedule.rows.flatMap((r) => Object.keys(r.absorbedKobo)))] : [];

  return (
    <div className="stack">
      <PageHeader title="Depreciation schedule" subtitle="Each asset's depreciation for the year, expensed or absorbed, against the ledger" />
      <Tabs />
      <CashFlowFilters periods={periods} selected={periodId} />
      {error ? <div className="notice notice-error">{error}</div> : null}

      {schedule ? (
        <>
          <Card title="Checks" subtitle="Each is zero when the register and the ledger agree (POL-010)">
            <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
              <Check label="Charge less expensed and absorbed" amountKobo={schedule.checks.chargeVsPostedKobo} />
              <Check label="Accumulated depreciation less ledger" amountKobo={schedule.checks.accumulatedVsLedgerKobo} />
              <Check label="Cost in service less ledger" amountKobo={schedule.checks.costVsLedgerKobo} />
            </div>
          </Card>

          <Card title={`${schedule.financialYear} to ${schedule.throughPeriod}`} subtitle={`${schedule.rows.length} asset${schedule.rows.length === 1 ? '' : 's'}`} padded={false}>
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="right">Cost</th>
                    <th className="right">Opening acc.</th>
                    <th className="right">Charge</th>
                    <th className="right">To P&amp;L</th>
                    {lines.map((line) => (
                      <th key={line} className="right">
                        {line}
                      </th>
                    ))}
                    <th className="right">Disposal write-off</th>
                    <th className="right">Closing acc.</th>
                    <th className="right">Net book value</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.rows.length === 0 ? (
                    <tr>
                      <td colSpan={8 + lines.length} className="faint">
                        No fixed assets in service in this year.
                      </td>
                    </tr>
                  ) : (
                    schedule.rows.map((r) => (
                      <tr key={r.assetId}>
                        <td style={{ textAlign: 'left' }}>
                          <strong>{r.assetNumber}</strong> {r.name}
                          <div className="faint" style={{ fontSize: 12 }}>
                            {r.assetClass} · from {r.acquisitionDate} · {r.usefulLifeMonths} months
                            {r.processingLine ? ` · ${r.processingLine}` : ''}
                            {r.status === 'DISPOSED' ? ` · disposed ${r.disposedOn}` : ''}
                          </div>
                        </td>
                        <td className="num right">{formatNaira(r.costKobo)}</td>
                        <td className="num right">{formatNaira(r.openingAccumulatedKobo)}</td>
                        <td className="num right">{formatNaira(r.chargeKobo)}</td>
                        <td className="num right">{formatNaira(r.toProfitAndLossKobo)}</td>
                        {lines.map((line) => (
                          <td key={line} className="num right">
                            {formatNaira(r.absorbedKobo[line] ?? '0')}
                          </td>
                        ))}
                        <td className="num right">{formatNaira(r.disposalWriteOffKobo)}</td>
                        <td className="num right">{formatNaira(r.closingAccumulatedKobo)}</td>
                        <td className="num right">{formatNaira(r.netBookValueKobo)}</td>
                      </tr>
                    ))
                  )}
                  <tr style={{ borderTop: '2px solid var(--border-strong)', fontWeight: 600 }}>
                    <td>Total</td>
                    <td className="num right">{formatNaira(schedule.totals.costKobo)}</td>
                    <td className="num right">{formatNaira(schedule.totals.openingAccumulatedKobo)}</td>
                    <td className="num right">{formatNaira(schedule.totals.chargeKobo)}</td>
                    <td className="num right">{formatNaira(schedule.totals.toProfitAndLossKobo)}</td>
                    {lines.map((line) => (
                      <td key={line} className="num right">
                        {formatNaira(schedule!.totals.absorbedKobo[line] ?? '0')}
                      </td>
                    ))}
                    <td className="num right">{formatNaira(schedule.totals.disposalWriteOffKobo)}</td>
                    <td className="num right">{formatNaira(schedule.totals.closingAccumulatedKobo)}</td>
                    <td className="num right">{formatNaira(schedule.totals.netBookValueKobo)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="card-footer">
              <span className="faint">
                Charge {formatNaira(schedule.totals.chargeKobo)} = expensed {formatNaira(schedule.totals.toProfitAndLossKobo)} + absorbed{' '}
                {formatNaira(sum(schedule.totals.absorbedKobo))}. Ledger: fixed assets {formatNaira(schedule.ledger.ppeKobo)}, accumulated
                depreciation {formatNaira(schedule.ledger.accumulatedDepreciationKobo)}.
              </span>
            </div>
          </Card>
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
