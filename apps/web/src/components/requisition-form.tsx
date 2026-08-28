'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card } from './ui';
import { raiseRequisition, type FlowState } from '@/app/(app)/procurement/actions';
import type { Product } from '@/lib/demo-products';

/**
 * Requesting what the farm needs, before any supplier or price is decided.
 *
 * This is deliberately the first, separate step the client asked for — "raise
 * a purchase requisition, convert that purchase requisition to a PO" — rather
 * than folding straight into an order. A requisition commits nothing: no
 * supplier, no price, no ledger entry. It is only a record of what somebody
 * needs, sent for approval before any money is discussed.
 */
export function RequisitionForm({ items, today }: { items: Product[]; today: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(raiseRequisition, {
    error: null,
    message: null,
  });
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? items.filter(
        (item) =>
          item.name.toLowerCase().includes(query.toLowerCase()) ||
          item.code.toLowerCase().includes(query.toLowerCase()),
      )
    : items;

  return (
    <Card title="Raise a requisition" subtitle="What is needed — not yet what it costs or who supplies it">
      <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}

        <div className="grid-auto">
          <label className="field">
            Date needed by<span className="faint"> (optional)</span>
            <input type="date" name="requiredDate" min={today} />
          </label>
          <label className="field">
            Why<span className="faint"> (optional)</span>
            <input name="justification" placeholder="What this is for" />
          </label>
        </div>
        <input type="hidden" name="requestDate" value={today} />

        <label className="field">
          Find an item
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or code"
          />
        </label>

        <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ width: 130 }}>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input type="hidden" name="itemId" value={item.id} />
                    <span className="strong">{item.code}</span>
                    <div className="faint">{item.name}</div>
                  </td>
                  <td>
                    <input
                      name={`quantity:${item.id}`}
                      type="number"
                      step="any"
                      inputMode="decimal"
                      min="0"
                      placeholder="0"
                      style={{ minHeight: 0 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Submit />
      </form>
    </Card>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Raising…' : 'Raise the requisition'}
      </button>
    </div>
  );
}
