'use client';

import { useState, useTransition } from 'react';
import { reverseJournal } from '@/app/(app)/ledger/journals/actions';
import { useRoles } from './roles-context';

const CAN_REVERSE = ['FINANCE_CONTROLLER', 'CFO'];

/** Raises the mirror-image reversal of a posted journal. The original is never edited. */
export function ReverseJournalButton({ journalId }: { journalId: string }) {
  const roles = useRoles();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  // Courtesy only, same as every other role check in this component tree —
  // the API re-checks and refuses on its own if this is ever wrong.
  if (!roles.some((role) => CAN_REVERSE.includes(role))) return null;

  if (message) return <span className="faint">{message}</span>;

  if (!confirming) {
    return (
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(true)}>
        Reverse
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)', alignItems: 'flex-end' }}>
      <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await reverseJournal(journalId);
              setError(result.error);
              if (result.message) setMessage(result.message);
              else setConfirming(false);
            })
          }
        >
          {pending ? 'Reversing…' : 'Confirm reverse'}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
      {error ? <div className="notice notice-error">{error}</div> : null}
    </div>
  );
}
