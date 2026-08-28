import Link from 'next/link';
import { getDeliveries, getSalesOrders } from '@/lib/sales';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconTag } from '@/components/icons';

export const metadata = { title: 'Deliveries — BioAssetPro' };

/**
 * What has gone out, and what it did to the accounts.
 *
 * Same reasoning as Buying's Goods received screen, reversed: a delivery
 * sitting at "submitted" has moved stock on paper and moved nothing in the
 * ledger yet; a posted one relieved inventory, and carries cost of sales too
 * if this company recognises it at delivery rather than at invoice.
 */
export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ shipped?: string }>;
}) {
  const [deliveries, orders, query] = await Promise.all([
    getDeliveries(),
    getSalesOrders(),
    searchParams,
  ]);
  const waiting = deliveries.filter((delivery) => delivery.status !== 'POSTED');

  const expected = orders.filter((order) => order.canDeliver);

  return (
    <>
      <PageHeader title="Deliveries" subtitle="Goods shipped to customers, and the entries each one made" />

      <Tabs />

      <div className="stack">
        {query.shipped ? (
          <div className="notice notice-success">
            Delivery recorded. It now needs confirming by somebody other than whoever recorded
            it — until then the stock movement is noted but not yet posted.
          </div>
        ) : null}

        {waiting.length > 0 ? (
          <div className="notice notice-warning">
            {waiting.length} deliver{waiting.length === 1 ? 'y is' : 'ies are'} waiting for
            confirmation. <Link href="/approvals">The approvals queue</Link> is where that
            happens.
          </div>
        ) : null}

        {expected.length > 0 ? (
          <Card title="Ready to ship" subtitle="Approved orders with goods still to go out" padded={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Order</th>
                    <th>Customer</th>
                    <th>Still to ship</th>
                    <th style={{ width: 140 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {expected.map((order) => (
                    <tr key={order.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {order.orderNumber}
                      </td>
                      <td>{order.customer}</td>
                      <td className="faint">
                        {order.lines
                          .map((line) => {
                            const left =
                              Number(line.orderedQuantity) - Number(line.deliveredQuantity);
                            return `${Number(left.toFixed(6))} × ${line.itemCode}`;
                          })
                          .join(', ')}
                      </td>
                      <td>
                        <Link href={`/sales/deliver/${order.id}`} className="btn btn-primary">
                          Ship
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        <Card title="Deliveries" padded={false}>
          {deliveries.length === 0 ? (
            <EmptyState
              icon={<IconTag size={22} />}
              title="Nothing shipped yet"
              body="When goods go out against an approved order, record it from the selling screen."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Delivery</th>
                    <th>Customer</th>
                    <th style={{ width: 110 }}>Date</th>
                    <th className="right" style={{ width: 140 }}>
                      Cost
                    </th>
                    <th style={{ width: 190 }}>Ledger</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {delivery.deliveryNumber}
                        <div className="faint">
                          against {delivery.orderNumber} · {delivery.lineCount} line
                          {delivery.lineCount === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td>{delivery.customer}</td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(delivery.deliveryDate)}
                      </td>
                      <td className="num">{formatNaira(delivery.costKobo)}</td>
                      <td>
                        {delivery.status === 'POSTED' ? (
                          <>
                            <span className="badge badge-success">posted</span>
                            {delivery.journalEntryId ? (
                              <>
                                <div className="faint num">
                                  {delivery.journalNumber ?? 'journal written'}
                                </div>
                                <div className="faint">Dr Cost of sales / Cr Inventory</div>
                              </>
                            ) : (
                              <div className="faint">cost of sales deferred to invoice</div>
                            )}
                            <Link
                              href="/sales/invoices"
                              className="faint"
                              style={{ display: 'block', marginTop: 4 }}
                            >
                              Raise the invoice →
                            </Link>
                          </>
                        ) : (
                          <>
                            <span className="badge badge-warning">
                              {delivery.status.toLowerCase()}
                            </span>
                            <div className="faint">nothing posted yet</div>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
