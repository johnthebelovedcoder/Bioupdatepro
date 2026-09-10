import { getTransfers, getWriteOffs } from '@/lib/inventory-transfers';
import { getStockItems, getWarehouses } from '@/lib/masters';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { TableSearch } from '@/components/table-search';
import { IssueTransferForm } from '@/components/issue-transfer-form';
import { WriteOffForm } from '@/components/write-off-form';
import { ReceiveTransferButton } from '@/components/receive-transfer-button';
import { IconBox } from '@/components/icons';

export const metadata = { title: 'Transfers & write-offs — BioAssetPro' };

const TRANSFER_STATUS_TONE: Record<string, string> = {
  IN_TRANSIT: 'badge-warning',
  RECEIVED: 'badge-success',
};

/**
 * §14 — moving stock between stores, and removing it with a reason.
 *
 * `InventoryTransferService` (PCR-012/013/014) has always been real and
 * live-verified — this is its first screen. A transfer is two steps on
 * purpose: issuing and receiving are different people's jobs, the same
 * separation a goods receipt already enforces between placing an order and
 * taking delivery of it. A write-off is one step, because nothing is on its
 * way anywhere — it posts the moment the reason is given.
 */
export default async function TransfersPage() {
  const [transfers, writeOffs, items, warehouses] = await Promise.all([
    getTransfers(),
    getWriteOffs(),
    getStockItems(),
    getWarehouses(),
  ]);

  const inTransit = transfers.filter((t) => t.status === 'IN_TRANSIT');

  return (
    <>
      <PageHeader
        title="Transfers & write-offs"
        subtitle="Stock moving between stores, and stock removed with a reason"
      />

      <Tabs />

      <div className="stack">
        {inTransit.length > 0 ? (
          <div className="notice notice-warning">
            {inTransit.length} transfer{inTransit.length === 1 ? '' : 's'} in transit, waiting to
            be received at the other store.
          </div>
        ) : null}

        <TableSearch
          placeholder="Search transfers"
          actions={<IssueTransferForm items={items} warehouses={warehouses} />}
        >
          <Card title="Transfers" padded={false}>
            {transfers.length === 0 ? (
              <EmptyState
                icon={<IconBox size={22} />}
                title="No transfer yet"
                body="Move stock from one store to another above."
              />
            ) : (
              <div className="table-wrap">
                <table className="data wide">
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>Reference</th>
                      <th>Item</th>
                      <th style={{ width: 130 }}>From</th>
                      <th style={{ width: 130 }}>To</th>
                      <th className="right" style={{ width: 110 }}>
                        Quantity
                      </th>
                      <th className="right" style={{ width: 120 }}>
                        Value
                      </th>
                      <th style={{ width: 100 }}>Status</th>
                      <th style={{ width: 100 }}>Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map((t) => (
                      <tr key={t.id}>
                        <td className="num strong" style={{ textAlign: 'left' }}>
                          {t.transferNumber}
                          <div className="faint">by {t.createdBy}</div>
                        </td>
                        <td>
                          {t.itemName}
                          <div className="faint">{t.itemCode}</div>
                        </td>
                        <td className="faint">{t.fromWarehouse}</td>
                        <td className="faint">{t.toWarehouse}</td>
                        <td className="num">
                          {Number(t.quantity).toLocaleString('en-NG')} {t.unit}
                        </td>
                        <td className="num">{formatNaira(t.valueKobo)}</td>
                        <td>
                          <span className={`badge ${TRANSFER_STATUS_TONE[t.status] ?? ''}`}>
                            {t.status.toLowerCase().replace('_', ' ')}
                          </span>
                        </td>
                        <td>
                          {t.status === 'IN_TRANSIT' ? (
                            <ReceiveTransferButton transferId={t.id} />
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TableSearch>

        <TableSearch
          placeholder="Search write-offs"
          actions={<WriteOffForm items={items} warehouses={warehouses} />}
        >
          <Card title="Write-offs" padded={false}>
            {writeOffs.length === 0 ? (
              <EmptyState
                icon={<IconBox size={22} />}
                title="No write-off yet"
                body="Remove stock with a reason above — a count discrepancy, damage, or obsolescence."
              />
            ) : (
              <div className="table-wrap">
                <table className="data wide">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Date</th>
                      <th>Item</th>
                      <th style={{ width: 130 }}>Store</th>
                      <th className="right" style={{ width: 110 }}>
                        Quantity
                      </th>
                      <th className="right" style={{ width: 120 }}>
                        Value
                      </th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {writeOffs.map((w) => (
                      <tr key={w.id}>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {formatDate(w.createdAt)}
                          <div className="faint">by {w.createdBy}</div>
                        </td>
                        <td>
                          {w.itemName}
                          <div className="faint">{w.itemCode}</div>
                        </td>
                        <td className="faint">{w.warehouse}</td>
                        <td className="num">
                          {Number(w.quantity).toLocaleString('en-NG')} {w.unit}
                        </td>
                        <td className="num">{formatNaira(w.valueKobo)}</td>
                        <td>{w.reason}</td>
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
            A transfer posts twice — once at issue (Dr/Cr in-transit) and once at receipt, at the
            original value, never re-priced at the destination&apos;s current cost. A write-off
            posts once, immediately, and always needs a reason.
          </p>
        </Card>
      </div>
    </>
  );
}
