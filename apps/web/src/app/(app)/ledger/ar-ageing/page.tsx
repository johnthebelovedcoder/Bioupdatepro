import { api, ApiError } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { getContext } from '@/lib/org';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { TableSearch } from '@/components/table-search';
import { IconTag } from '@/components/icons';

export const metadata = { title: 'AR ageing — BioAssetPro' };

interface AgeingBucket {
  label: string;
  amountKobo: string;
}

interface AgeingRow {
  customerCode: string;
  customerName: string;
  totalKobo: string;
  buckets: AgeingBucket[];
}

/**
 * Who owes the company, and how overdue — built weeks ago as part of
 * customer receipts, with no HTTP endpoint to reach it until now.
 */
export default async function ArAgeingPage() {
  const context = await getContext();

  if (!context.company) {
    return (
      <div className="notice notice-warning">
        No company has been set up yet. Run <code>npm run db:seed</code> first.
      </div>
    );
  }

  let rows: AgeingRow[] = [];
  let error: string | null = null;
  try {
    rows = await api<AgeingRow[]>('/reporting/ar-ageing');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not build the ageing report.';
  }

  const bucketLabels = rows[0]?.buckets.map((bucket) => bucket.label) ?? [];
  const totalKobo = rows.reduce((sum, row) => sum + BigInt(row.totalKobo), 0n);

  return (
    <div className="stack">
      <PageHeader title="AR ageing" subtitle="Who owes the company, and how overdue" />

      <Tabs />

      {error ? <div className="notice notice-error">{error}</div> : null}

      <TableSearch placeholder="Search customers">
        <Card
          title={`${rows.length} ${rows.length === 1 ? 'customer' : 'customers'} owing ${formatNaira(totalKobo.toString())}`}
          padded={false}
        >
          {rows.length === 0 ? (
            <EmptyState
              icon={<IconTag size={22} />}
              title="Nothing outstanding"
              body="No posted, unpaid invoices exist yet."
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Customer</th>
                    {bucketLabels.map((label) => (
                      <th key={label} className="right">
                        {label}
                      </th>
                    ))}
                    <th className="right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.customerCode}>
                      <td className="strong" style={{ textAlign: 'left' }}>
                        {row.customerCode}
                        <div className="faint">{row.customerName}</div>
                      </td>
                      {row.buckets.map((bucket) => (
                        <td key={bucket.label} className="num">
                          {formatNaira(bucket.amountKobo)}
                        </td>
                      ))}
                      <td className="num strong">{formatNaira(row.totalKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </TableSearch>
    </div>
  );
}
