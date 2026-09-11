'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { FlowState } from '@/app/(app)/production/actions';

/**
 * A single-click stage transition — submit, issue, or settle.
 *
 * `action` must be the actual server action function (imported from a
 * `'use server'` file), not a closure built around it — an inline arrow
 * function is a plain client-side closure to Next.js, not a recognised
 * Server Action reference, and fails to cross the client/server boundary.
 * The order id is passed alongside it and bound on click instead.
 */
export function ProductionOrderActionButton({
  action,
  id,
  label,
  pendingLabel,
  className = 'btn btn-primary',
}: {
  action: (id: string) => Promise<FlowState>;
  id: string;
  label: string;
  pendingLabel: string;
  className?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div>
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await action(id);
            setError(result.error);
            if (!result.error) router.refresh();
          })
        }
      >
        {pending ? pendingLabel : label}
      </button>
      {error ? <div className="notice notice-error" style={{ marginTop: 'var(--sp-2)' }}>{error}</div> : null}
    </div>
  );
}
