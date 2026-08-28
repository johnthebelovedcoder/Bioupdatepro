'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { formatNaira, parseNairaToKobo } from '@/lib/money';
import { recordCustomerReceipt, type FlowState } from '@/app/(app)/sales/actions';
import type { SalesInvoiceRow } from '@/lib/sales';
import type { GlAccount } from '@/lib/trade';

interface CustomerOption {
  id: string;
  name: string;
}

/**
 * Receiving a customer's payment against whichever invoices are posted.
 *
 * The Buying-side mirror of `SupplierPaymentForm` — same shape, opposite
 * direction: money comes in instead of going out.
 */
export function CustomerReceiptForm({
  customers,
  invoices,
  bankAccounts,
  today,
}: {
  customers: CustomerOption[];
  invoices: SalesInvoiceRow[];
  bankAccounts: GlAccount[];
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(recordCustomerReceipt, {
    error: null,
    message: null,
  });

  const receivableCustomerIds = useMemo(
    () => new Set(invoices.map((invoice) => invoice.customerId)),
    [invoices],
  );
  const receivableCustomers = customers.filter((customer) => receivableCustomerIds.has(customer.id));

  const [customerId, setCustomerId] = useState(receivableCustomers[0]?.id ?? '');
  const customerInvoices = invoices.filter((invoice) => invoice.customerId === customerId);
  const [open, setOpen] = useState(false);

  if (receivableCustomers.length === 0) {
    return (
      <div className="notice notice-warning">
        Nothing is posted and outstanding yet. An invoice has to clear approval before a payment
        can be received against it.
      </div>
    );
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Receive a payment
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Receive a payment">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">Only posted, unpaid invoices are shown.</p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <div className="grid-auto">
            <label className="field">
              Customer
              <select
                name="customerId"
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
                required
              >
                {receivableCustomers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Receipt date
              <input type="date" name="receiptDate" defaultValue={today} required />
            </label>
            <label className="field">
              Method
              <select name="method" defaultValue="BANK_TRANSFER">
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </label>
            <label className="field">
              Received into
              <select name="bankGlAccountId" defaultValue="" required>
                <option value="" disabled>
                  Choose an account
                </option>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.accountNumber} — {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Reference<span className="faint"> (optional)</span>
              <input name="reference" placeholder="Transfer or cheque reference" />
            </label>
          </div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th className="right" style={{ width: 130 }}>
                    Outstanding
                  </th>
                  <th style={{ width: 160 }}>Amount received</th>
                </tr>
              </thead>
              <tbody>
                {customerInvoices.map((invoice) => (
                  <InvoiceRow key={invoice.id} invoice={invoice} />
                ))}
              </tbody>
            </table>
          </div>

          <Submit />
        </form>
      </Sheet>
    </>
  );
}

function InvoiceRow({ invoice }: { invoice: SalesInvoiceRow }) {
  const [amount, setAmount] = useState(formatNaira(invoice.outstandingKobo).replace(/[₦,]/g, ''));

  return (
    <tr>
      <td>
        <input type="hidden" name="invoiceId" value={invoice.id} />
        <span className="strong">{invoice.invoiceNumber}</span>
        {invoice.orderNumber ? <div className="faint">{invoice.orderNumber}</div> : null}
      </td>
      <td className="num">{formatNaira(invoice.outstandingKobo)}</td>
      <td>
        <input
          name={`amount:${invoice.id}`}
          type="hidden"
          value={(parseNairaToKobo(amount) ?? 0n).toString()}
        />
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          style={{ minHeight: 0 }}
        />
      </td>
    </tr>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Recording…' : 'Record the receipt'}
      </button>
    </div>
  );
}
