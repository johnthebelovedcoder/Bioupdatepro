import { api, ApiError } from '@/lib/api';
import { getContext } from '@/lib/org';
import { formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Hours and pay — BioAssetPro' };

interface Reconciliation {
  period: { id: string; name: string; startDate: string; endDate: string };
  runs: Array<{ reference: string; status: string }>;
  employees: Array<{
    employeeId: string;
    number: string;
    name: string;
    onPostedRun: boolean;
    grossKobo: string;
    employerCostKobo: string;
    approvedHours: string;
    pendingHours: string;
    batchHours: string;
    orderHours: string;
    issue: string | null;
  }>;
  totals: {
    registerCostKobo: string;
    ledgerCostKobo: string;
    allocatedKobo: string;
    unallocatedKobo: string;
    approvedHours: string;
    pendingHours: string;
    hoursAllocated: string | null;
    approvedBatchHours: string;
  };
  checks: {
    registerVsLedgerKobo: string;
    allocatedWithinLedger: boolean;
    pendingHours: string;
    hoursWithoutPay: number;
    hoursAllocatedVsApproved: string | null;
  };
  reconciled: boolean;
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <tr>
      <td style={{ textAlign: 'left' }}>{label}</td>
      <td>
        <span className={`badge ${ok ? 'badge-success' : 'badge-danger'}`}>{ok ? 'agrees' : 'differs'}</span>
      </td>
      <td className="faint">{detail}</td>
    </tr>
  );
}

/**
 * Approved hours reconciled to payroll and to cost-object allocation
 * (AC-HR-002, CLOSE-07). The period does not close until it agrees.
 */
export default async function HoursAndPayPage({ searchParams }: { searchParams: Promise<{ periodId?: string }> }) {
  const { periodId: chosen } = await searchParams;
  const context = await getContext();
  const periods = context.financialYears.flatMap((year) => year.periods.map((p) => ({ ...p, label: `${year.code} · ${p.name}` })));
  const today = new Date().toISOString().slice(0, 10);
  const current = periods.find((p) => String(p.startDate).slice(0, 10) <= today && String(p.endDate).slice(0, 10) >= today);
  const periodId = chosen || current?.id || periods[0]?.id || '';

  let data: Reconciliation | null = null;
  let error: string | null = null;
  if (periodId) {
    try {
      data = await api<Reconciliation>(`/cost-allocation/labour-reconciliation?periodId=${periodId}`);
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : 'Could not build the reconciliation.';
    }
  }

  return (
    <>
      <PageHeader title="Hours and pay" subtitle="Approved hours against the payroll run, and payroll cost against what was charged to batches" />
      <Tabs />
      <div className="stack">
        <form className="row" style={{ gap: 'var(--sp-2)', alignItems: 'end', flexWrap: 'wrap' }}>
          <label className="field" style={{ margin: 0, minWidth: 240 }}>
            Period
            <select name="periodId" defaultValue={periodId}>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn">
            Show
          </button>
        </form>
        {error ? <div className="notice notice-error">{error}</div> : null}
        {data ? (
          <>
            <div className={`notice ${data.reconciled ? 'notice-success' : 'notice-warning'}`}>
              {data.reconciled
                ? `${data.period.name} reconciles. The period can close on this check.`
                : `${data.period.name} does not reconcile yet; the period cannot close until it does.`}
            </div>
            <Card title="Checks" padded={false}>
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    <Check
                      ok={data.checks.registerVsLedgerKobo === '0'}
                      label="Payroll register = payroll posted"
                      detail={`Register ${formatNaira(data.totals.registerCostKobo)}, ledger ${formatNaira(data.totals.ledgerCostKobo)}${
                        data.runs.length ? ` (${data.runs.map((r) => `${r.reference} ${r.status.toLowerCase()}`).join(', ')})` : ' — no run for the period'
                      }`}
                    />
                    <Check
                      ok={data.checks.allocatedWithinLedger}
                      label="Allocated to batches ≤ payroll posted"
                      detail={`${formatNaira(data.totals.allocatedKobo)} allocated, ${formatNaira(data.totals.unallocatedKobo)} left as overhead`}
                    />
                    <Check ok={data.checks.pendingHours === '0.00'} label="No hours waiting for approval" detail={`${data.checks.pendingHours} hours pending`} />
                    <Check
                      ok={data.checks.hoursWithoutPay === 0}
                      label="Everyone with approved hours was paid"
                      detail={`${data.checks.hoursWithoutPay} ${data.checks.hoursWithoutPay === 1 ? 'person' : 'people'} with hours but no posted pay`}
                    />
                    {data.checks.hoursAllocatedVsApproved !== null ? (
                      <Check
                        ok={Math.abs(Number(data.checks.hoursAllocatedVsApproved)) <= 0.01}
                        label="Hours allocated = approved batch hours"
                        detail={`${data.totals.hoursAllocated} allocated, ${data.totals.approvedBatchHours} approved`}
                      />
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="By person" padded={false}>
              <div className="table-wrap">
                <table className="data wide">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th className="right">Gross</th>
                      <th className="right">Employer cost</th>
                      <th className="right">Approved h</th>
                      <th className="right">On batches</th>
                      <th className="right">On orders</th>
                      <th className="right">Pending h</th>
                      <th>Issue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.employees.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="faint">
                          No pay or hours in this period.
                        </td>
                      </tr>
                    ) : (
                      data.employees.map((e) => (
                        <tr key={e.employeeId}>
                          <td style={{ textAlign: 'left' }}>
                            {e.name} <span className="faint">{e.number}</span>
                          </td>
                          <td className="num right">{e.onPostedRun ? formatNaira(e.grossKobo) : '—'}</td>
                          <td className="num right">{e.onPostedRun ? formatNaira(e.employerCostKobo) : '—'}</td>
                          <td className="num right">{e.approvedHours}</td>
                          <td className="num right">{e.batchHours}</td>
                          <td className="num right">{e.orderHours}</td>
                          <td className="num right">{e.pendingHours}</td>
                          <td>{e.issue ? <span className="badge badge-warning">{e.issue}</span> : null}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
