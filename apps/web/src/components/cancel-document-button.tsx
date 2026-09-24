'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { cancelTransaction, type FlowState } from '@/app/(app)/procurement/actions';

/** Withdraw a document you raised, while nobody has approved any step of it yet. */
export function CancelDocumentButton({ transactionId }: { transactionId: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(cancelTransaction, {
    error: null,
    message: null,
  });

  if (state.message) return <span className="badge">withdrawn</span>;

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-2)' }}>
      <input type="hidden" name="transactionId" value={transactionId} />
      <Submit />
      {state.error ? (
        <div className="faint" style={{ color: 'var(--error-700)', whiteSpace: 'normal' }}>
          {state.error}
        </div>
      ) : null}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-sm btn-ghost" disabled={pending}>
      {pending ? 'Withdrawing…' : 'Withdraw'}
    </button>
  );
}
