'use client';

import { useState, useTransition } from 'react';
import { revokeDelegation } from '@/app/(app)/approvals/delegations/actions';

/** Withdraws authority you lent. Only the person who granted it, or an administrator, may do this. */
export function RevokeDelegationButton({ delegationId }: { delegationId: string }) {
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
            const result = await revokeDelegation(delegationId);
            setError(result.error);
          })
        }
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {error ? <div className="notice notice-error" style={{ marginTop: 'var(--sp-2)' }}>{error}</div> : null}
    </div>
  );
}
