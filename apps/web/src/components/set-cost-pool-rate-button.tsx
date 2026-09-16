'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { setCostPoolRate, type SetRateState } from '@/app/(app)/production/cost-pools/actions';
import { Sheet } from './sheet';

const EMPTY: SetRateState = { error: null };

export function SetCostPoolRateButton({ poolId, poolName }: { poolId: string; poolName: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<SetRateState, FormData>(setCostPoolRate, EMPTY);

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        Set rate
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={`Set rate — ${poolName}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="poolId" value={poolId} />

          <p className="faint">
            The rate is computed, not typed — pool cost ÷ practical capacity, so it can never drift
            from the two numbers it comes from.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <div className="grid-auto">
            <label className="field">
              Pool cost (₦), for the period
              <input name="poolCost" type="number" step="any" min="0" placeholder="500000" required />
            </label>
            <label className="field">
              Practical capacity
              <input
                name="practicalCapacity"
                type="number"
                step="any"
                min="0"
                placeholder="200"
                required
              />
              <span className="faint">in the driver&apos;s own unit</span>
            </label>
          </div>

          <div className="grid-auto">
            <label className="field">
              Effective from
              <input name="effectiveFrom" type="date" required />
            </label>
            <label className="field">
              Source
              <input name="sourceReference" placeholder="2026 budget, approved by..." />
            </label>
          </div>

          <Pending />
        </form>
      </Sheet>
    </>
  );
}

function Pending() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : 'Set rate'}
    </button>
  );
}
