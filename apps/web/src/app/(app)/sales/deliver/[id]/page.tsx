import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSalesOrder } from '@/lib/sales';
import { formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { DeliveryForm } from '@/components/delivery-form';

export const metadata = { title: 'Ship goods — BioAssetPro' };

export default async function DeliverGoodsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getSalesOrder(id);
  if (!order) notFound();

  if (!order.canDeliver) {
    return (
      <>
        <PageHeader title={`Ship against ${order.orderNumber}`} subtitle={order.customer} />
        <Card>
          <div className="notice notice-warning">
            {order.orderNumber} is {order.status.replace(/_/g, ' ').toLowerCase()}. Goods are
            only shipped against an approved order — shipping first would put the sale on the
            books before anybody agreed to it.
          </div>
          <p style={{ marginTop: 'var(--sp-4)' }}>
            <Link href="/sales" className="btn">
              Back to selling
            </Link>
          </p>
        </Card>
      </>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title={`Ship against ${order.orderNumber}`}
        subtitle={`${order.customer} — ${formatNaira(order.netKobo)} ordered`}
      />
      <div className="stack">
        <DeliveryForm order={order} today={today} />
        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            Recording this creates a delivery note and sends it for confirmation. Whether the
            ledger moves here or waits for the invoice depends on when this company recognises
            cost of sales — either way, stock is relieved once this is confirmed.
          </p>
        </Card>
      </div>
    </>
  );
}
