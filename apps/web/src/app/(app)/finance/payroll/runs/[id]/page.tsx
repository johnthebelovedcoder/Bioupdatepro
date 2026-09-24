import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getBankSchedule,
  getOutstanding,
  getPayeByState,
  getPayrollRuns,
  validatePayrollRun,
} from '@/lib/payroll-runs';
import { getGlAccounts } from '@/lib/trade';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { PayrollPaymentForm } from '@/components/payroll-payment-form';
import { SubmitPayrollRunButton } from '@/components/submit-payroll-run-button';

export const metadata = { title: 'Payroll run — BioAssetPro' };

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * One month's payroll, end to end: who is blocked from it, what each person
 * is paid and into which account, PAYE owed to each state, and — once posted
 * — the six payables it accrued and how much of each has been paid.
 */
export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runs = await getPayrollRuns();
  const run = runs.find((row) => row.id === id);
  if (!run) notFound();

  const calculated = run.status !== 'DRAFT';
  const posted = run.status === 'POSTED';

  const [validation, schedule, byState, outstanding, accounts] = await Promise.all([
    posted ? Promise.resolve(null) : validatePayrollRun(id),
    calculated ? getBankSchedule(id) : Promise.resolve([]),
    calculated ? getPayeByState(id) : Promise.resolve([]),
    posted ? getOutstanding(id) : Promise.resolve([]),
    posted ? getGlAccounts().catch(() => []) : Promise.resolve([]),
  ]);

  // Bank and cash live among the assets; offering the whole chart to a
  // "paid from" picker invites paying salaries out of an expense account.
  const bankAccounts = accounts.filter((account) => account.accountType === 'ASSET');
  const today = new Date().toISOString().slice(0, 10);
  const missingBank = schedule.filter((line) => !line.accountNumber);
  const totalOutstanding = outstanding.reduce((sum, b) => sum + toKobo(b.outstandingKobo), 0n);

  return (
    <>
      <PageHeader
        title={`${run.reference} — ${MONTH_NAMES[run.month - 1]} ${run.year}`}
        subtitle={
          run.pendingTransactionId
            ? 'Waiting for approval'
            : posted
              ? `Posted ${formatDate(run.postedAt)}`
              : run.status.toLowerCase().replace(/_/g, ' ')
        }
        actions={
          <Link href="/finance/payroll/runs" className="btn btn-ghost">
            Back to runs
          </Link>
        }
      />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Employees" value={String(run.employeeCount)} />
          <Stat label="Gross" value={formatNaira(run.totalGrossKobo)} money />
          <Stat label="Net pay" value={formatNaira(run.totalNetPayKobo)} money />
          {posted ? (
            <Stat label="Still to pay" value={formatNaira(totalOutstanding)} money />
          ) : null}
        </div>

        {validation ? (
          <Card
            title="Readiness"
            subtitle={
              validation.ready
                ? `All ${validation.eligible} eligible employee${validation.eligible === 1 ? '' : 's'} can be paid`
                : validation.eligible + validation.blocked.length === 0
                  ? 'Nobody is on payroll yet'
                  : `${validation.blocked.length} employee${validation.blocked.length === 1 ? '' : 's'} blocked`
            }
          >
            {validation.blocked.length === 0 ? (
              validation.eligible === 0 ? (
                <p className="faint">
                  Activate employees for payroll under{' '}
                  <Link href="/staff/employees">People → Employees</Link> first.
                </p>
              ) : (
                <p className="faint">Nothing is stopping this run.</p>
              )
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Employee</th>
                      <th>What is missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.blocked.map((row) => (
                      <tr key={row.employeeNumber}>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {row.employeeNumber}
                        </td>
                        <td style={{ textAlign: 'left' }}>{row.blockers.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {run.status === 'CALCULATED' && !run.pendingTransactionId ? (
              <div style={{ marginTop: 'var(--sp-4)' }}>
                <SubmitPayrollRunButton runId={run.id} />
              </div>
            ) : null}
          </Card>
        ) : null}

        {posted ? (
          <Card
            title="Payables"
            subtitle="What this run accrued, and how much of it has been paid"
            action={
              <PayrollPaymentForm
                runId={run.id}
                runReference={run.reference}
                buckets={outstanding}
                bankAccounts={bankAccounts}
                today={today}
              />
            }
            padded={false}
          >
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Payable</th>
                    <th className="right" style={{ width: 140 }}>Accrued</th>
                    <th className="right" style={{ width: 140 }}>Paid</th>
                    <th className="right" style={{ width: 140 }}>Outstanding</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((bucket) => (
                    <tr key={bucket.bucket}>
                      <td style={{ textAlign: 'left' }}>{bucket.label}</td>
                      <td className="num">{formatNaira(bucket.totalKobo)}</td>
                      <td className="num">{formatNaira(bucket.settledKobo)}</td>
                      <td className="num strong">{formatNaira(bucket.outstandingKobo)}</td>
                      <td>
                        {toKobo(bucket.outstandingKobo) > 0n ? (
                          <PayrollPaymentForm
                            runId={run.id}
                            runReference={run.reference}
                            buckets={outstanding}
                            bankAccounts={bankAccounts}
                            today={today}
                            initialBucket={bucket.bucket}
                          />
                        ) : (
                          <span className="badge badge-success">paid</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {byState.length > 0 ? (
          <Card
            title="PAYE by state"
            subtitle="PAYE is remitted to each employee's state of residence, not the farm's"
            padded={false}
          >
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>State</th>
                    <th className="right" style={{ width: 110 }}>Employees</th>
                    <th className="right" style={{ width: 150 }}>This month</th>
                  </tr>
                </thead>
                <tbody>
                  {byState.map((row) => (
                    <tr key={row.taxState}>
                      <td style={{ textAlign: 'left' }}>
                        {row.taxState === 'UNASSIGNED' ? (
                          <span className="badge badge-warning">no tax state recorded</span>
                        ) : (
                          row.taxState.replace(/_/g, ' ')
                        )}
                      </td>
                      <td className="num">{row.employeeCount}</td>
                      <td className="num">{formatNaira(row.monthlyPayeKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {schedule.length > 0 ? (
          <Card
            title="Bank schedule"
            subtitle="Who is paid what, and into which account — the list to hand the bank"
            padded={false}
          >
            {missingBank.length > 0 ? (
              <div className="notice notice-warning" style={{ margin: 'var(--sp-4)' }}>
                {missingBank.length} employee{missingBank.length === 1 ? ' has' : 's have'} no bank
                account recorded and cannot be paid by transfer.
              </div>
            ) : null}
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Employee</th>
                    <th>Name</th>
                    <th>Bank</th>
                    <th style={{ width: 130 }}>Account</th>
                    <th>Account name</th>
                    <th className="right" style={{ width: 140 }}>Net pay</th>
                    <th style={{ width: 90 }} />
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((line) => (
                    <tr key={line.employeeId}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {line.employeeNumber}
                      </td>
                      <td style={{ textAlign: 'left' }}>{line.name}</td>
                      <td style={{ textAlign: 'left' }}>{line.bankName ?? '—'}</td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {line.accountNumber ?? '—'}
                      </td>
                      <td style={{ textAlign: 'left' }}>{line.accountName ?? '—'}</td>
                      <td className="num">{formatNaira(line.netPayKobo)}</td>
                      <td>
                        <Link href={`/finance/payroll/runs/${run.id}/payslip/${line.employeeId}`}>
                          Payslip
                        </Link>
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
