'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { retryPosting, type RetryPostingState } from '@/app/(app)/agripro/biological-assets/actions';

const EMPTY: RetryPostingState = { error: null };

/** Small enough to sit inside the "Ledger" cell it corrects, not a dialog of its own. */
export function RetryPostingButton({ groupId }: { groupId: string }) {
  const [state, formAction] = useActionState<RetryPostingState, FormData>(retryPosting, EMPTY);

  return (
    <form action={formAction} className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
      <input type="hidden" name="groupId" value={groupId} />
      <Pending />
      {state.error ? (
        <span className="faint" style={{ color: 'var(--error-700)' }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function Pending() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-ghost" disabled={pending} style={{ fontSize: 12, padding: '4px 8px' }}>
      {pending ? 'Retrying…' : 'Retry posting'}
    </button>
  );
}
