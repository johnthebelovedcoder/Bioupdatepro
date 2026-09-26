import { api } from '@/lib/api';
import { getStockItems } from '@/lib/masters';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { QualitySpecForm } from '@/components/feed-mill-forms';

export const metadata = { title: 'Feed quality — BioAssetPro' };

interface Spec {
  id: string;
  itemId: string;
  itemCode: string;
  description: string;
  minProteinPercent: string | null;
  maxMoisturePercent: string | null;
  maxAflatoxinPpb: string | null;
  samplingNote: string | null;
}

/**
 * Feed quality plan (handbook §26): the limits each finished feed must meet.
 * A feed with limits stays in quarantine after milling — it is received into
 * stock only once a sample passes and someone other than the tester releases
 * it, on the milling order's own page.
 */
export default async function FeedQualityPage() {
  const [specs, items] = await Promise.all([api<Spec[]>('/feed-mill/quality/specs'), getStockItems()]);
  return (
    <>
      <PageHeader title="Feed quality" subtitle="The limits a milled feed must meet before it can be issued to a flock" />
      <Tabs />
      <div className="stack">
        <Card title="Set a feed's limits" subtitle="Leave a limit blank to not test it">
          <QualitySpecForm items={items.map((i) => ({ id: i.id, label: `${i.code} — ${i.name}` }))} />
        </Card>
        <Card title="Limits in force" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Feed</th>
                  <th className="right" style={{ width: 140 }}>Protein at least</th>
                  <th className="right" style={{ width: 140 }}>Moisture at most</th>
                  <th className="right" style={{ width: 150 }}>Aflatoxin at most</th>
                  <th>Sampling</th>
                </tr>
              </thead>
              <tbody>
                {specs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="faint">
                      No feed has limits yet, so milled feed goes straight into stock.
                    </td>
                  </tr>
                ) : (
                  specs.map((s) => (
                    <tr key={s.id}>
                      <td style={{ textAlign: 'left' }}>
                        {s.itemCode} — {s.description}
                      </td>
                      <td className="num right">{s.minProteinPercent ? `${s.minProteinPercent}%` : '—'}</td>
                      <td className="num right">{s.maxMoisturePercent ? `${s.maxMoisturePercent}%` : '—'}</td>
                      <td className="num right">{s.maxAflatoxinPpb ? `${s.maxAflatoxinPpb} ppb` : '—'}</td>
                      <td>{s.samplingNote ?? '—'}</td>
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
