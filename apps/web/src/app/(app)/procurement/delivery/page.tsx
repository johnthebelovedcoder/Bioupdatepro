import { api, ApiError } from '@/lib/api';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconBox } from '@/components/icons';

export const metadata = { title: 'Delivery performance — BioAssetPro' };

interface Row {
  supplier: string;
  orders: number;
  orderedQuantity: string;
  acceptedQuantity: string;
  fillRatePercent: string | null;
  rejectionRatePercent: string | null;
  onTimePercent: string | null;
  averageDaysLate: string | null;
  overdueOrders: string[];
}

const pct = (v: string | null) => (v === null ? '—' : `${v}%`);

/**
 * PO/GRN delivery performance (REPORT_KPI_CATALOG AGR-002): which suppliers
 * deliver short, deliver rejects, or deliver late — worst fill rate first.
 */
export default async function DeliveryPerformancePage() {
  let rows: Row[] = [];
  let error: string | null = null;
  try {
    rows = await api<Row[]>('/procurement/delivery-performance');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not load delivery performance.';
  }

  return (
    <>
      <PageHeader title="Delivery performance" subtitle="Which suppliers deliver short, reject-laden or late — worst first" />
      <Tabs />
      {error ? <div className="notice notice-error">{error}</div> : null}
      <Card
        title={`${rows.length} supplier${rows.length === 1 ? '' : 's'}`}
        subtitle="Fill rate is accepted against ordered; on time is the first posted receipt by the order’s expected date. Only posted receipts count."
        padded={false}
      >
        {rows.length === 0 ? (
          <EmptyState icon={<IconBox size={22} />} title="No approved orders yet" body="A supplier appears here once an order to them is approved." />
        ) : (
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="num">Orders</th>
                  <th className="num">Fill rate</th>
                  <th className="num">Rejected</th>
                  <th className="num">On time</th>
                  <th className="num">Days late (when late)</th>
                  <th>Overdue</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.supplier}>
                    <td>{r.supplier}</td>
                    <td className="num">{r.orders}</td>
                    <td className="num strong">{pct(r.fillRatePercent)}</td>
                    <td className="num">{pct(r.rejectionRatePercent)}</td>
                    <td className="num">{pct(r.onTimePercent)}</td>
                    <td className="num">{r.averageDaysLate ?? '—'}</td>
                    <td className="faint">{r.overdueOrders.length ? r.overdueOrders.join(', ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
