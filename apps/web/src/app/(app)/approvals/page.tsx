import Link from 'next/link';
import { getPendingApprovals } from '@/lib/procurement';
import { getWorkflowDashboard } from '@/lib/workflow';
import { formatNaira } from '@/lib/money';
import { describeTransaction, waitedFor } from '@/lib/workflow-labels';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { DecideButtons } from '@/components/approve-button';
import { EscalationSweepButton } from '@/components/escalation-sweep-button';
import { IconCheckCircle } from '@/components/icons';

export const metadata = { title: 'Approvals — BioAssetPro' };

/**
 * What is waiting on you.
 *
 * Personal by construction: the API reads the user from the session and will
 * not serve anybody else's queue, because an approval list is a list of what
 * one person is able to authorise and what it is worth.
 *
 * This is also where several chains finally complete. A goods receipt does not
 * post when it is recorded — it posts when somebody other than the person who
 * recorded it confirms it here. That separation is the whole of maker-checker,
 * and without a screen it was a rule the product enforced and nobody could
 * satisfy.
 */
export default async function ApprovalsPage() {
  const [pending, dashboard] = await Promise.all([
    getPendingApprovals(),
    getWorkflowDashboard(),
  ]);

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Documents waiting on you, and what approving each one will do"
        actions={<EscalationSweepButton />}
      />

      <div className="stack">
        {dashboard ? (
          <div className="stat-grid">
            <Stat label="Waiting company-wide" value={String(dashboard.open.count)} />
            <Stat
              label="Escalated"
              value={String(dashboard.open.escalated)}
              goodWhen="down"
            />
            <Stat
              label="Oldest waiting"
              value={
                dashboard.open.oldestHours >= 48
                  ? `${Math.floor(dashboard.open.oldestHours / 24)} days`
                  : `${dashboard.open.oldestHours} hours`
              }
              goodWhen="down"
            />
          </div>
        ) : null}

        <Card title={`${pending.length} waiting`} padded={false}>
          {pending.length === 0 ? (
            <EmptyState
              icon={<IconCheckCircle size={22} />}
              title="Nothing is waiting on you"
              body="Documents appear here when they reach a step your role can approve. You will never see one you raised yourself — nobody approves their own work."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Document</th>
                    <th style={{ width: 200 }}>What it is</th>
                    <th className="right" style={{ width: 140 }}>
                      Value
                    </th>
                    <th style={{ width: 140 }}>Waiting since</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((item) => (
                    <tr key={item.transactionId}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        <Link href={`/approvals/history/${item.transactionId}`} title="Approval trail">
                          {item.documentReference}
                        </Link>
                        {item.escalated ? (
                          <div>
                            <span className="badge badge-danger">escalated</span>
                          </div>
                        ) : null}
                        {item.selfApproval ? (
                          <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                            <span className="badge badge-warning">your own</span> Nobody else here can
                            approve it, so you may — it is recorded as self-approved.
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {describeTransaction(item.transactionType)}
                        <div className="faint">{item.route}</div>
                      </td>
                      <td className="num">{formatNaira(item.amountKobo)}</td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {waitedFor(item.waitingSince)}
                      </td>
                      <td className="actions">
                        <DecideButtons transactionId={item.transactionId} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            Approving is not a formality — for several of these it is the moment the ledger
            moves. A goods receipt posts <strong>Dr Inventory / Cr GRNI</strong> when it is
            approved here; a supplier invoice clears that GRNI and adds the VAT; a payment
            settles the payable.
          </p>
        </Card>
      </div>
    </>
  );
}
