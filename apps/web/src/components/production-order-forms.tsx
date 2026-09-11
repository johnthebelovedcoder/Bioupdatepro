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
export function ConfirmConversionForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(confirmConversion, {
    error: null,
    message: null,
  });

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}

      <label className="field">
        Standard conversion cost (₦)
        <input name="standardConversionCost" type="number" step="0.01" min="0" required />
      </label>
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
  const [method, setMethod] = useState<'NRV' | 'WEIGHT'>('NRV');
  const [byProductCount, setByProductCount] = useState(0);

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="productionOrderId" value={orderId} />
      <input type="hidden" name="mainItemId" value={mainItemId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}

      <label className="field">
        Allocation method
        <select
          name="method"
          value={method}
          onChange={(e) => setMethod(e.target.value as 'NRV' | 'WEIGHT')}
        >
          <option value="NRV">Net realisable value (sale price less cost to sell)</option>
          <option value="WEIGHT">Relative weight</option>
        </select>
      </label>

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

      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 'var(--sp-3)' }}>
        <legend className="faint">Main output — {mainItemLabel}</legend>
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <label className="field">
            Quantity
            <input name="mainQuantity" type="number" step="0.001" min="0.001" required />
          </label>
          {method === 'NRV' ? (
            <>
              <label className="field">
                Sale price per unit (₦)
                <input name="mainSalePrice" type="number" step="0.01" min="0" required />
              </label>
              <label className="field">
                Cost to sell per unit (₦)
                <input name="mainCostsToSell" type="number" step="0.01" min="0" defaultValue="0" />
              </label>
            </>
          ) : (
            <label className="field">
              Weight
              <input name="mainWeight" type="number" step="0.001" min="0.001" required />
            </label>
          )}
        </div>
      </fieldset>

      {[...Array(byProductCount)].map((_, index) => {
        const n = index + 1;
        return (
          <fieldset
            key={n}
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 'var(--sp-3)' }}
          >
            <legend className="faint">By-product {n}</legend>
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              <label className="field">
                Item
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
                Quantity
                <input name={`byProductQuantity${n}`} type="number" step="0.001" min="0" />
              </label>
              {method === 'NRV' ? (
                <>
                  <label className="field">
                    Sale price per unit (₦)
                    <input name={`byProductSalePrice${n}`} type="number" step="0.01" min="0" />
                  </label>
                  <label className="field">
                    Cost to sell per unit (₦)
                    <input name={`byProductCostsToSell${n}`} type="number" step="0.01" min="0" defaultValue="0" />
                  </label>
                </>
              ) : (
                <label className="field">
                  Weight
                  <input name={`byProductWeight${n}`} type="number" step="0.001" min="0" />
                </label>
              )}
            </div>
          </fieldset>
        );
      })}

      {byProductCount < 2 ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setByProductCount((c) => c + 1)}
        >
          + Add a by-product
        </button>
      ) : null}

      <Submit label="Record outputs" pendingLabel="Recording…" />
    </form>
  );
}
