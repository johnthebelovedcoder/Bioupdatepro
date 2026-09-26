'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { setBudget, type BudgetState } from '@/app/(app)/procurement/budgets/actions';

export function BudgetForm({ financialYearId, costCentres }: { financialYearId: string; costCentres: Array<{ id: string; label: string }> }) {
  const [state, action] = useActionState<BudgetState, FormData>(setBudget, { error: null, message: null });
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="financialYearId" value={financialYearId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
      <div className="grid-auto">
        <label className="field">
          Cost centre
          <select name="costCentreId" defaultValue="" required>
            <option value="" disabled>
              Which cost centre?
            </option>
            {costCentres.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Budget for the year (₦, before VAT)
          <input name="amount" inputMode="decimal" required />
        </label>
      </div>
      <label className="field">
        Note
        <input name="note" placeholder="e.g. Approved at the October board meeting" />
      </label>
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Saving…' : 'Set budget'}
      </button>
    </div>
  );
}
