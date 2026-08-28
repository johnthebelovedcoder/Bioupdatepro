import { getPayableInvoices, getSupplierInvoices } from '@/lib/procurement';
import { getGlAccounts, getSuppliers } from '@/lib/trade';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconBox } from '@/components/icons';
import { SupplierPaymentForm } from '@/components/supplier-payment-form';
import { TableSearch } from '@/components/table-search';

export const metadata = { title: 'Supplier invoices — BioAssetPro' };

/**
 * What suppliers have billed the farm, and what is still owed.
 *
 * This is the far end of GRNI: a receipt posts `Dr Inventory / Cr GRNI`, an
 * invoice clears that GRNI balance against what the supplier actually billed,
 * and this list is where that balance turns into a payable — and, once paid,
 * into cash leaving the bank.
 */
export default async function SupplierInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ entered?: string; paid?: string }>;
}) {
  const [invoices, payable, suppliers, bankAccounts, query] = await Promise.all([
    getSupplierInvoices(),
    getPayableInvoices(),
    getSuppliers(),
    getGlAccounts(),
    searchParams,
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Supplier invoices"
        subtitle="What has been billed, what has cleared approval, and what is still owed"
      />

      <Tabs />

      <div className="stack">
        {query.entered ? (
          <div className="notice notice-success">
            Invoice entered. It now needs approval before it can be paid — until then it is
            billed but not yet payable.
          </div>
        ) : null}
        {query.paid ? (
          <div className="notice notice-success">
            Payment recorded. It needs approval before the cash actually moves.
          </div>
        ) : null}

        <TableSearch
          placeholder="Search invoices"
          actions={
            <SupplierPaymentForm
              suppliers={suppliers}
              invoices={payable}
              bankAccounts={bankAccounts}
              today={today}
            />
          }
        >
          <Card title="All invoices" padded={false}>
            {invoices.length === 0 ? (
              <EmptyState
                icon={<IconBox size={22} />}
                title="No invoices entered yet"
                body="Once a delivery has posted, enter the supplier's invoice against it from the goods received screen."
              />
            ) : (
              <div className="table-wrap">
                <table className="data wide">
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>Invoice</th>
                      <th>Supplier</th>
                      <th style={{ width: 110 }}>Date</th>
                      <th style={{ width: 110 }}>Status</th>
                      <th style={{ width: 110 }}>Match</th>
                      <th className="right" style={{ width: 130 }}>
                        Gross
                      </th>
                      <th className="right" style={{ width: 130 }}>
                        Outstanding
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="num strong" style={{ textAlign: 'left' }}>
                          {invoice.invoiceNumber}
                          <div className="faint">{invoice.supplierInvoiceNumber}</div>
                        </td>
                        <td>{invoice.supplier}</td>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {formatDate(invoice.invoiceDate)}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              invoice.status === 'APPROVED'
                                ? 'badge-success'
                                : invoice.status === 'REJECTED'
                                  ? 'badge-danger'
                                  : 'badge-warning'
                            }`}
                          >
                            {invoice.status.toLowerCase()}
                          </span>
                        </td>
                        <td>
                          {invoice.matchStatus ? (
                            <span
                              className={`badge ${
                                invoice.matchStatus === 'MATCHED' ? 'badge-success' : 'badge-warning'
                              }`}
                            >
                              {invoice.matchStatus.toLowerCase().replace(/_/g, ' ')}
                            </span>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                        <td className="num">{formatNaira(invoice.grossAmountKobo)}</td>
                        <td className="num">{formatNaira(invoice.outstandingKobo)}</td>
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
