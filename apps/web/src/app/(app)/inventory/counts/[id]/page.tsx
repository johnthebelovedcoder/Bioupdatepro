import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { CountActions, CountSheet, type CountLine } from '@/components/stock-count-forms';

export const metadata = { title: 'Stock count — BioAssetPro' };

interface CountDetail {
  id: string;
  reference: string;
  store: string;
  status: string;
  recountThresholdPercent: string;
  frozenAt: string;
  startedBy: string | null;
  submittedBy: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  netAdjustmentKobo: string;
  lines: CountLine[];
}

const EXPLAIN: Record<string, string> = {
  COUNTING: 'Counting. The store is frozen: nothing moves in or out.',
  SUBMITTED: 'Submitted. Someone other than the counter approves it, holds it for investigation, or cancels it.',
  ON_HOLD: 'Held for investigation. The store stays frozen until the count is approved or cancelled.',
  POSTED: 'Approved and posted. The store is open again.',
  CANCELLED: 'Cancelled. Nothing was posted; the store is open again.',
};

export default async function StockCountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let count: CountDetail;
  try {
    count = await api<CountDetail>(`/inventory/counts/${id}`);
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) notFound();
    throw caught;
  }
  const differences = count.lines.filter((l) => l.varianceQuantity !== null && Number(l.varianceQuantity) !== 0);

  return (
    <>
      <PageHeader
        title={count.reference}
        subtitle={`${count.store} · frozen ${count.frozenAt.slice(0, 16).replace('T', ' ')}`}
        actions={<Link href="/inventory/counts" className="btn btn-ghost">All counts</Link>}
      />
      <Tabs />
      <div className="stack">
        <Card title="Status">
          <p style={{ marginTop: 0 }}>{EXPLAIN[count.status] ?? count.status}</p>
          <p className="faint">
            Started by {count.startedBy}
            {count.submittedBy ? ` · submitted by ${count.submittedBy}` : ''}
            {count.decidedBy ? ` · decided by ${count.decidedBy}` : ''}
            {count.decisionNote ? ` — ${count.decisionNote}` : ''}
          </p>
          {count.status !== 'COUNTING' && count.status !== 'CANCELLED' ? (
            <p>
              {differences.length} difference{differences.length === 1 ? '' : 's'}, net <strong>{formatNaira(count.netAdjustmentKobo)}</strong> (negative is a shortage).
            </p>
          ) : null}
          <CountActions countId={count.id} status={count.status} />
        </Card>
        <Card title="Count sheet" subtitle={`Differences beyond ${Number(count.recountThresholdPercent)}% of the book are counted again`}>
          <CountSheet countId={count.id} status={count.status} lines={count.lines} />
        </Card>
      </div>
    </>
  );
}
