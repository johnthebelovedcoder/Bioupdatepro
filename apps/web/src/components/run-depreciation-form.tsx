'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card } from './ui';
import { runDepreciation, type FlowState } from '@/app/(app)/ledger/fixed-assets/actions';
import type { Period } from '@/lib/org';

/** One depreciation charge for every in-service asset, for one period, as one run. */
export function RunDepreciationForm({ periods }: { periods: Period[] }) {
  const [state, formAction] = useActionState<FlowState, FormData>(runDepreciation, {
    error: null,
    message: null,
  });

  const openPeriods = periods.filter((period) => period.status === 'OPEN');

  return (
    <Card title="Run depreciation" subtitle="One straight-line charge per in-service asset, for a period">
      <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
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
    </Card>
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
