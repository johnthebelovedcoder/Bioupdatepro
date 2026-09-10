'use client';

import { useState, useTransition } from 'react';
import { submitManualJournal } from '@/app/(app)/finance/journals/actions';

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
