import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGoodsReceipt } from '@/lib/procurement';
import { Card, PageHeader } from '@/components/ui';
import { SupplierInvoiceForm } from '@/components/supplier-invoice-form';

export const metadata = { title: "Enter supplier invoice — BioAssetPro" };

export default async function ReceiptInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const receipt = await getGoodsReceipt(id);
  if (!receipt) notFound();

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title={`Enter invoice against ${receipt.grnNumber}`}
        subtitle={`${receipt.supplier} — order ${receipt.orderNumber}`}
      />
      <div className="stack">
        <SupplierInvoiceForm receipt={receipt} today={today} />
        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            This clears the Goods Received Not Yet Invoiced balance the delivery created, and
            sends the invoice for approval — nothing is owed to the supplier until somebody
            else confirms it.
          </p>
          <p style={{ marginTop: 'var(--sp-4)' }}>
            <Link href="/procurement/receipts" className="btn">
              Back to deliveries
            </Link>
          </p>
        </Card>
      </div>
    </>
  );
}
