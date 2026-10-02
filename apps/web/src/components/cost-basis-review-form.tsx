'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Sheet } from './sheet';
import { reviewFairValueReliability, type ValuationState } from '@/app/(app)/agripro/biological-assets/actions';

const EMPTY: ValuationState = { error: null, message: null };

export function CostBasisReviewForm({ groupId, code, reviewedOn }: { groupId: string; code: string; reviewedOn: string | null }) {
  const [state, action] = useActionState<ValuationState, FormData>(reviewFairValueReliability, EMPTY);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (state.message) {
      setOpen(false);
      router.refresh();
    }
  }, [state.message, router]);

  return <>
    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(true)}>Review fair value</button>
    <Sheet open={open} onClose={() => setOpen(false)} title={`IAS 41 cost exception — ${code}`}>
      <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
        <input type="hidden" name="groupId" value={groupId} />
        <p className="faint">A Finance Manager, Finance Controller or CFO must confirm fair value remains clearly unreliable at each reporting date. If fair value is now reliable, raise an FVLCTS valuation instead.</p>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}
        <label className="field">Reporting date<input name="reviewedOn" type="date" defaultValue={reviewedOn ?? new Date().toISOString().slice(0, 10)} required /></label>
        <label className="field">Why does fair value remain clearly unreliable?<textarea name="reason" rows={3} required /></label>
        <label className="field">Review evidence<input name="evidenceReference" placeholder="Valuation assessment or supporting document reference" required /></label>
        <ReviewSubmit />
      </form>
    </Sheet>
  </>;
}

function ReviewSubmit() {
  const { pending } = useFormStatus();
  return <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? 'Recording…' : 'Record review'}</button>;
}
