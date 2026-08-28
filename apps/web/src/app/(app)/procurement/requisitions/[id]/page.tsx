import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRequisition } from '@/lib/procurement';
import { getSuppliers } from '@/lib/trade';
import { Card, PageHeader } from '@/components/ui';
import { ConvertRequisitionForm } from '@/components/convert-requisition-form';

export const metadata = { title: 'Convert requisition — BioAssetPro' };

export default async function ConvertRequisitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [requisition, suppliers] = await Promise.all([getRequisition(id), getSuppliers()]);
  if (!requisition) notFound();

  if (!requisition.canConvert) {
    return (
      <>
        <PageHeader
          title={`Convert ${requisition.requisitionNumber}`}
          subtitle="Not yet approved"
        />
        <Card>
          <div className="notice notice-warning">
            {requisition.requisitionNumber} is {requisition.status.toLowerCase().replace(/_/g, ' ')}.
            A requisition has to be approved before it can become a purchase order.
          </div>
          <p style={{ marginTop: 'var(--sp-4)' }}>
            <Link href="/procurement/requisitions" className="btn">
              Back to requisitions
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
        title={`Convert ${requisition.requisitionNumber}`}
        subtitle="Name the supplier and the price for a purchase order"
      />
      <div className="stack">
        <ConvertRequisitionForm requisition={requisition} suppliers={suppliers} today={today} />
        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            This raises a purchase order and sends it for approval — nothing is committed until
            somebody else confirms it, the same as any other order.
          </p>
        </Card>
      </div>
    </>
  );
}
