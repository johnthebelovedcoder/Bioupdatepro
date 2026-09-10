import { getPendingApprovals } from '@/lib/procurement';
import { formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
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
  const pending = await getPendingApprovals();

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Documents waiting on you, and what approving each one will do"
        actions={<EscalationSweepButton />}
      />

      <div className="stack">
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
                        {item.documentReference}
                        {item.escalated ? (
                          <div>
                            <span className="badge badge-danger">escalated</span>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {describe(item.transactionType)}
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

/**
 * Plain English for a transaction type.
 *
 * Not decoration: somebody approving a GOODS_RECEIPT is authorising stock and a
 * liability onto the books, and "GOODS RECEIPT" in capitals does not say that.
 * Anything unmapped falls back to the code rather than to a guess.
 */
function describe(type: string): string {
  const known: Record<string, string> = {
    PURCHASE_REQUISITION: 'A request to buy something',
    PURCHASE_ORDER: 'An order to a supplier',
    GOODS_RECEIPT: 'Goods arriving — posts stock and GRNI',
    SUPPLIER_INVOICE: "A supplier's bill — clears GRNI, adds VAT",
    SUPPLIER_INVOICE_EXCEPTION: "A supplier's bill that did not match",
    SUPPLIER_PAYMENT: 'Paying a supplier',
    SALES_QUOTATION: 'A quote to a customer',
    SALES_ORDER: 'A customer order',
    SALES_ORDER_CREDIT_OVERRIDE: 'A customer order over their credit limit',
    GOODS_ISSUE: 'Goods leaving — posts cost of sales',
    SALES_INVOICE: 'Billing a customer',
    CUSTOMER_RECEIPT: 'Money received from a customer',
    CREDIT_NOTE: 'Crediting a customer',
    MANUAL_JOURNAL: 'A journal entry',
    PAYROLL_RUN: 'A payroll run',
    PERIOD_CLOSE: 'Closing an accounting period',
    PERIOD_REOPEN: 'Reopening a closed period',
  };
  return known[type] ?? type.replace(/_/g, ' ').toLowerCase();
}

function waitedFor(since: string): string {
  const hours = Math.floor((Date.now() - new Date(since).getTime()) / 3_600_000);
  if (!Number.isFinite(hours) || hours < 1) return 'just now';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}
