import Link from 'next/link';
import { getProductionOrders, getAvailableHarvests, getRecipes } from '@/lib/production';
import { getFarms } from '@/lib/masters';
import { getContext } from '@/lib/org';
import { formatDate, formatNaira, formatQuantity } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { TableSearch } from '@/components/table-search';
import { IconBox } from '@/components/icons';
import { CreateProductionOrderForm } from '@/components/create-production-order-form';

export const metadata = { title: 'Processing orders — BioAssetPro' };

const CYCLE_LABEL: Record<string, string> = {
  SNAILPRO: 'SnailPro',
  POULTRYPRO: 'PoultryPro',
  FEED_MILL: 'Feed mill',
};

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'badge-warning',
  SUBMITTED: 'badge-warning',
  APPROVED: 'badge-warning',
  RELEASED: 'badge-warning',
  IN_PRODUCTION: 'badge-warning',
  COMPLETED: 'badge-success',
  CANCELLED: 'badge-danger',
};

/**
 * Processing orders — turning a harvest or raw feed ingredients into a
 * finished product (SnailPro, PoultryPro, Feed Mill). Each order is a
 * multi-step lifecycle rather than one form; the list here is the entry
 * point into a single order's own page, where the next step is the only
 * action offered.
 */
export default async function ProductionOrdersPage() {
  const [orders, harvests, recipes, farms, context] = await Promise.all([
    getProductionOrders(),
    getAvailableHarvests(),
    getRecipes(),
    getFarms(),
    getContext(),
  ]);

  return (
    <>
      <PageHeader
        title="Processing orders"
        subtitle="Turning a harvest into product, or milling feed from raw ingredients"
      />

      <Tabs />

      <div className="stack">
        <TableSearch
          placeholder="Search orders"
          actions={
            <CreateProductionOrderForm
              harvests={harvests}
              recipes={recipes}
              farms={farms}
              branches={context.branches}
            />
          }
        >
          <Card title={`${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`} padded={false}>
            {orders.length === 0 ? (
              <EmptyState
                icon={<IconBox size={22} />}
                title="No processing orders yet"
                body="Raise one above, against a harvest or as a feed-mill run."
              />
            ) : (
              <div className="table-wrap">
                <table className="data wide">
                  <thead>
                    <tr>
                      <th style={{ width: 170 }}>Order</th>
                      <th style={{ width: 110 }}>Cycle</th>
                      <th>Output</th>
                      <th className="right" style={{ width: 130 }}>
                        Planned qty
                      </th>
                      <th className="right" style={{ width: 140 }}>
                        Finished cost
                      </th>
                      <th style={{ width: 130 }}>Status</th>
                      <th style={{ width: 110 }}>Raised</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td className="num strong" style={{ textAlign: 'left' }}>
                          <Link href={`/production/${order.id}`}>{order.orderNumber}</Link>
                        </td>
                        <td>{CYCLE_LABEL[order.processingCycle] ?? order.processingCycle}</td>
                        <td className="faint">
                          {order.recipeVersion.recipe.outputItem.code} —{' '}
                          {order.recipeVersion.recipe.outputItem.description}
                        </td>
                        <td className="num">{formatQuantity(order.plannedOutputQuantity)}</td>
                        <td className="num">{formatNaira(order.finishedGoodsCostKobo)}</td>
                        <td>
                          <span className={`badge ${STATUS_TONE[order.status] ?? ''}`}>
                            {order.status.toLowerCase().replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {formatDate(order.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TableSearch>
      </div>
    </>
  );
}
