'use client';

import { useState, useTransition } from 'react';
import { cancelManualJournal, submitManualJournal } from '@/app/(app)/finance/journals/actions';

/** Sends a draft journal — hand-raised and returned, or recurring-generated — into approval. */
export function SubmitJournalButton({ manualJournalId }: { manualJournalId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await submitManualJournal(manualJournalId);
            setError(result.error);
          })
        }
      >
        {pending ? 'Submitting…' : 'Submit'}
      </button>
      {error ? <div className="notice notice-error" style={{ marginTop: 'var(--sp-2)' }}>{error}</div> : null}
    </div>
  );
}

/** Withdraw a draft. Only its maker can; the API says so if you are not. */
export function CancelJournalButton({ manualJournalId }: { manualJournalId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await cancelManualJournal(manualJournalId);
            setError(result.error);
          })
        }
      >
        {pending ? 'Cancelling…' : 'Cancel'}
      </button>
      {error ? <div className="notice notice-error" style={{ marginTop: 'var(--sp-2)' }}>{error}</div> : null}
    </div>
  );
}
