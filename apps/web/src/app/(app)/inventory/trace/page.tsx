import { api, ApiError } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { DownloadTrace, TraceTree, type TraceNode } from '@/components/trace-view';

export const metadata = { title: 'Trace a lot — BioAssetPro' };

interface TraceResult {
  reference: string;
  resolvedAs: string;
  tree: TraceNode;
}

/**
 * Lot traceability (AC-011): from a sale back through stock, production,
 * harvest and the population to its origin, feed, treatments and the goods
 * receipts behind every input — one search, one file.
 */
export default async function TracePage({ searchParams }: { searchParams: Promise<{ reference?: string }> }) {
  const { reference = '' } = await searchParams;
  let result: TraceResult | null = null;
  let error: string | null = null;
  if (reference.trim()) {
    try {
      result = await api<TraceResult>(`/traceability?reference=${encodeURIComponent(reference.trim())}`);
    } catch (caught) {
      error = caught instanceof ApiError ? caught.message : 'Could not trace that.';
    }
  }

  return (
    <>
      <PageHeader title="Trace a lot" subtitle="From a sale back to the harvest, the animals and every input's supplier" />
      <Tabs />
      <div className="stack">
        <Card>
          <form method="get" className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '1 1 320px' }}>
              Delivery, invoice, lot, production order or population
              <input name="reference" defaultValue={reference} placeholder="e.g. DN-…, INV-…, a lot number, PRO-…, MKT-1" required />
            </label>
            <button type="submit" className="btn btn-primary">
              Trace
            </button>
          </form>
          <p className="faint" style={{ marginBottom: 0 }}>
            Stock is valued at moving average, so a unit carries no lot of its own. What was issued is matched to what had been
            received, first in first out within each store, with a lot named on the issue taken first.
          </p>
        </Card>

        {error ? <div className="notice notice-error">{error}</div> : null}

        {result ? (
          <Card
            title={`${result.resolvedAs} ${result.reference}`}
            action={<DownloadTrace tree={result.tree} reference={result.reference} />}
          >
            <TraceTree tree={result.tree} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
