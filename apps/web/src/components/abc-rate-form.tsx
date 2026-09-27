'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { setAbcRate, type RateState } from '@/app/(app)/ledger/farm-abc/actions';

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-sm" disabled={pending}>
      {pending ? '…' : 'Save'}
    </button>
  );
}

/** One stage's rate for one pool, editable in place. */
export function AbcRateForm({ stage, pool, rate, canEdit }: { stage: string; pool: 'FEED' | 'LABOUR'; rate: string; canEdit: boolean }) {
  const [state, action] = useActionState<RateState, FormData>(setAbcRate, { error: null, message: null });
  if (!canEdit) return <span className="num">₦{Number(rate).toLocaleString('en-NG', { maximumFractionDigits: 6 })}</span>;
  return (
    <form action={action} style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
      <input type="hidden" name="stage" value={stage} />
      <input type="hidden" name="pool" value={pool} />
      <input name="rate" defaultValue={rate} inputMode="decimal" aria-label={`${stage} ${pool.toLowerCase()} rate`} style={{ width: 110 }} />
      <Save />
      {state.error ? <span className="faint" role="alert">{state.error}</span> : null}
      {state.message ? <span className="faint" role="status">{state.message}</span> : null}
    </form>
  );
}
