'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card } from './ui';
import { formatNaira, parseNairaToKobo } from '@/lib/money';
import { recordSupplierPayment, type FlowState } from '@/app/(app)/procurement/actions';
import type { SupplierInvoice } from '@/lib/procurement';
import type { GlAccount } from '@/lib/trade';

interface SupplierOption {
  id: string;
  name: string;
}

/**
 * Paying a supplier against whichever of their invoices are approved.
 *
 * Approval is what makes an invoice payable — the list here is already
 * filtered to that, so choosing a supplier only ever shows money the farm has
 * actually agreed to owe them.
 */
export function SupplierPaymentForm({
  suppliers,
  invoices,
  bankAccounts,
  today,
}: {
  suppliers: SupplierOption[];
  invoices: SupplierInvoice[];
  bankAccounts: GlAccount[];
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(recordSupplierPayment, {
    error: null,
    message: null,
  });

  const payableSupplierIds = useMemo(
    () => new Set(invoices.map((invoice) => invoice.supplierId)),
    [invoices],
  );
  const payableSuppliers = suppliers.filter((supplier) => payableSupplierIds.has(supplier.id));

  const [supplierId, setSupplierId] = useState(payableSuppliers[0]?.id ?? '');
  const supplierInvoices = invoices.filter((invoice) => invoice.supplierId === supplierId);

  if (payableSuppliers.length === 0) {
    return (
      <Card title="Pay a supplier">
        <div className="notice notice-warning">
          Nothing is approved and payable yet. An invoice has to clear approval before it can be
          paid.
        </div>
      </Card>
    );
  }

  return (
    <Card title="Pay a supplier" subtitle="Only approved, unpaid invoices are shown">
      <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}

        <div className="grid-auto">
          <label className="field">
            Supplier
            <select
              name="supplierId"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              required
            >
              {payableSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Payment date
            <input type="date" name="paymentDate" defaultValue={today} required />
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
            Paid from
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
                <th style={{ width: 160 }}>Amount to pay</th>
              </tr>
            </thead>
            <tbody>
              {supplierInvoices.map((invoice) => (
                <InvoiceRow key={invoice.id} invoice={invoice} />
              ))}
            </tbody>
          </table>
        </div>

        <Submit />
      </form>
    </Card>
  );
}

function InvoiceRow({ invoice }: { invoice: SupplierInvoice }) {
  const [amount, setAmount] = useState(formatNaira(invoice.outstandingKobo).replace(/[₦,]/g, ''));

  return (
    <tr>
      <td>
        <input type="hidden" name="invoiceId" value={invoice.id} />
        <span className="strong">{invoice.invoiceNumber}</span>
        <div className="faint">{invoice.supplierInvoiceNumber}</div>
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
        {pending ? 'Recording…' : 'Record the payment'}
      </button>
    </div>
  );
}
