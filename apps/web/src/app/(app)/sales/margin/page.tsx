import { api, ApiError } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader, Stat } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconChart } from '@/components/icons';

export const metadata = { title: 'Sales margin — BioAssetPro' };

interface Row {
  key: string;
  label: string;
  quantity: string;
  revenueKobo: string;
  costOfSalesKobo: string;
  grossMarginKobo: string;
  grossMarginPercent: string | null;
}

interface Report {
  totals: { revenueKobo: string; costOfSalesKobo: string; grossMarginKobo: string; grossMarginPercent: string | null };
  byProduct: Row[];
  byCustomer: Row[];
}

/**
 * Sales, cost of sales and gross margin by product and by customer
 * (REPORT_KPI_CATALOG AGR-011), from posted invoices.
 */
export default async function SalesMarginPage() {
  let report: Report | null = null;
  let error: string | null = null;
  try {
    report = await api<Report>('/sales/margin');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not load the margins.';
  }

  const table = (title: string, rows: Row[], first: string) => (
    <Card title={title} padded={false}>
      {rows.length === 0 ? (
        <EmptyState icon={<IconChart size={22} />} title="Nothing invoiced yet" body="Posted sales invoices appear here with what they cost." />
      ) : (
        <div className="table-wrap">
          <table className="data wide">
            <thead>
              <tr>
                <th>{first}</th>
                <th className="num">Quantity</th>
                <th className="num">Sales</th>
                <th className="num">Cost of sales</th>
                <th className="num">Gross margin</th>
                <th className="num">Margin</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td className="num">{Number(r.quantity).toLocaleString('en-NG', { maximumFractionDigits: 3 })}</td>
                  <td className="num">{formatNaira(r.revenueKobo)}</td>
                  <td className="num">{formatNaira(r.costOfSalesKobo)}</td>
                  <td className="num strong">{formatNaira(r.grossMarginKobo)}</td>
                  <td className="num">{r.grossMarginPercent ? `${r.grossMarginPercent}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );

  return (
    <>
      <PageHeader title="Sales margin" subtitle="What each product and customer sold for, what it cost, and what was left" />
      <Tabs />
      {error ? <div className="notice notice-error">{error}</div> : null}
      {report ? (
        <div className="stack">
          <div className="stat-grid">
            <Stat label="Sales" value={formatNaira(report.totals.revenueKobo)} money />
            <Stat label="Cost of sales" value={formatNaira(report.totals.costOfSalesKobo)} money goodWhen="down" />
            <Stat label="Gross margin" value={formatNaira(report.totals.grossMarginKobo)} money hint={report.totals.grossMarginPercent ? `${report.totals.grossMarginPercent}% of sales` : undefined} />
          </div>
          {table('By product', report.byProduct, 'Product')}
          {table('By customer', report.byCustomer, 'Customer')}
          <p className="faint" style={{ fontSize: 13 }}>
            From posted invoices, net of VAT and discount. Cost is what each line took out of stock. Credit notes are shown where they are raised, not netted here.
          </p>
        </div>
      ) : null}
    </>
  );
}
