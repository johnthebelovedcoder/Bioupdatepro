import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPurchaseOrder } from '@/lib/procurement';
import { formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { GoodsReceiptForm } from '@/components/goods-receipt-form';

export const metadata = { title: 'Receive goods — BioAssetPro' };

export default async function ReceiveGoodsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await getPurchaseOrder(id);
  if (!order) notFound();

  /*
   * An order that has not been approved cannot be received against, and the
   * page says so rather than showing a form that would be refused. The control
   * belongs before the goods, not after them.
   */
  if (!order.canReceive) {
    return (
      <>
        <PageHeader
          title={`Receive against ${order.orderNumber}`}
          subtitle={order.supplier}
        />
        <Card>
          <div className="notice notice-warning">
            {order.orderNumber} is {order.status.replace(/_/g, ' ').toLowerCase()}. Goods are
            only received against an approved order — receiving first would put the stock and
            the liability on the books before anybody agreed to buy them.
          </div>
          <p style={{ marginTop: 'var(--sp-4)' }}>
            <Link href="/procurement" className="btn">
              Back to buying
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
        title={`Receive against ${order.orderNumber}`}
        subtitle={`${order.supplier} — ${formatNaira(order.netKobo)} ordered`}
      />
      <div className="stack">
        <GoodsReceiptForm order={order} today={today} />
        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            Recording this creates a goods received note and sends it for confirmation. The
            ledger entry — <strong>Dr Inventory / Cr Goods Received Not Invoiced</strong> —
            fires when somebody else confirms it, which is why the person who accepted the
            delivery is not the person who approves it.
          </p>
        </Card>
      </div>
    </>
  );
}
