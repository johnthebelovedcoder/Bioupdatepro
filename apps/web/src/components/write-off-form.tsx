'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { writeOffStock, type FlowState } from '@/app/(app)/inventory/transfers/actions';
import type { StockItem, Warehouse } from '@/lib/masters';

/** Remove stock with a reason — PCR-014 requires count evidence or an approved cause, not a silent adjustment. */
export function WriteOffForm({ items, warehouses }: { items: StockItem[]; warehouses: Warehouse[] }) {
  const [state, formAction] = useActionState<FlowState, FormData>(writeOffStock, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Write off stock
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Write off stock">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            Posts immediately — a write-off is not sent for approval, so a reason is required
            in its place.
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
            Store
            <select name="warehouseId" defaultValue="" required>
              <option value="" disabled>
                Which store it is coming out of
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
          <label className="field">
            Reason
            <input name="reason" placeholder="Count evidence, damage, obsolescence" required />
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
    <button type="submit" className="btn btn-danger" disabled={pending}>
      {pending ? 'Writing off…' : 'Write off'}
    </button>
  );
}
