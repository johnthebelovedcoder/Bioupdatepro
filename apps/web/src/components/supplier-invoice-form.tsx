'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card } from './ui';
import { formatNaira, parseNairaToKobo } from '@/lib/money';
import { recordSupplierInvoice, type FlowState } from '@/app/(app)/procurement/actions';
import type { ReceiptDetail } from '@/lib/procurement';

/**
 * Entering a supplier's invoice against what they actually delivered.
 *
 * This is the second half of GRNI: the receipt already posted
 * `Dr Inventory / Cr GRNI` at the price the order named. Entering the
 * invoice clears that GRNI balance at whatever the supplier actually billed —
 * a three-way match compares the two and reports any difference rather than
 * refusing it outright.
 *
 * Only lines with something still outstanding are shown, and the quantity
 * defaults to that outstanding amount — a supplier billing for exactly what
 * they delivered is the common case.
 */
export function SupplierInvoiceForm({ receipt, today }: { receipt: ReceiptDetail; today: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(recordSupplierInvoice, {
    error: null,
    message: null,
  });

  const billable = receipt.lines.filter((line) => Number(line.outstandingQuantity) > 0);

  return (
    <Card
      title={`Enter invoice against ${receipt.grnNumber}`}
      subtitle={`${receipt.supplier} — bill for what they delivered`}
    >
      <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
        <input type="hidden" name="goodsReceiptNoteId" value={receipt.id} />

        {state.error ? <div className="notice notice-error">{state.error}</div> : null}

        <div className="grid-auto">
          <label className="field">
            Supplier&rsquo;s invoice number
            <input name="supplierInvoiceNumber" placeholder="Their own reference" required />
          </label>
          <label className="field">
            Invoice date
            <input type="date" name="invoiceDate" defaultValue={today} required />
          </label>
        </div>

        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="right" style={{ width: 110 }}>
                  Still billable
                </th>
                <th style={{ width: 130 }}>Quantity</th>
                <th style={{ width: 160 }}>Unit price</th>
              </tr>
            </thead>
            <tbody>
              {billable.map((line) => (
                <LineRow key={line.id} line={line} />
              ))}
            </tbody>
          </table>
        </div>

        {billable.length === 0 ? (
          <div className="notice notice-warning">
            Everything on this receipt has already been billed for.
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 14 }}>
            If the price here differs from what the order named, that is reported as a
            mismatch rather than refused — it still needs approval either way.
          </p>
        )}

        <Submit disabled={billable.length === 0} />
      </form>
    </Card>
  );
}

function LineRow({ line }: { line: ReceiptDetail['lines'][number] }) {
  const outstanding = Number(line.outstandingQuantity);
  const [quantity, setQuantity] = useState(outstanding > 0 ? trim(outstanding) : '');
  const [price, setPrice] = useState(formatNaira(line.unitPriceKobo).replace(/[₦,]/g, ''));

  return (
    <tr>
      <td>
        <input type="hidden" name="lineId" value={line.id} />
        <span className="strong">{line.itemCode}</span>
        <div className="faint">{line.description}</div>
      </td>
      <td className="num">{trim(outstanding)}</td>
      <td>
        <input
          name={`quantity:${line.id}`}
          type="number"
          step="any"
          inputMode="decimal"
          min="0"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          style={{ minHeight: 0 }}
        />
      </td>
      <td>
        <input
          name={`price:${line.id}`}
          type="hidden"
          value={(parseNairaToKobo(price) ?? 0n).toString()}
        />
        <input
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          style={{ minHeight: 0 }}
        />
      </td>
    </tr>
  );
}

function trim(value: number): string {
  return String(Number(value.toFixed(6)));
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending || disabled}>
        {pending ? 'Recording…' : 'Enter the invoice'}
      </button>
    </div>
  );
}
