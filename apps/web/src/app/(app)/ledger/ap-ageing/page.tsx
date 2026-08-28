import { api, ApiError } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { getContext } from '@/lib/org';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { TableSearch } from '@/components/table-search';
import { IconCart } from '@/components/icons';

export const metadata = { title: 'AP ageing — BioAssetPro' };

interface AgeingBucket {
  label: string;
  amountKobo: string;
}

interface AgeingRow {
  supplierCode: string;
  supplierName: string;
  totalKobo: string;
  buckets: AgeingBucket[];
}

/**
 * Who the company owes, and how overdue — the AP mirror of AR ageing, same
 * stranded-service pattern: built as part of supplier payments, no HTTP
 * endpoint until now.
 */
export default async function ApAgeingPage() {
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
    rows = await api<AgeingRow[]>('/reporting/ap-ageing');
  } catch (caught) {
    error = caught instanceof ApiError ? caught.message : 'Could not build the ageing report.';
  }

  const bucketLabels = rows[0]?.buckets.map((bucket) => bucket.label) ?? [];
  const totalKobo = rows.reduce((sum, row) => sum + BigInt(row.totalKobo), 0n);

  return (
    <div className="stack">
      <PageHeader title="AP ageing" subtitle="Who the company owes, and how overdue" />

      <Tabs />

      {error ? <div className="notice notice-error">{error}</div> : null}

      <TableSearch placeholder="Search suppliers">
        <Card
          title={`${rows.length} ${rows.length === 1 ? 'supplier' : 'suppliers'} owed ${formatNaira(totalKobo.toString())}`}
          padded={false}
        >
          {rows.length === 0 ? (
            <EmptyState
              icon={<IconCart size={22} />}
              title="Nothing outstanding"
              body="No posted, unpaid invoices exist yet."
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Supplier</th>
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
                    <tr key={row.supplierCode}>
                      <td className="strong" style={{ textAlign: 'left' }}>
                        {row.supplierCode}
                        <div className="faint">{row.supplierName}</div>
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
