import { getReceivableInvoices, getSalesInvoiceRows, getSalesOrders } from '@/lib/sales';
import { getCustomers, getGlAccounts } from '@/lib/trade';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconTag } from '@/components/icons';
import { CustomerReceiptForm } from '@/components/customer-receipt-form';
import { RaiseInvoiceButton } from '@/components/raise-invoice-button';
import { TableSearch } from '@/components/table-search';

export const metadata = { title: 'Sales invoices — BioAssetPro' };

/**
 * What customers have been billed, what has cleared approval, and what is
 * still owed.
 *
 * This is the far end of O2C: a delivery relieves inventory (and posts cost
 * of sales, depending on configuration), an invoice bills the customer for
 * what shipped, and this list is where that becomes a receivable — and,
 * once received, cash landing in the bank.
 */
export default async function SalesInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ invoiced?: string; received?: string }>;
}) {
  const [invoices, receivable, orders, customers, bankAccounts, query] = await Promise.all([
    getSalesInvoiceRows(),
    getReceivableInvoices(),
    getSalesOrders(),
    getCustomers(),
    getGlAccounts(),
    searchParams,
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const invoiceable = orders.filter((order) => order.canInvoice);

  return (
    <>
      <PageHeader
        title="Sales invoices"
        subtitle="What customers have been billed, what has cleared approval, and what is still owed"
      />

      <Tabs />

      <div className="stack">
        {query.invoiced ? (
          <div className="notice notice-success">
            Invoice raised. It now needs approval before it is a receivable — until then it is
            billed but not yet posted.
          </div>
        ) : null}
        {query.received ? (
          <div className="notice notice-success">
            Receipt recorded. It needs approval before the cash actually clears the customer's
            balance.
          </div>
        ) : null}

        {invoiceable.length > 0 ? (
          <Card
            title="Ready to invoice"
            subtitle="Orders with something shipped but not yet billed"
            padded={false}
          >
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Order</th>
                    <th>Customer</th>
                    <th style={{ width: 160 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceable.map((order) => (
                    <tr key={order.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {order.orderNumber}
                      </td>
                      <td>{order.customer}</td>
                      <td>
                        <RaiseInvoiceButton orderId={order.id} today={today} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : null}

        <TableSearch
          placeholder="Search invoices"
          actions={
            <CustomerReceiptForm
              customers={customers}
              invoices={receivable}
              bankAccounts={bankAccounts}
              today={today}
            />
          }
        >
          <Card title="All invoices" padded={false}>
            {invoices.length === 0 ? (
              <EmptyState
                icon={<IconTag size={22} />}
                title="No invoices raised yet"
                body="Once a delivery has posted, raise the invoice for it above."
              />
            ) : (
              <div className="table-wrap">
                <table className="data wide">
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>Invoice</th>
                      <th>Customer</th>
                      <th style={{ width: 110 }}>Date</th>
                      <th style={{ width: 110 }}>Status</th>
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
                          {invoice.orderNumber ? (
                            <div className="faint">{invoice.orderNumber}</div>
                          ) : null}
                        </td>
                        <td>{invoice.customer}</td>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {formatDate(invoice.invoiceDate)}
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              invoice.status === 'PAID'
                                ? 'badge-success'
                                : invoice.status === 'REJECTED'
                                  ? 'badge-danger'
                                  : invoice.status === 'POSTED' || invoice.status === 'PART_PAID'
                                    ? 'badge-accent'
                                    : 'badge-warning'
                            }`}
                          >
                            {invoice.status.toLowerCase().replace(/_/g, ' ')}
                          </span>
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
