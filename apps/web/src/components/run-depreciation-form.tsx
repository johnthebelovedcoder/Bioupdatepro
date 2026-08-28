'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { runDepreciation, type FlowState } from '@/app/(app)/ledger/fixed-assets/actions';
import type { Period } from '@/lib/org';

/** One depreciation charge for every in-service asset, for one period, as one run. */
export function RunDepreciationForm({ periods }: { periods: Period[] }) {
  const [state, formAction] = useActionState<FlowState, FormData>(runDepreciation, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);

  const openPeriods = periods.filter((period) => period.status === 'OPEN');

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Run depreciation
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Run depreciation">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">One straight-line charge per in-service asset, for a period.</p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Period
            <select name="financialPeriodId" defaultValue="" required>
              <option value="" disabled>
                Choose a period
              </option>
              {openPeriods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.name}
                </option>
              ))}
            </select>
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
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Running…' : 'Run depreciation'}
      </button>
    </div>
  );
}
