import { getStockItems, getStockMovements } from '@/lib/masters';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { IconBox } from '@/components/icons';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Inventory — BioAssetPro' };

/**
 * Stock on hand, what it is worth, and every movement — all real, from the
 * `StockMovement` ledger (`/masters/items/stock`, `/masters/stock-movements`).
 * On-hand quantity and value are never a stored balance; they are the sum of
 * every movement recorded, the same way a bank balance is the sum of its
 * transactions rather than a number someone typed over.
 *
 * Not species-scoped: a bag of layer mash and a crate of eggs are the same kind
 * of object whether the farm keeps birds or snails, and splitting inventory by
 * module would mean two places to look for one feed store.
 */
export default async function InventoryPage() {
  const [items, movements] = await Promise.all([getStockItems(), getStockMovements()]);

  const totalValue = items.reduce((sum, item) => sum + toKobo(item.valueKobo), 0n);
  // Only items with a reorder level someone actually set — an item nobody
  // has configured one for is not "below reorder", it is unconfigured.
  const low = items.filter(
    (item): item is typeof item & { reorderLevel: number } =>
      item.reorderLevel !== null && item.onHand <= item.reorderLevel,
  );
  const feedValue = items
    .filter((item) => item.category === 'Feed')
    .reduce((sum, item) => sum + toKobo(item.valueKobo), 0n);

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Feed, medication, packaging and equipment"
      />

      <Tabs />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Stock value" value={formatNaira(totalValue)} money hint="at cost" />
          <Stat label="Feed value" value={formatNaira(feedValue)} money hint="of that total" />
          <Stat label="Items" value={String(items.length)} />
          <Stat
            label="Below reorder"
            value={String(low.length)}
            goodWhen="down"
            hint={low.length > 0 ? 'need ordering' : 'all above level'}
          />
        </div>

        {low.length > 0 ? (
          <div className="notice notice-warning">
            {low.length} item{low.length === 1 ? '' : 's'} at or below the reorder level:{' '}
            {low.map((item) => item.name).join(', ')}.
          </div>
        ) : null}

        <Card title="Items" subtitle="Stock on hand" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>Code</th>
                  <th>Item</th>
                  <th style={{ width: 120 }}>Category</th>
                  <th className="right" style={{ width: 120 }}>
                    On hand
                  </th>
                  <th className="right" style={{ width: 110 }}>
                    Reorder at
                  </th>
                  <th className="right" style={{ width: 120 }}>
                    Unit cost
                  </th>
                  <th className="right" style={{ width: 130 }}>
                    Value
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const low = item.reorderLevel !== null && item.onHand <= item.reorderLevel;
                  return (
                    <tr key={item.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {item.code}
                      </td>
                      <td>
                        {item.name}
                        <div className="faint">Last moved {formatDate(item.lastMovedOn)}</div>
                      </td>
                      <td className="faint">{item.category ?? '—'}</td>
                      <td className="num">
                        <span style={low ? { color: 'var(--error-700)', fontWeight: 600 } : undefined}>
                          {item.onHand.toLocaleString('en-NG')}
                        </span>
                        <span className="faint"> {item.unit}</span>
                      </td>
                      <td className="num faint">
                        {item.reorderLevel === null ? '—' : item.reorderLevel.toLocaleString('en-NG')}
                      </td>
                      <td className="num">{formatNaira(item.unitCostKobo)}</td>
                      <td className="num">{formatNaira(item.valueKobo)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>Total</td>
                  <td className="num">{formatNaira(totalValue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card title="Recent movements" padded={false}>
          {movements.map((movement) => (
            <div className="list-row" key={movement.id}>
              <span className={`list-icon ${movement.direction === 'IN' ? 'tone-success' : ''}`}>
                <IconBox size={16} />
              </span>
              <div className="list-main">
                <div className="list-title">{movement.itemName}</div>
                <div className="list-sub">{movement.reference}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div
                  className="num"
                  style={{
                    fontSize: 13,
                    color: movement.direction === 'IN' ? 'var(--success-700)' : 'var(--gray-900)',
                  }}
                >
                  {movement.direction === 'IN' ? '+' : '−'}
                  {movement.quantity.toLocaleString('en-NG')} {movement.unit}
                </div>
                <div className="list-time">{formatDate(movement.date)}</div>
              </div>
            </div>
          ))}
          <div className="card-footer">
            <span className="faint">
              Every movement is kept — stock on hand is the sum of its history, never a
              number someone typed over.
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}
