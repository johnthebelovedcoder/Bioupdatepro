import Link from 'next/link';
import { api } from '@/lib/api';
import { getWarehouses } from '@/lib/masters';
import { formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { StartCountForm } from '@/components/stock-count-forms';

export const metadata = { title: 'Stock counts — BioAssetPro' };

interface CountRow {
  id: string;
  reference: string;
  store: string;
  status: string;
  lines: number;
  frozenAt: string;
  netAdjustmentKobo: string;
}

const TONE: Record<string, string> = { POSTED: 'badge-success', CANCELLED: '', ON_HOLD: 'badge-danger', SUBMITTED: 'badge-warning', COUNTING: 'badge-warning' };

/**
 * Stock counts (INT-009): what each store physically holds against the book,
 * adjusted only once someone other than the counter approves.
 */
export default async function StockCountsPage() {
  const [counts, stores] = await Promise.all([api<CountRow[]>('/inventory/counts'), getWarehouses()]);
  return (
    <>
      <PageHeader title="Stock counts" subtitle="Count a store against its book; differences post only once approved" />
      <Tabs />
      <div className="stack">
        <Card title="Start a count">
          <StartCountForm stores={stores.filter((s) => s.active).map((s) => ({ id: s.id, label: `${s.code} — ${s.name}` }))} />
        </Card>
        <Card title="Counts" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Count</th>
                  <th>Store</th>
                  <th style={{ width: 110 }}>Started</th>
                  <th className="right" style={{ width: 90 }}>Items</th>
                  <th className="right" style={{ width: 150 }}>Net adjustment</th>
                  <th style={{ width: 130 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {counts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="faint">
                      No counts yet.
                    </td>
                  </tr>
                ) : (
                  counts.map((c) => (
                    <tr key={c.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        <Link href={`/inventory/counts/${c.id}`}>{c.reference}</Link>
                      </td>
                      <td>{c.store}</td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {c.frozenAt.slice(0, 10)}
                      </td>
                      <td className="num right">{c.lines}</td>
                      <td className="num right">{c.status === 'COUNTING' ? '—' : formatNaira(c.netAdjustmentKobo)}</td>
                      <td>
                        <span className={`badge ${TONE[c.status] ?? ''}`}>{c.status.toLowerCase().replace('_', ' ')}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
