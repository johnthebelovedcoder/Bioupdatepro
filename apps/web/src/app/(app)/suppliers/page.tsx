import { api } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { SupplierForm } from '@/components/supplier-form';
import { Tabs } from '@/components/tabs';
import { TableSearch } from '@/components/table-search';
import { IconCart } from '@/components/icons';

export const metadata = { title: 'Vendors — BioAssetPro' };

interface ApiSupplier {
  id: string;
  code: string;
  name: string;
  status: string;
  tin: string | null;
  whtCategory: string | null;
  paymentTerm: string | null;
  netDays: number | null;
  creditLimitKobo: string | null;
}

/**
 * Vendors — the first master record the product lets a person create.
 *
 * The list reads from the database, so an empty farm shows an empty list. That
 * is the point: what is on this screen is what somebody typed, and nothing
 * else. Every count and every figure elsewhere in the product should be able
 * to make the same claim.
 */
export default async function SuppliersPage() {
  let suppliers: ApiSupplier[] = [];
  let error: string | null = null;

  try {
    suppliers = await api<ApiSupplier[]>('/masters/suppliers');
  } catch {
    error = 'Could not load your vendors.';
  }

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle="Everyone you buy from — feed, day-olds, medication, equipment"
      />

      <div className="stack">
        <Tabs />
        {error ? <div className="notice notice-error">{error}</div> : null}

        <SupplierForm />

        <TableSearch placeholder="Search vendors">
          <Card
            title={`${suppliers.length} ${suppliers.length === 1 ? 'vendor' : 'vendors'}`}
            padded={false}
          >
            {suppliers.length === 0 ? (
              <EmptyState
                icon={<IconCart size={22} />}
                title="No vendors yet"
                body="Register the first one above. Until a vendor exists you cannot raise a purchase, receive stock, or owe anybody money."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 160 }}>Code</th>
                      <th>Name</th>
                      <th>Supplies</th>
                      <th style={{ width: 140 }}>TIN</th>
                      <th style={{ width: 120 }}>Terms</th>
                      <th className="right" style={{ width: 140 }}>
                        Credit limit
                      </th>
                      <th style={{ width: 100 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suppliers.map((supplier) => (
                      <tr key={supplier.id}>
                        <td className="num strong" style={{ textAlign: 'left' }}>
                          {supplier.code}
                        </td>
                        <td>{supplier.name}</td>
                        <td className="faint">{supplier.whtCategory ?? '—'}</td>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {supplier.tin ?? '—'}
                        </td>
                        <td className="faint">
                          {supplier.netDays !== null ? `Net ${supplier.netDays}` : '—'}
                        </td>
                        <td className="num">
                          {supplier.creditLimitKobo
                            ? formatNaira(supplier.creditLimitKobo)
                            : '—'}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              supplier.status === 'ACTIVE' ? 'badge-success' : ''
                            }`}
                          >
                            {supplier.status.toLowerCase()}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TableSearch>
      </div>
    </>
  );
}
