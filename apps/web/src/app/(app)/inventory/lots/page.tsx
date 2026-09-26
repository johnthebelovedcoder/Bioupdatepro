import { api } from '@/lib/api';
import { getStockItems } from '@/lib/masters';
import type { SessionUser } from '@/lib/session';
import { formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { ItemControlsForm, LotDecision } from '@/components/lot-forms';

export const metadata = { title: 'Lots and expiry — BioAssetPro' };

interface LotRow {
  lotId: string | null;
  itemCode: string;
  description: string;
  unit: string;
  store: string;
  lotReference: string | null;
  receivedOn: string;
  ageDays: number;
  expiryDate: string | null;
  daysToExpiry: number | null;
  status: 'AVAILABLE' | 'QUARANTINE' | 'REJECTED' | 'EXPIRED' | 'NO_LOT';
  blocked: string | null;
  quantity: string;
  valueKobo: string | null;
  receivedById: string | null;
  decisionNote: string | null;
}

const STATUS: Record<LotRow['status'], { text: string; tone: string }> = {
  AVAILABLE: { text: 'usable', tone: 'badge-success' },
  QUARANTINE: { text: 'quarantine', tone: 'badge-warning' },
  REJECTED: { text: 'rejected', tone: 'badge-danger' },
  EXPIRED: { text: 'expired', tone: 'badge-danger' },
  NO_LOT: { text: 'no lot', tone: '' },
};
const DECIDERS = ['QA_OFFICER', 'FARM_MANAGER', 'PRODUCTION_LEAD', 'FINANCE_CONTROLLER', 'CFO'];

/**
 * Lots, expiry and quarantine (handbook §35, §59.3 "Inventory Ageing/Expiry",
 * FR-FM-02). Issues take the earliest-expiring usable lot first; expired,
 * quarantined and rejected lots cannot be issued, only written off, returned
 * or counted.
 */
export default async function LotsPage({ searchParams }: { searchParams: Promise<{ within?: string }> }) {
  const { within } = await searchParams;
  const days = within && /^\d+$/.test(within) ? within : '';
  const [rows, items, me] = await Promise.all([
    api<LotRow[]>(`/inventory/lots${days ? `?within=${days}` : ''}`),
    getStockItems(),
    api<SessionUser>('/auth/me'),
  ]);
  const canDecide = me.roles.some((r) => DECIDERS.includes(r));
  const blocked = rows.filter((r) => r.blocked);

  return (
    <>
      <PageHeader title="Lots and expiry" subtitle="What each lot holds, how long it has left, and what is held in quarantine" />
      <Tabs />
      <div className="stack">
        {blocked.length > 0 ? (
          <div className="notice notice-warning">
            {blocked.length} lot{blocked.length === 1 ? ' is' : 's are'} expired, in quarantine or rejected and cannot be issued. Expired and rejected
            stock is written off (Store → Transfers) or returned (Buying → Returns).
          </div>
        ) : null}
        <Card title="Lots in stock" subtitle="Soonest to expire first" padded={false}>
          <form className="row" style={{ gap: 'var(--sp-2)', padding: 'var(--sp-3) var(--sp-4)', alignItems: 'end', flexWrap: 'wrap' }}>
            <label className="field" style={{ margin: 0 }}>
              Expiring within (days)
              <input type="number" name="within" min="0" defaultValue={days} placeholder="all" />
            </label>
            <button type="submit" className="btn">
              Show
            </button>
          </form>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ width: 170 }}>Lot</th>
                  <th>Store</th>
                  <th className="right" style={{ width: 110 }}>Quantity</th>
                  <th className="right" style={{ width: 120 }}>Value</th>
                  <th className="right" style={{ width: 80 }}>Age</th>
                  <th style={{ width: 130 }}>Use by</th>
                  <th style={{ width: 230 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="faint">
                      No lot-controlled stock{days ? ` expiring within ${days} days` : ''}.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={`${r.lotReference ?? 'none'}-${r.store}-${r.itemCode}-${i}`}>
                      <td style={{ textAlign: 'left' }}>
                        {r.itemCode} — {r.description}
                      </td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {r.lotReference ?? '—'}
                      </td>
                      <td>{r.store}</td>
                      <td className="num right">
                        {Number(r.quantity).toLocaleString('en-NG')} {r.unit}
                      </td>
                      <td className="num right">{r.valueKobo ? formatNaira(r.valueKobo) : '—'}</td>
                      <td className="num right">{r.ageDays}d</td>
                      <td className="num">
                        {r.expiryDate ?? '—'}
                        {r.daysToExpiry !== null && r.daysToExpiry >= 0 ? <div className="faint">{r.daysToExpiry} days left</div> : null}
                      </td>
                      <td>
                        <span className={`badge ${STATUS[r.status].tone}`}>{STATUS[r.status].text}</span>
                        {r.decisionNote ? <div className="faint">{r.decisionNote}</div> : null}
                        {r.status === 'QUARANTINE' && r.lotId && canDecide && r.receivedById !== me.userId ? <LotDecision id={r.lotId} /> : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Stock controls for an item" subtitle="A shelf life dates every receipt and milling that has no date of its own">
          <ItemControlsForm items={items.map((i) => ({ id: i.id, label: `${i.code} — ${i.name}` }))} />
        </Card>
      </div>
    </>
  );
}
