import { api } from '@/lib/api';
import { getGoodsReceipts } from '@/lib/procurement';
import type { SessionUser } from '@/lib/session';
import { formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { RaiseReturnForm, ReturnDecision, type ReturnableLine } from '@/components/supplier-return-forms';

export const metadata = { title: 'Returns to suppliers — BioAssetPro' };

interface ReturnRow {
  id: string;
  returnNumber: string;
  supplier: string;
  grnNumber: string;
  returnDate: string;
  reason: string;
  status: 'PENDING' | 'POSTED' | 'REJECTED';
  items: string[];
  stockValueKobo: string;
  debitNoteKobo: string;
  requestedById: string;
  decisionNote: string | null;
}

const TONE: Record<ReturnRow['status'], string> = { PENDING: 'badge-warning', POSTED: 'badge-success', REJECTED: 'badge-danger' };
const APPROVERS = ['FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO'];

/**
 * Returns to suppliers (handbook §35): goods sent back from a posted receipt,
 * with the debit note for anything already invoiced.
 */
export default async function SupplierReturnsPage({ searchParams }: { searchParams: Promise<{ grn?: string }> }) {
  const { grn } = await searchParams;
  const [returns, receipts, me] = await Promise.all([api<ReturnRow[]>('/procurement/returns'), getGoodsReceipts(), api<SessionUser>('/auth/me')]);
  const posted = receipts.filter((r) => r.status === 'POSTED');
  const returnable = grn
    ? await api<{ grnId: string; grnNumber: string; supplier: string; lines: ReturnableLine[] }>(`/procurement/receipts/${grn}/returnable`).catch(() => null)
    : null;
  const canDecide = me.roles.some((r) => APPROVERS.includes(r));

  return (
    <>
      <PageHeader title="Returns to suppliers" subtitle="Goods sent back from a delivery, and the debit note for anything already billed" />
      <Tabs />
      <div className="stack">
        <Card title="Return goods" subtitle="Choose the delivery they came on">
          <form className="row" style={{ gap: 'var(--sp-2)', alignItems: 'end', flexWrap: 'wrap', marginBottom: returnable ? 'var(--sp-4)' : 0 }}>
            <label className="field" style={{ margin: 0, minWidth: 320 }}>
              Delivery
              <select name="grn" defaultValue={grn ?? ''} required>
                <option value="" disabled>
                  A posted goods receipt
                </option>
                {posted.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.grnNumber} — {r.supplier}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn">
              Show items
            </button>
          </form>
          {returnable ? (
            returnable.lines.length ? (
              <RaiseReturnForm grnId={returnable.grnId} lines={returnable.lines} />
            ) : (
              <p className="faint">Nothing on {returnable.grnNumber} is a stock item that can be returned.</p>
            )
          ) : null}
        </Card>

        <Card title="Returns" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Return</th>
                  <th>Supplier · delivery</th>
                  <th>Items and reason</th>
                  <th className="right" style={{ width: 130 }}>Stock out</th>
                  <th className="right" style={{ width: 130 }}>Debit note</th>
                  <th style={{ width: 220 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {returns.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="faint">
                      Nothing returned yet.
                    </td>
                  </tr>
                ) : (
                  returns.map((r) => (
                    <tr key={r.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {r.returnNumber}
                        <div className="faint">{r.returnDate}</div>
                      </td>
                      <td>
                        {r.supplier}
                        <div className="faint">{r.grnNumber}</div>
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>
                        {r.items.join(', ')}
                        <div className="faint">{r.reason}</div>
                      </td>
                      <td className="num right">{r.status === 'POSTED' ? formatNaira(r.stockValueKobo) : '—'}</td>
                      <td className="num right">{r.status === 'POSTED' && r.debitNoteKobo !== '0' ? formatNaira(r.debitNoteKobo) : '—'}</td>
                      <td>
                        <span className={`badge ${TONE[r.status]}`}>{r.status.toLowerCase()}</span>
                        {r.decisionNote ? <div className="faint">{r.decisionNote}</div> : null}
                        {r.status === 'PENDING' && canDecide && r.requestedById !== me.userId ? <ReturnDecision id={r.id} /> : null}
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
