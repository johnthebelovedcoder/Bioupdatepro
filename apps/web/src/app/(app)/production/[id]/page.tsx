import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFeedQuality, getProductionOrder, getProductionRouting, getProductionVariance, type ProductionVariance } from '@/lib/production';
import { getWarehouses, getStockItems } from '@/lib/masters';
import { formatDate, formatNaira, formatQuantity } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import {
  submitOrder,
  snapshotRouting,
} from '@/app/(app)/production/actions';
import { ProductionOrderActionButton } from '@/components/production-order-action-button';
import {
  ConfirmConversionForm,
  IssueMaterialsForm,
  PlantIntakeForm,
  QualityDecision,
  QualityTestForm,
  RecordLossForm,
  RecordOutputsForm,
  SettleOrderForm,
} from '@/components/production-order-forms';

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
  const routing = await getProductionRouting(id);
  const variance = order.status === 'COMPLETED' ? await getProductionVariance(id) : null;
  const routingCost = routing.reduce((sum, line) => sum + BigInt(line.standardCostKobo), 0n);
  const isPoultry = order.processingCycle === 'POULTRYPRO' && !!order.harvestRecord;
  const quality = order.processingCycle === 'FEED_MILL' ? await getFeedQuality(id) : null;
  const intakeOpen = !['COMPLETED', 'CANCELLED'].includes(order.status);
  const mainKg = order.outputs.filter((o) => o.outputType === 'MAIN').reduce((s, o) => s + Number(o.quantity), 0);

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
            <StageAction order={order} routing={routing} variance={variance} />
          </div>
        </Card>

        {variance ? (
          <Card
            title="Variance against standard"
            subtitle={
              variance.tolerancePercent
                ? `Tolerance ${Number(variance.tolerancePercent)}% of standard good output`
                : 'No costing policy for this year'
            }
          >
            <table className="data">
              <tbody>
                {[
                  ['Material usage', variance.materialUsageKobo],
                  ['Material price', variance.materialPriceKobo],
                  ['Yield', variance.yieldKobo],
                  ['Conversion', variance.conversionKobo],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td style={{ textAlign: 'left' }}>{label}</td>
                    <td className="num">{formatNaira(value!)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ textAlign: 'left', fontWeight: 600 }}>Total (positive is adverse)</td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {formatNaira(variance.totalKobo)}
                    {variance.percent !== null ? ` · ${variance.percent}%` : ''}
                  </td>
                </tr>
              </tbody>
            </table>
            {variance.reason ? <p className="faint" style={{ marginTop: 'var(--sp-3)' }}>Reason given: {variance.reason}</p> : null}
          </Card>
        ) : null}

        <Card title="Cost so far">
          <div className="stat-grid">
            <MoneyStat label="Biological input" value={order.biologicalInputValueKobo} />
            <MoneyStat label="Rearing cost" value={order.rearingCostKobo} />
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

        {isPoultry ? (
          <Card
            title="Plant intake"
            subtitle="Birds and weight from the catch to the plant; dead on arrival and condemned birds are abnormal loss"
          >
            {order.intakeRecordedAt ? (
              <div className="stat-grid" style={{ marginBottom: 'var(--sp-4)' }}>
                <PlainStat label="Received" value={`${order.plantReceivedCount} birds, ${Number(order.plantReceivedWeightKg).toFixed(1)} kg`} />
                <PlainStat
                  label="Lost in transit"
                  value={`${(Number(order.harvestRecord!.weightKg) - Number(order.plantReceivedWeightKg)).toFixed(1)} kg`}
                />
                <PlainStat label="Dead on arrival" value={`${order.deadOnArrivalCount} (${Number(order.deadOnArrivalWeightKg).toFixed(1)} kg)`} />
                <PlainStat
                  label="Condemned"
                  value={`${order.condemnedCount} (${Number(order.condemnedWeightKg).toFixed(1)} kg)`}
                  hint={order.condemnationReason ? `${order.condemnationReason}${order.intakeInspectedBy ? `, ${order.intakeInspectedBy}` : ''}` : undefined}
                />
                {mainKg > 0 ? (
                  <PlainStat label="Dressed yield" value={`${((mainKg / Number(order.harvestRecord!.weightKg)) * 100).toFixed(1)}%`} hint="of live catch weight" />
                ) : null}
              </div>
            ) : null}
            {intakeOpen ? (
              <PlantIntakeForm
                orderId={order.id}
                caught={{ count: order.harvestRecord!.count, weightKg: order.harvestRecord!.weightKg }}
                current={order}
              />
            ) : null}
          </Card>
        ) : null}

        {quality ? (
          <Card
            title="Quality"
            subtitle={
              quality.spec
                ? `Limits: ${[
                    quality.spec.minProteinPercent ? `protein at least ${quality.spec.minProteinPercent}%` : null,
                    quality.spec.maxMoisturePercent ? `moisture at most ${quality.spec.maxMoisturePercent}%` : null,
                    quality.spec.maxAflatoxinPpb ? `aflatoxin at most ${quality.spec.maxAflatoxinPpb} ppb` : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}. The batch stays in quarantine until a sample passes and is released.`
                : 'This feed has no quality limits set; set them under Feed mill → Quality.'
            }
          >
            <div className="stack">
              {quality.tests.map((t) => (
                <div key={t.id} className="stack" style={{ gap: 'var(--sp-2)', borderBottom: '1px solid var(--border)', paddingBottom: 'var(--sp-3)' }}>
                  <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="num">{t.sampledOn}</span>
                    <span className={`badge ${t.passed ? 'badge-success' : 'badge-danger'}`}>{t.passed ? 'passed' : 'failed'}</span>
                    <span className={`badge ${t.disposition === 'RELEASED' ? 'badge-success' : t.disposition === 'REJECTED' ? 'badge-danger' : 'badge-warning'}`}>
                      {t.disposition.toLowerCase()}
                    </span>
                    <span className="faint">
                      {[
                        t.proteinPercent ? `protein ${t.proteinPercent}%` : null,
                        t.moisturePercent ? `moisture ${t.moisturePercent}%` : null,
                        t.aflatoxinPpb ? `aflatoxin ${t.aflatoxinPpb} ppb` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  {t.failures.length ? <div className="faint">{t.failures.join(' ')}</div> : null}
                  {t.decisionNote ? <div className="faint">{t.decisionNote}</div> : null}
                  {t.disposition === 'PENDING' ? <QualityDecision orderId={order.id} testId={t.id} passed={t.passed} /> : null}
                </div>
              ))}
              {quality.spec && order.status === 'IN_PRODUCTION' && !quality.tests.some((t) => t.disposition === 'RELEASED') ? (
                <QualityTestForm orderId={order.id} />
              ) : null}
            </div>
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
                  <th className="right">Usage variance</th>
                  <th className="right">Price variance</th>
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
                    <td className="num">{c.usageVarianceKobo ? formatNaira(c.usageVarianceKobo) : '—'}</td>
                    <td className="num">{c.priceVarianceKobo ? formatNaira(c.priceVarianceKobo) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Routing"
          subtitle={
            routing.length > 0
              ? `Conversion at standard: ${formatNaira(routingCost)}`
              : 'Labour and machine time this order absorbs, at the pool rates on the day it is taken on'
          }
          padded={false}
        >
          {routing.length === 0 ? (
            <div style={{ padding: 'var(--sp-5)' }} className="stack">
              <p className="faint">
                Not taken onto this order yet. Taking it on fixes the hours and the rates, so a
                later change to a pool&rsquo;s rate does not re-cost work already done.
              </p>
              {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' ? (
                <ProductionOrderActionButton
                  action={snapshotRouting}
                  id={order.id}
                  label="Take routing onto this order"
                  pendingLabel="Taking on…"
                  className="btn"
                />
              ) : null}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>#</th>
                    <th>Operation</th>
                    <th>Cost centre · pool</th>
                    <th className="right" style={{ width: 110 }}>Hours</th>
                    <th className="right" style={{ width: 130 }}>Rate / hour</th>
                    <th className="right" style={{ width: 130 }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {routing.map((line) => (
                    <tr key={line.id}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {line.routingOperation.sequence}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {line.routingOperation.operationName}
                        <div className="faint">{line.routingOperation.resourceType.toLowerCase()}</div>
                      </td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {line.routingOperation.costCentre.code} · {line.routingOperation.costPool.code}
                      </td>
                      <td className="num">{formatQuantity(line.standardHours, 2)}</td>
                      <td className="num">{formatNaira(line.ratePerHourKobo)}</td>
                      <td className="num">{formatNaira(line.standardCostKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                    <th>Grade</th>
                    <th>Use by</th>
                    <th className="right">°C</th>
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
                      <td>{o.grade ?? '—'}</td>
                      <td className="num">{o.expiryDate ? o.expiryDate.slice(0, 10) : '—'}</td>
                      <td className="num">{o.storageTemperatureC ?? '—'}</td>
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

function PlainStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="faint" style={{ fontSize: 12 }}>{hint}</div> : null}
    </div>
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
  routing,
  variance,
}: {
  order: NonNullable<Awaited<ReturnType<typeof getProductionOrder>>>;
  routing: Awaited<ReturnType<typeof getProductionRouting>>;
  variance: ProductionVariance | null;
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
        <IssueMaterialsForm
          orderId={order.id}
          lines={order.components.map((c) => ({
            id: c.id,
            label: `${c.componentItem.code} — ${c.componentItem.description}`,
            standardQuantity: c.plannedQuantity,
          }))}
        />
      );
    case 'RELEASED':
      return (
        <ConfirmConversionForm
          orderId={order.id}
          operations={routing.map((line) => ({
            name: line.routingOperation.operationName,
            standardHours: line.standardHours,
            ratePerHourKobo: line.ratePerHourKobo,
          }))}
        />
      );
    case 'IN_PRODUCTION':
      return (
        <RecordOutputsFormLoader order={order} />
      );
    case 'COMPLETED':
      return (
        <SettleOrderForm
          orderId={order.id}
          needsReason={Boolean(variance?.overTolerance && !variance.reason)}
          summary={
            variance
              ? `Total variance ${formatNaira(variance.totalKobo)}${variance.percent !== null ? ` is ${variance.percent}%` : ''} of standard good output — beyond the ${Number(variance.tolerancePercent)}% tolerance.`
              : null
          }
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
      coldStore={order.processingCycle === 'POULTRYPRO' && !!order.harvestRecord}
    />
  );
}
