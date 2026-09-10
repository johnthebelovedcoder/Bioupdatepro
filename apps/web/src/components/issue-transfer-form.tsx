'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { issueTransfer, type FlowState } from '@/app/(app)/inventory/transfers/actions';
import type { StockItem, Warehouse } from '@/lib/masters';

/** Move stock from one store to another. Nothing moves until the other end receives it. */
export function IssueTransferForm({ items, warehouses }: { items: StockItem[]; warehouses: Warehouse[] }) {
  const [state, formAction] = useActionState<FlowState, FormData>(issueTransfer, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Transfer stock
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Transfer stock between stores">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            Issued now, received separately at the other end — the person who moved it is not
            the person who confirms it arrived.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Item
            <select name="itemId" defaultValue="" required>
              <option value="" disabled>
                Choose an item
              </option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} — {item.onHand.toLocaleString('en-NG')} {item.unit} on hand
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            From store
            <select name="fromWarehouseId" defaultValue="" required>
              <option value="" disabled>
                Where it is leaving
              </option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            To store
            <select name="toWarehouseId" defaultValue="" required>
              <option value="" disabled>
                Where it is going
              </option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Quantity
            <input type="number" name="quantity" min="0" step="0.000001" placeholder="0" required />
          </label>

          <Submit />
        </form>
      </Sheet>
    </>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Issuing…' : 'Issue transfer'}
    </button>
  );
}
