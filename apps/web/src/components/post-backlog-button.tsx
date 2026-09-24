'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { postOperationsBacklog, type BacklogState } from '@/app/(app)/ledger/controls/actions';

/** Post whatever farm records are still waiting for a journal, and say what could not be. */
export function PostBacklogButton() {
  const [state, formAction] = useActionState<BacklogState, FormData>(postOperationsBacklog, {
    error: null,
    result: null,
  });
  const result = state.result;
  const posted = result
    ? result.feedIssues.posted + result.treatments.posted + (result.rearingReliefs?.posted ?? 0) + (result.eggs?.posted ?? 0)
    : 0;
  const failed = result
    ? result.feedIssues.failed + result.treatments.failed + (result.rearingReliefs?.failed ?? 0) + (result.eggs?.failed ?? 0)
    : 0;

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <div>
        <Submit />
      </div>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {result ? (
        <div className={`notice ${failed > 0 ? 'notice-warning' : 'notice-success'}`}>
          {posted === 0 && failed === 0
            ? 'Nothing was waiting — every farm record already has its journal.'
            : `Posted ${posted} record${posted === 1 ? '' : 's'}${failed > 0 ? `; ${failed} still could not post` : ''}.`}
          {result.reasons.length > 0 ? (
            <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: 18 }}>
              {result.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn" disabled={pending}>
      {pending ? 'Posting…' : 'Post waiting farm records'}
    </button>
  );
}
