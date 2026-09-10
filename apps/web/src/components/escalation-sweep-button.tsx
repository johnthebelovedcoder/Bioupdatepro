'use client';

import { useState, useTransition } from 'react';
import { runEscalationSweep } from '@/app/(app)/approvals/actions';
import { useRoles } from './roles-context';

/** Runs the escalation clock on demand — otherwise only a scheduler drives it. */
export function EscalationSweepButton() {
  const roles = useRoles();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!roles.includes('CFO')) return null;

  return (
    <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await runEscalationSweep();
            setError(result.error);
            setMessage(result.message);
          })
        }
      >
        {pending ? 'Sweeping…' : 'Run escalation sweep'}
      </button>
      {error ? <span className="faint" style={{ color: 'var(--error-700)' }}>{error}</span> : null}
      {message ? <span className="faint">{message}</span> : null}
    </div>
  );
}
