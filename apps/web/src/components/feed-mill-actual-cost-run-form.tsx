'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { allocateFeedMillActualCosts, type FeedMillActualCostState } from '@/app/(app)/production/cost-pools/actions';

const EMPTY: FeedMillActualCostState = { error: null, message: null };

function Submit() {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Allocating…' : 'Freeze and allocate'}</button>;
}

export function FeedMillActualCostRunForm({ periods }: { periods: Array<{ id: string; label: string }> }) {
  const [state, action] = useActionState(allocateFeedMillActualCosts, EMPTY);
  if (!periods.length) return <p className="faint">A soft-closed period is needed before shared feed-mill costs can be allocated.</p>;
  return (
    <form action={action} className="row" style={{ gap: 'var(--sp-3)', alignItems: 'end', flexWrap: 'wrap' }}>
      <label className="field" style={{ minWidth: 230 }}>
        Soft-closed period
        <select name="financialPeriodId" required defaultValue={periods[0]?.id}>
          {periods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
        </select>
      </label>
      <Submit />
      {state.error ? <span className="notice notice-error">{state.error}</span> : null}
      {state.message ? <span className="notice notice-success">{state.message}</span> : null}
    </form>
  );
}
