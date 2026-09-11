import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProductionOrder } from '@/lib/production';
import { getWarehouses, getStockItems } from '@/lib/masters';
import { formatDate, formatNaira, formatQuantity } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import {
  submitOrder,
  issueOrder,
  settleOrder,
} from '@/app/(app)/production/actions';
import { ProductionOrderActionButton } from '@/components/production-order-action-button';
import { ConfirmConversionForm, RecordLossForm, RecordOutputsForm } from '@/components/production-order-forms';

export const metadata = { title: 'Processing order — BioAssetPro' };

const CYCLE_LABEL: Record<string, string> = {
  SNAILPRO: 'SnailPro',
  POULTRYPRO: 'PoultryPro',
  FEED_MILL: 'Feed mill',
};

export default async function ProductionOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getProductionOrder(id);
  if (!order) notFound();

  return (
    <>
      <PageHeader
        title={order.orderNumber}
        subtitle={`${CYCLE_LABEL[order.processingCycle] ?? order.processingCycle} — ${order.recipeVersion.recipe.name}`}
        actions={
          <Link href="/production" className="btn btn-ghost">
            Back to orders
          </Link>
        }
      />

      <div className="stack">
        <Card title="Status">
          <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
            <span className="badge badge-warning" style={{ textTransform: 'none' }}>
              {order.status.toLowerCase().replace(/_/g, ' ')}
            </span>
            <span className="faint">Raised {formatDate(order.createdAt)}</span>
          </div>

          <div style={{ marginTop: 'var(--sp-4)' }}>
            <StageAction order={order} />
          </div>
        </Card>

        <Card title="Cost so far">
          <div className="stat-grid">
            <MoneyStat label="Biological input" value={order.biologicalInputValueKobo} />
            <MoneyStat label="Packaging" value={order.packagingCostKobo} />
            <MoneyStat label="Standard conversion" value={order.standardConversionCostKobo} />
            <MoneyStat label="Actual labour" value={order.actualLabourCostKobo} />
            <MoneyStat label="Actual overhead" value={order.actualOverheadCostKobo} />
            <MoneyStat label="Abnormal loss" value={order.abnormalLossCostKobo} />
            <MoneyStat label="Finished goods" value={order.finishedGoodsCostKobo} />
          </div>
        </Card>

        {order.harvestRecord ? (
          <Card title="Source harvest">
            <p>
              {order.sourceGroup?.code} — {order.harvestRecord.count} animals,{' '}
              {order.harvestRecord.weightKg} kg, harvested {formatDate(order.harvestRecord.harvestedOn)}
            </p>
          </Card>
        ) : null}

        <Card title="Components" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="right">Planned qty</th>
                  <th className="right">Planned cost</th>
                  <th className="right">Issued qty</th>
                  <th className="right">Issued cost</th>
                </tr>
              </thead>
              <tbody>
                {order.components.map((c) => (
                  <tr key={c.id}>
                    <td style={{ textAlign: 'left' }}>
                      {c.componentItem.code} — {c.componentItem.description}
                    </td>
                    <td className="num">{formatQuantity(c.plannedQuantity)}</td>
                    <td className="num">{formatNaira(c.plannedCostKobo)}</td>
                    <td className="num">{c.issuedQuantity ? formatQuantity(c.issuedQuantity) : '—'}</td>
                    <td className="num">{c.issuedCostKobo ? formatNaira(c.issuedCostKobo) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {order.outputs.length > 0 ? (
          <Card title="Outputs received" padded={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th style={{ width: 120 }}>Type</th>
                    <th className="right">Quantity</th>
                    <th className="right">Allocated cost</th>
                  </tr>
                </thead>
                <tbody>
                  {order.outputs.map((o) => (
                    <tr key={o.id}>
                      <td style={{ textAlign: 'left' }}>
                        {o.item.code} — {o.item.description}
                      </td>
                      <td>{o.outputType === 'MAIN' ? 'Main' : 'By-product'}</td>
                      <td className="num">{formatQuantity(o.quantity)}</td>
                      <td className="num">{formatNaira(o.allocatedCostKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {order.lossEvents.length > 0 ? (
          <Card title="Loss events" padded={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th style={{ width: 130 }}>Classification</th>
                    <th className="right">Quantity</th>
                    <th className="right">Cost</th>
                    <th style={{ width: 110 }}>Posted</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lossEvents.map((l) => (
                    <tr key={l.id}>
                      <td style={{ textAlign: 'left' }}>{l.reason ?? '—'}</td>
                      <td>{l.classification}</td>
                      <td className="num">{formatQuantity(l.quantity)}</td>
                      <td className="num">{formatNaira(l.costKobo)}</td>
                      <td>{l.journalEntryId ? 'yes' : 'pending'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        {order.status === 'IN_PRODUCTION' ? (
          <Card title="Record an abnormal loss" subtitle="Optional — only if this batch lost more than the recipe's own tolerance">
            <RecordLossForm orderId={order.id} />
          </Card>
        ) : null}
      </div>
    </>
  );
}

function MoneyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value is-money">{formatNaira(value)}</div>
    </div>
  );
}

function StageAction({
  order,
}: {
  order: NonNullable<Awaited<ReturnType<typeof getProductionOrder>>>;
}) {
  switch (order.status) {
    case 'DRAFT':
      return (
        <ProductionOrderActionButton
          action={submitOrder}
          id={order.id}
          label="Submit for approval"
          pendingLabel="Submitting…"
        />
      );
    case 'SUBMITTED':
      return (
        <p className="faint">
          Awaiting approval. Check the{' '}
          <Link href="/approvals/inbox">approvals inbox</Link> if you hold the role that approves
          processing orders.
        </p>
      );
    case 'APPROVED':
      return (
        <ProductionOrderActionButton
          action={issueOrder}
          id={order.id}
          label="Issue materials"
          pendingLabel="Issuing…"
        />
      );
    case 'RELEASED':
      return <ConfirmConversionForm orderId={order.id} />;
    case 'IN_PRODUCTION':
      return (
        <RecordOutputsFormLoader order={order} />
      );
    case 'COMPLETED':
      return (
        <ProductionOrderActionButton
          action={settleOrder}
          id={order.id}
          label="Settle"
          pendingLabel="Settling…"
        />
      );
    case 'CANCELLED':
      return <p className="faint">This order was cancelled and cannot proceed further.</p>;
    default:
      return null;
  }
}

async function RecordOutputsFormLoader({
  order,
}: {
  order: NonNullable<Awaited<ReturnType<typeof getProductionOrder>>>;
}) {
  const [warehouses, stockItems] = await Promise.all([getWarehouses(), getStockItems()]);
  const mainItemId = order.recipeVersion.recipe.outputItemId;
  const byProductItems = stockItems
    .filter((i) => i.id !== mainItemId)
    .map((i) => ({ id: i.id, code: i.code, name: i.name }));

  return (
    <RecordOutputsForm
      orderId={order.id}
      mainItemId={mainItemId}
      mainItemLabel={`${order.recipeVersion.recipe.outputItem.code} — ${order.recipeVersion.recipe.outputItem.description}`}
      warehouses={warehouses}
      byProductItems={byProductItems}
    />
  );
}
