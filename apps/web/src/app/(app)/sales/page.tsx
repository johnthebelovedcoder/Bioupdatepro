import Link from 'next/link';
import { getSalesOrders } from '@/lib/sales';
import { getCustomers } from '@/lib/trade';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { ApproveSalesOrderButton } from '@/components/approve-button';
import { IconTag } from '@/components/icons';

export const metadata = { title: 'Selling — BioAssetPro' };

const STATUS_TONE: Record<string, string> = {
  DRAFT: '',
  SUBMITTED: 'badge-warning',
  APPROVED: 'badge-accent',
  PARTIALLY_DELIVERED: 'badge-warning',
  FULLY_DELIVERED: 'badge-accent',
  CLOSED: 'badge-success',
  CANCELLED: '',
};

/**
 * Sales orders — the farm's own, from the API.
 *
 * Mirrors Buying exactly: what was ordered, by whom, what it is worth, where
 * it has got to, and what can be done about it now. The old version of this
 * page read `demo-trade.ts` fixtures — invented invoices and customer
 * balances shown as if they were real, which is how a client came to ask
 * where the numbers on his farm's app had come from.
 */
export default async function SalesPage() {
  const [orders, customers] = await Promise.all([getSalesOrders(), getCustomers()]);

  const awaiting = orders.filter((order) => order.pendingTransactionId);
  const deliverable = orders.filter((order) => order.canDeliver);
  const openValue = orders
    .filter((order) => order.status !== 'CLOSED' && order.status !== 'CANCELLED')
    .reduce((sum, order) => sum + toKobo(order.netKobo), 0n);

  return (
    <>
      <PageHeader title="Selling" subtitle="Sales orders, and what has gone out against them" />

      <Tabs />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Customers" value={String(customers.length)} hint="registered" />
          <Stat label="Orders" value={String(orders.length)} />
          <Stat label="Order value" value={formatNaira(openValue)} money hint="excluding VAT" />
          <Stat
            label="Waiting for approval"
            value={String(awaiting.length)}
            goodWhen="down"
            hint={awaiting.length > 0 ? 'blocking delivery' : 'none pending'}
          />
        </div>

        {awaiting.length > 0 ? (
          <div className="notice notice-warning">
            {awaiting.length} order{awaiting.length === 1 ? ' is' : 's are'} waiting for
            approval. Goods cannot ship against an order nobody has approved.
          </div>
        ) : null}

        {deliverable.length > 0 ? (
          <div className="notice notice-success">
            {deliverable.length} order{deliverable.length === 1 ? '' : 's'} approved and ready
            to ship. <Link href="/sales/deliveries">Record the delivery</Link> to move stock and
            open the door to invoicing.
          </div>
        ) : null}

        <Card
          title="Sales orders"
          subtitle="Raised on this farm"
          padded={false}
          action={
            <Link href="/sales/new" className="btn btn-primary">
              Record a sale
            </Link>
          }
        >
          {orders.length === 0 ? (
            <EmptyState
              icon={<IconTag size={22} />}
              title="No orders yet"
              body="Nothing has been sold. Raise one with “Record a sale”, and it goes for approval before anything can ship against it."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Order</th>
                    <th>Customer</th>
                    <th style={{ width: 110 }}>Raised</th>
                    <th className="right" style={{ width: 140 }}>
                      Value
                    </th>
                    <th style={{ width: 150 }}>Status</th>
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
                      <td>{order.customer}</td>
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
                          <ApproveSalesOrderButton orderId={order.id} />
                        ) : order.canDeliver ? (
                          <Link href={`/sales/deliver/${order.id}`} className="btn btn-primary">
                            Ship goods
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
            Nothing on this page has touched the accounts yet. An order is a promise, not a
            sale — the first ledger entry happens when goods ship (or, if this company defers
            cost of sales, when the invoice is raised). See{' '}
            <Link href="/sales/deliveries">Deliveries</Link> and{' '}
            <Link href="/sales/invoices">Invoices</Link>.
          </p>
        </Card>
      </div>
    </>
  );
}
