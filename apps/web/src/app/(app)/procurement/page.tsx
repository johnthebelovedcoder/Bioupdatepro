import { getPurchaseOrders, getSuppliers } from '@/lib/demo-trade';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { Tabs, STORE_TABS } from '@/components/tabs';

export const metadata = { title: 'Procurement — BioAssetPro' };

const STATUS_TONE: Record<string, string> = {
  DRAFT: '',
  AWAITING_APPROVAL: 'badge-warning',
  APPROVED: 'badge-accent',
  PART_RECEIVED: 'badge-warning',
  RECEIVED: 'badge-accent',
  INVOICED: 'badge-success',
};

export default async function ProcurementPage() {
  const [orders, suppliers] = await Promise.all([getPurchaseOrders(), getSuppliers()]);

  const owed = suppliers.reduce((sum, supplier) => sum + toKobo(supplier.balanceKobo), 0n);
  const awaiting = orders.filter((order) => order.status === 'AWAITING_APPROVAL');
  const open = orders.filter(
    (order) => order.status !== 'INVOICED' && order.status !== 'DRAFT',
  );
  const openValue = open.reduce((sum, order) => sum + toKobo(order.totalKobo), 0n);

  return (
    <>
      <PageHeader
        title="Procurement"
        subtitle="Suppliers, purchase orders and goods received"
      />

      <Tabs tabs={STORE_TABS} />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Owed to suppliers" value={formatNaira(owed)} money />
          <Stat label="Open orders" value={String(open.length)} hint="not yet invoiced" />
          <Stat label="Open order value" value={formatNaira(openValue)} money />
          <Stat
            label="Awaiting approval"
            value={String(awaiting.length)}
            goodWhen="down"
            hint={awaiting.length > 0 ? 'blocking receipt' : 'none pending'}
          />
        </div>

        {awaiting.length > 0 ? (
          <div className="notice notice-warning">
            {awaiting.length} order{awaiting.length === 1 ? ' is' : 's are'} waiting for
            approval. Goods cannot be received against an unapproved order.
          </div>
        ) : null}

        <Card title="Purchase orders" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Order</th>
                  <th>Supplier</th>
                  <th style={{ width: 110 }}>Raised</th>
                  <th style={{ width: 110 }}>Expected</th>
                  <th className="right" style={{ width: 140 }}>
                    Value
                  </th>
                  <th style={{ width: 150 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      {order.number}
                      <div className="faint">
                        {order.lines} line{order.lines === 1 ? '' : 's'}
                      </div>
                    </td>
                    <td>{order.supplier}</td>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(order.raisedOn)}
                    </td>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(order.expectedOn)}
                    </td>
                    <td className="num">{formatNaira(order.totalKobo)}</td>
                    <td>
                      <span className={`badge ${STATUS_TONE[order.status] ?? ''}`}>
                        {order.status.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Suppliers" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th style={{ width: 150 }}>Supplies</th>
                  <th style={{ width: 150 }}>Phone</th>
                  <th style={{ width: 110 }}>Terms</th>
                  <th style={{ width: 110 }}>Last order</th>
                  <th className="right" style={{ width: 140 }}>
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td className="strong">{supplier.name}</td>
                    <td className="faint">{supplier.category}</td>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {supplier.phone}
                    </td>
                    <td className="faint">{supplier.terms}</td>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(supplier.lastOrderOn)}
                    </td>
                    <td className="num">
                      {toKobo(supplier.balanceKobo) === 0n ? (
                        <span className="num-zero">—</span>
                      ) : (
                        formatNaira(supplier.balanceKobo)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            The whole purchase pipeline already exists in the backend and is tested —
            requisition, RFQ, order, goods receipt, three-way matching against the invoice,
            payment and allocation, including the goods-received-not-invoiced control. Only
            the interface is missing.
          </p>
        </Card>
      </div>
    </>
  );
}
