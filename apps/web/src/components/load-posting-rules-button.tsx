'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { loadPostingRules } from '@/app/(app)/ledger/controls/actions';

/** Load the posting rules into a company that has never had them. */
export function LoadPostingRulesButton() {
  const [result, setResult] = useState<{ error: string | null; message: string | null } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const outcome = await loadPostingRules();
              setResult(outcome);
              if (!outcome.error) router.refresh();
            })
          }
        >
          {pending ? 'Loading…' : 'Load posting rules'}
        </button>
      </div>
      {result?.error ? <div className="notice notice-error">{result.error}</div> : null}
      {result?.message ? <div className="notice notice-success">{result.message}</div> : null}
    </div>
  );
}
