'use client';

import { useState, useTransition } from 'react';
import { generateDueRecurring } from '@/app/(app)/finance/journals/actions';

/** Runs every recurring template whose next run date has arrived — each generated journal is still a draft awaiting approval. */
export function GenerateDueRecurringButton() {
  const [message, setMessage] = useState<string | null>(null);
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
            const result = await generateDueRecurring();
            setError(result.error);
            setMessage(result.message);
          })
        }
      >
        {pending ? 'Generating…' : 'Generate due journals'}
      </button>
      {error ? <div className="notice notice-error" style={{ marginTop: 'var(--sp-2)' }}>{error}</div> : null}
      {message ? <div className="notice notice-success" style={{ marginTop: 'var(--sp-2)' }}>{message}</div> : null}
    </div>
  );
}
