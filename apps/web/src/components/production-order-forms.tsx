'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  confirmConversion,
  recordLoss,
  recordOutputs,
  type FlowState,
} from '@/app/(app)/production/actions';
import type { Warehouse } from '@/lib/masters';

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

/** RELEASED → IN_PRODUCTION: post standard absorption plus the actual labour/overhead cost. */
export function ConfirmConversionForm({
  orderId,
  operations = [],
}: {
  orderId: string;
  /** The order's routing: with one, the standard is actual hours × approved rates (PCR-053). */
  operations?: Array<{ name: string; standardHours: string; ratePerHourKobo: string }>;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(confirmConversion, {
    error: null,
    message: null,
  });

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}

      {operations.length > 0 ? (
        <>
          <p className="faint" style={{ fontSize: 13 }}>
            The standard is worked out from the routing: the hours each operation actually took, at its cost pool&rsquo;s
            approved rate. Leave an operation blank to use its standard hours.
          </p>
          {operations.map((op) => (
            <label key={op.name} className="field">
              {op.name} — hours (standard {Number(op.standardHours).toLocaleString('en-NG')}, ₦
              {(Number(op.ratePerHourKobo) / 100).toLocaleString('en-NG')}/h)
              <input name={`hours:${op.name}`} type="number" step="0.01" min="0" placeholder={op.standardHours} />
            </label>
          ))}
        </>
      ) : (
        <label className="field">
          Standard conversion cost (₦)
          <input name="standardConversionCost" type="number" step="0.01" min="0" required />
          <span className="faint">This recipe has no routing. Set one up (Production → Recipes) and this is worked out for you.</span>
        </label>
      )}
      <label className="field">
        Actual labour cost (₦)
        <input name="actualLabourCost" type="number" step="0.01" min="0" defaultValue="0" />
      </label>
      <label className="field">
        Actual overhead cost (₦)
        <input name="actualOverheadCost" type="number" step="0.01" min="0" defaultValue="0" />
      </label>

      <Submit label="Confirm conversion" pendingLabel="Confirming…" />
    </form>
  );
}

/** Optional, while IN_PRODUCTION: claim an abnormal loss — the recipe's own tolerance decides how much posts. */
export function RecordLossForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(recordLoss, {
    error: null,
    message: null,
  });

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}

      <label className="field">
        Quantity lost
        <input name="quantity" type="number" step="0.001" min="0.001" required />
      </label>
      <label className="field">
        Cost of the loss (₦)
        <input name="cost" type="number" step="0.01" min="0" required />
      </label>
      <label className="field">
        Reason
        <input name="reason" placeholder="Spoilage, breakage, a failed batch" required />
      </label>

      <Submit label="Record loss" pendingLabel="Recording…" />
    </form>
  );
}

/** IN_PRODUCTION → COMPLETED: receive the finished output(s), splitting residual WIP cost across them. */
export function RecordOutputsForm({
  orderId,
  mainItemId,
  mainItemLabel,
  warehouses,
  byProductItems,
}: {
  orderId: string;
  mainItemId: string;
  mainItemLabel: string;
  warehouses: Warehouse[];
  byProductItems: Array<{ id: string; code: string; name: string }>;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(recordOutputs, {
    error: null,
    message: null,
  });
  const [byProductCount, setByProductCount] = useState(0);

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      <input type="hidden" name="mainItemId" value={mainItemId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}

      <p className="faint" style={{ fontSize: 13 }}>
        The order&rsquo;s cost is shared between its outputs by the company&rsquo;s one released method — relative
        sales value at split-off — using the approved selling prices under{' '}
        <a href="/production/joint-cost">Joint-cost prices</a>. Weigh everything in kilograms: what came out, and what was
        lost along the way, must add up to what went in.
      </p>

      <label className="field">
        Receiving store
        <select name="warehouseId" defaultValue="" required>
          <option value="" disabled>
            Where the output goes
          </option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        {mainItemLabel} (kg)
        <input name="mainQuantity" type="number" step="0.001" min="0.001" required />
      </label>

      {[...Array(byProductCount)].map((_, index) => {
        const n = index + 1;
        return (
          <div key={n} className="grid-auto">
            <label className="field">
              By-product {n}
              <select name={`byProductItemId${n}`} defaultValue="">
                <option value="">— none —</option>
                {byProductItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} — {i.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Kilograms
              <input name={`byProductQuantity${n}`} type="number" step="0.001" min="0" />
            </label>
          </div>
        );
      })}

      {byProductCount < 2 ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setByProductCount((c) => c + 1)}>
          + Add a by-product
        </button>
      ) : null}

      <label className="field">
        Normal process loss (kg)
        <input name="normalLossQuantity" type="number" step="0.001" min="0" />
        <span className="faint">Blood, water, trimmings — the ordinary loss. Leave blank and the order tells you what it should be.</span>
      </label>

      <Submit label="Record outputs" pendingLabel="Recording…" />
    </form>
  );
}
