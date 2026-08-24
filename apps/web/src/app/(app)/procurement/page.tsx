import Link from 'next/link';
import { getPurchaseOrders } from '@/lib/procurement';
import { getSuppliers } from '@/lib/trade';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { ApproveOrderButton } from '@/components/approve-button';
import { IconBox } from '@/components/icons';

export const metadata = { title: 'Buying — BioAssetPro' };

const STATUS_TONE: Record<string, string> = {
  DRAFT: '',
  SUBMITTED: 'badge-warning',
  APPROVED: 'badge-accent',
  PARTIALLY_RECEIVED: 'badge-warning',
  RECEIVED: 'badge-accent',
  INVOICED: 'badge-success',
  CLOSED: 'badge-success',
  CANCELLED: '',
};

/**
 * Purchase orders — the farm's own, from the API.
 *
 * The order of the columns follows the order of the work: what you asked for,
 * who from, what it costs, where it has got to, and what you can do about it
 * now. The last column is the one that was missing; an order list you cannot
 * act on is a report, and nobody was asking for a report.
 */
export default async function ProcurementPage() {
  const [orders, suppliers] = await Promise.all([getPurchaseOrders(), getSuppliers()]);

  const awaiting = orders.filter((order) => order.pendingTransactionId);
  const receivable = orders.filter((order) => order.canReceive);
  const openValue = orders
    .filter((order) => order.status !== 'CLOSED' && order.status !== 'CANCELLED')
    .reduce((sum, order) => sum + toKobo(order.netKobo), 0n);

  return (
    <>
      <PageHeader title="Buying" subtitle="Purchase orders, and goods coming in against them" />

      <Tabs />

      <div className="stack">
        <div className="stat-grid">
          {/*
            No "owed to suppliers" figure here. It would have to come from the
            payables ledger, and until supplier invoices have a screen this page
            can only reach the orders — a total drawn from those would be the
            wrong number wearing the right label.
          */}
          <Stat label="Suppliers" value={String(suppliers.length)} hint="registered" />
          <Stat label="Orders" value={String(orders.length)} />
          <Stat label="Order value" value={formatNaira(openValue)} money hint="excluding VAT" />
          <Stat
            label="Waiting for approval"
            value={String(awaiting.length)}
            goodWhen="down"
            hint={awaiting.length > 0 ? 'blocking receipt' : 'none pending'}
          />
        </div>

        {awaiting.length > 0 ? (
          <div className="notice notice-warning">
            {awaiting.length} order{awaiting.length === 1 ? ' is' : 's are'} waiting for
            approval. Goods cannot be received against an order nobody has approved — that
            control has to come before the money, not after it.
          </div>
        ) : null}

        {receivable.length > 0 ? (
          <div className="notice notice-success">
            {receivable.length} order{receivable.length === 1 ? '' : 's'} approved and ready to
            receive. Recording the delivery is what puts the stock on the books.
          </div>
        ) : null}

        <Card
          title="Purchase orders"
          subtitle="Raised on this farm"
          padded={false}
          action={
            <Link href="/procurement/new" className="btn btn-primary">
              Buy supplies
            </Link>
          }
        >
          {orders.length === 0 ? (
            <EmptyState
              icon={<IconBox size={22} />}
              title="No orders yet"
              body="Nothing has been ordered. Raise one with “Buy supplies”, and it goes for approval before anything can be received against it."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Order</th>
                    <th>Supplier</th>
                    <th style={{ width: 110 }}>Raised</th>
                    <th className="right" style={{ width: 140 }}>
                      Value
                    </th>
                    <th style={{ width: 140 }}>Status</th>
                    <th style={{ width: 180 }}>Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {order.orderNumber}
                        <div className="faint">
                          {order.lineCount} line{order.lineCount === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td>{order.supplier}</td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(order.orderDate)}
                      </td>
                      <td className="num">{formatNaira(order.netKobo)}</td>
                      <td>
                        <span className={`badge ${STATUS_TONE[order.status] ?? ''}`}>
                          {order.status.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </td>
                      <td>
                        {order.pendingTransactionId ? (
                          <ApproveOrderButton orderId={order.id} />
                        ) : order.canReceive ? (
                          <Link
                            href={`/procurement/receive/${order.id}`}
                            className="btn btn-primary"
                          >
                            Receive goods
                          </Link>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card padded>
          <p className="muted" style={{ fontSize: 14 }}>
            Nothing on this page has touched the accounts yet. An order is a commitment, not a
            cost — the first ledger entry in the chain happens when the goods arrive, and it is{' '}
            <strong>Dr Inventory / Cr Goods Received Not Invoiced</strong>. The supplier&rsquo;s
            invoice then clears the GRNI and adds the VAT.
          </p>
        </Card>
      </div>
    </>
  );
}
