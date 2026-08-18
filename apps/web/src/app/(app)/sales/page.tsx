import { getCustomers, getReceivablesAgeing, getSalesInvoices } from '@/lib/demo-trade';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import Link from 'next/link';
import { Tabs, MONEY_TABS } from '@/components/tabs';
import { IconPlus } from '@/components/icons';

export const metadata = { title: 'Sales — BioAssetPro' };

const STATUS_TONE: Record<string, string> = {
  DRAFT: '',
  UNPAID: 'badge-warning',
  PART_PAID: 'badge-warning',
  PAID: 'badge-success',
  OVERDUE: 'badge-danger',
};

export default async function SalesPage() {
  const [invoices, customers, ageing] = await Promise.all([
    getSalesInvoices(),
    getCustomers(),
    getReceivablesAgeing(),
  ]);

  const outstanding = invoices.reduce((sum, invoice) => sum + toKobo(invoice.outstandingKobo), 0n);
  const overdue = invoices
    .filter((invoice) => invoice.status === 'OVERDUE')
    .reduce((sum, invoice) => sum + toKobo(invoice.outstandingKobo), 0n);
  const billed = invoices.reduce((sum, invoice) => sum + toKobo(invoice.totalKobo), 0n);
  const ageingTotal = ageing.reduce((sum, bucket) => sum + toKobo(bucket.amountKobo), 0n);

  return (
    <>
      <PageHeader
        title="Sales"
        subtitle="Customers, invoices and what is still owed"
        actions={
          <>
            <Link className="btn btn-primary" href="/sales/new">
              <IconPlus size={16} />
              Record a sale
            </Link>
          </>
        }
      />

      <Tabs tabs={MONEY_TABS} />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Invoiced" value={formatNaira(billed)} money hint="all shown" />
          <Stat label="Outstanding" value={formatNaira(outstanding)} money goodWhen="down" />
          <Stat
            label="Overdue"
            value={formatNaira(overdue)}
            money
            goodWhen="down"
            hint="past due date"
          />
          <Stat label="Customers" value={String(customers.length)} />
        </div>

        <div className="two-col">
          <Card title="Invoices" padded={false}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Invoice</th>
                    <th>Customer</th>
                    <th style={{ width: 100 }}>Due</th>
                    <th className="right" style={{ width: 130 }}>
                      Outstanding
                    </th>
                    <th style={{ width: 110 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {invoice.number}
                        <div className="faint">{formatDate(invoice.issuedOn)}</div>
                      </td>
                      <td>{invoice.customer}</td>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(invoice.dueOn)}
                      </td>
                      <td className="num">
                        {toKobo(invoice.outstandingKobo) === 0n ? (
                          <span className="num-zero">—</span>
                        ) : (
                          formatNaira(invoice.outstandingKobo)
                        )}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_TONE[invoice.status] ?? ''}`}>
                          {invoice.status.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Receivables ageing" subtitle="From the due date">
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              {ageing.map((bucket) => {
                const amount = toKobo(bucket.amountKobo);
                const share = ageingTotal > 0n ? Number((amount * 100n) / ageingTotal) : 0;
                const late = bucket.label !== 'Not yet due' && amount > 0n;
                return (
                  <div key={bucket.label}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 14 }}>{bucket.label}</span>
                      <span className="num" style={{ fontSize: 13 }}>
                        {formatNaira(bucket.amountKobo)}
                      </span>
                    </div>
                    <div className="meter">
                      <div
                        className={`meter-fill ${late ? 'is-low' : ''}`}
                        style={{ width: `${share}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <p className="faint">
                Aged from the DUE date, not the invoice date — an invoice on 60-day terms is
                not late on day 31.
              </p>
            </div>
          </Card>
        </div>

        <Card title="Customers" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th style={{ width: 140 }}>Type</th>
                  <th style={{ width: 150 }}>Phone</th>
                  <th style={{ width: 110 }}>Last order</th>
                  <th className="right" style={{ width: 130 }}>
                    Balance
                  </th>
                  <th className="right" style={{ width: 130 }}>
                    Overdue
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td className="strong">{customer.name}</td>
                    <td className="faint">{customer.type}</td>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {customer.phone}
                    </td>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(customer.lastOrderOn)}
                    </td>
                    <td className="num">
                      {toKobo(customer.balanceKobo) === 0n ? (
                        <span className="num-zero">—</span>
                      ) : (
                        formatNaira(customer.balanceKobo)
                      )}
                    </td>
                    <td className="num">
                      {toKobo(customer.overdueKobo) === 0n ? (
                        <span className="num-zero">—</span>
                      ) : (
                        <span style={{ color: 'var(--error-700)' }}>
                          {formatNaira(customer.overdueKobo)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-footer">
            <span className="faint">
              Customer balances are a view over the ledger, not a separate figure that can
              drift away from it.
            </span>
          </div>
        </Card>

        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            The sales pipeline already exists in the backend and is tested — quotation,
            order, delivery note, invoice, receipt, allocation, credit note and returns,
            including where cost of sales is recognised. Only the interface is missing.
          </p>
        </Card>
      </div>
    </>
  );
}
