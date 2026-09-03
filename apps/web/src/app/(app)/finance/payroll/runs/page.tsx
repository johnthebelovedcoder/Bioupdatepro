import Link from 'next/link';
import { getPayrollRuns } from '@/lib/payroll-runs';
import { getContext, defaultYear } from '@/lib/org';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconTag } from '@/components/icons';
import { CreatePayrollRunForm } from '@/components/create-payroll-run-form';
import { SubmitPayrollRunButton } from '@/components/submit-payroll-run-button';
import { TableSearch } from '@/components/table-search';

export const metadata = { title: 'Payroll runs — BioAssetPro' };

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * One run per company per month (§7's own rule) — create, calculate,
 * submit for approval, then watch it post once approved. US-897-024's
 * posting side has existed for a while; this is the missing web door to it.
 */
export default async function PayrollRunsPage() {
  const [runs, context] = await Promise.all([getPayrollRuns(), getContext()]);
  const year = defaultYear(context);
  const periods = (year?.periods ?? []).map((p) => ({ id: p.id, name: p.name }));

  const awaiting = runs.filter((run) => run.pendingTransactionId);

  return (
    <div className="stack">
      <PageHeader title="Payroll runs" subtitle="Calculate, approve and post one month's payroll" />

      <Tabs />

      {awaiting.length > 0 ? (
        <div className="notice notice-warning">
          {awaiting.length} run{awaiting.length === 1 ? '' : 's'} waiting for approval. Nothing
          has posted for {awaiting.length === 1 ? 'it' : 'them'} yet —{' '}
          <Link href="/approvals">the approvals queue</Link> is where that happens.
        </div>
      ) : null}

      <TableSearch
        placeholder="Search runs"
        actions={<CreatePayrollRunForm periods={periods} />}
      >
        <Card title="Runs" padded={false}>
          {runs.length === 0 ? (
            <EmptyState
              icon={<IconTag size={22} />}
              title="No payroll run yet"
              body="Run payroll above to calculate the first one."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>Reference</th>
                    <th>Period</th>
                    <th className="right" style={{ width: 90 }}>
                      Employees
                    </th>
                    <th className="right" style={{ width: 130 }}>
                      Gross
                    </th>
                    <th className="right" style={{ width: 130 }}>
                      Net pay
                    </th>
                    <th style={{ width: 140 }}>Status</th>
                    <th style={{ width: 160 }} />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {run.reference}
                      </td>
                      <td>
                        {MONTH_NAMES[run.month - 1]} {run.year}
                        {run.calculatedAt ? (
                          <div className="faint">calculated {formatDate(run.calculatedAt)}</div>
                        ) : null}
                      </td>
                      <td className="num">{run.employeeCount}</td>
                      <td className="num">{formatNaira(run.totalGrossKobo)}</td>
                      <td className="num">{formatNaira(run.totalNetPayKobo)}</td>
                      <td>
                        {run.pendingTransactionId ? (
                          <span className="badge badge-warning">awaiting approval</span>
                        ) : run.status === 'POSTED' ? (
                          <span className="badge badge-success">posted</span>
                        ) : (
                          <span className="badge">{run.status.toLowerCase().replace('_', ' ')}</span>
                        )}
                      </td>
                      <td>
                        {run.status === 'CALCULATED' && !run.pendingTransactionId ? (
                          <SubmitPayrollRunButton runId={run.id} />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </TableSearch>

      <Card>
        <p className="muted" style={{ fontSize: 14 }}>
          Calculating a run computes PAYE, pension, NHF, NSITF and ITF against the rates in
          force as at that period. Approving it posts one balanced journal — gross and
          statutory expense debited, six payable accounts credited — the same accrual
          Payroll Payment (US-897-024) later clears.
        </p>
      </Card>
    </div>
  );
}
