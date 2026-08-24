import Link from 'next/link';
import { getGoodsReceipts, getPurchaseOrders } from '@/lib/procurement';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconBox } from '@/components/icons';

export const metadata = { title: 'Goods received — BioAssetPro' };

/**
 * What has arrived, and what it did to the accounts.
 *
 * The journal column is the reason this screen exists. A receipt sitting at
 * "submitted" has moved stock on paper and moved nothing in the ledger; a
 * posted one carries a journal number you can go and read. Showing both in the
 * same list makes the difference visible instead of a thing you have to know.
 */
export default async function GoodsReceivedPage({
  searchParams,
}: {
  searchParams: Promise<{ received?: string }>;
}) {
  const [receipts, orders, query] = await Promise.all([
    getGoodsReceipts(),
    getPurchaseOrders(),
    searchParams,
  ]);
  const waiting = receipts.filter((receipt) => !receipt.journalEntryId);

  /*
   * What is still expected off a vehicle.
   *
   * This sits here rather than only on the buying screen because the person who
   * takes a delivery is not always allowed to see what the farm agreed to pay
   * for it — a store supervisor has the receiving pages and not the commercial
   * ones. Without this they could record a delivery only by being handed a
   * link. Quantities and supplier, no prices.
   */
  const expected = orders.filter((order) => order.canReceive);

  return (
    <>
      <PageHeader
        title="Goods received"
        subtitle="Deliveries accepted into the store, and the entries they made"
      />

      <Tabs />

      <div className="stack">
        {query.received ? (
          <div className="notice notice-success">
            Delivery recorded. It now needs confirming by somebody other than whoever
            recorded it — until then the stock is noted but the ledger has not moved.
          </div>
        ) : null}

        {waiting.length > 0 ? (
          <div className="notice notice-warning">
            {waiting.length} receipt{waiting.length === 1 ? ' is' : 's are'} waiting for
            confirmation. Nothing has posted for {waiting.length === 1 ? 'it' : 'them'} yet —{' '}
            <Link href="/approvals">the approvals queue</Link> is where that happens.
          </div>
        ) : null}

        {expected.length > 0 ? (
          <Card
            title="Expected"
            subtitle="Approved orders with goods still to come in"
            padded={false}
          >
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Order</th>
                    <th>Supplier</th>
                    <th>Still to arrive</th>
                    <th style={{ width: 160 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {expected.map((order) => (
                    <tr key={order.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {order.orderNumber}
                      </td>
                      <td>{order.supplier}</td>
                      <td className="faint">
                        {order.lines
                          .map((line) => {
                            const left =
                              Number(line.orderedQuantity) - Number(line.receivedQuantity);
                            return `${Number(left.toFixed(6))} × ${line.itemCode}`;
                          })
                          .join(', ')}
                      </td>
                      <td>
                        <Link
                          href={`/procurement/receive/${order.id}`}
                          className="btn btn-primary"
                        >
                          Receive
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
          {receipts.length === 0 ? (
            <EmptyState
              icon={<IconBox size={22} />}
              title="Nothing received yet"
              body="When goods arrive against an approved order, record them from the buying screen. That is the first moment a purchase touches the accounts."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Receipt</th>
                    <th>Supplier</th>
                    <th style={{ width: 110 }}>Received</th>
                    <th style={{ width: 110 }}>Quality</th>
                    <th className="right" style={{ width: 140 }}>
                      Value
                    </th>
                    <th style={{ width: 190 }}>Ledger</th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.map((receipt) => (
                    <tr key={receipt.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {receipt.grnNumber}
                        <div className="faint">
                          against {receipt.orderNumber} · {receipt.lineCount} line
                          {receipt.lineCount === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td>{receipt.supplier}</td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(receipt.receiptDate)}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            receipt.qualityStatus === 'PASSED'
                              ? 'badge-success'
                              : receipt.qualityStatus === 'FAILED'
                                ? 'badge-danger'
                                : 'badge-warning'
                          }`}
                        >
                          {receipt.qualityStatus.toLowerCase()}
                        </span>
                      </td>
                      <td className="num">{formatNaira(receipt.valueKobo)}</td>
                      <td>
                        {receipt.journalEntryId ? (
                          <>
                            <span className="badge badge-success">posted</span>
                            <div className="faint num">
                              {receipt.journalNumber ?? 'journal written'}
                            </div>
                            <div className="faint">Dr Inventory / Cr GRNI</div>
                          </>
                        ) : (
                          <>
                            <span className="badge badge-warning">
                              {receipt.status.toLowerCase()}
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
