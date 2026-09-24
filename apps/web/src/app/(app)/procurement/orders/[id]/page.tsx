import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPurchaseOrder } from '@/lib/procurement';
import { formatDate, formatNaira, formatQuantity } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { ApproveOrderButton } from '@/components/approve-button';
import { AmendOrderForm, SubmitOrderButton } from '@/components/amend-order-form';

export const metadata = { title: 'Purchase order — BioAssetPro' };

/**
 * One purchase order: its lines, how much has arrived, and — while it is a
 * draft, which is where an order returned by an approver lands — the one
 * place to correct it and send it back.
 */
export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getPurchaseOrder(id);
  if (!order) notFound();

  const draft = order.status === 'DRAFT' && !order.pendingTransactionId;

  return (
    <>
      <PageHeader
        title={order.orderNumber}
        subtitle={`${order.supplier} · raised ${formatDate(order.orderDate)} · ${order.status.replace(/_/g, ' ').toLowerCase()}`}
        actions={
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            {order.pendingTransactionId ? <ApproveOrderButton orderId={order.id} /> : null}
            {order.canReceive ? (
              <Link href={`/procurement/receive/${order.id}`} className="btn btn-primary">
                Receive goods
              </Link>
            ) : null}
            <Link href="/procurement" className="btn btn-ghost">
              Back to orders
            </Link>
          </div>
        }
      />

      <div className="stack">
        {draft ? (
          <Card
            title="Amend and resend"
            subtitle="A draft — either never sent, or returned by an approver. Correct it here."
            action={<SubmitOrderButton orderId={order.id} />}
          >
            <AmendOrderForm orderId={order.id} lines={order.lines} />
          </Card>
        ) : (
          <Card title="Lines" subtitle={`Net ${formatNaira(order.netKobo)}`} padded={false}>
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th>Item</th>
                    <th className="right" style={{ width: 120 }}>Ordered</th>
                    <th className="right" style={{ width: 120 }}>Received</th>
                    <th className="right" style={{ width: 140 }}>Unit price</th>
                    <th style={{ width: 90 }}>Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {line.lineNumber}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {line.itemCode} — {line.lineDescription ?? line.description}
                      </td>
                      <td className="num">{formatQuantity(line.orderedQuantity)}</td>
                      <td className="num">{formatQuantity(line.receivedQuantity)}</td>
                      <td className="num">{formatNaira(line.unitPriceKobo)}</td>
                      <td className="faint">{line.taxCode ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
