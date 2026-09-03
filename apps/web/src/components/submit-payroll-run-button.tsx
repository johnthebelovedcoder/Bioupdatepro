'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { submitPayrollRun, type FlowState } from '@/app/(app)/finance/payroll/runs/actions';

/** One calculated run's own "send for approval" action — inline, no separate detail page. */
export function SubmitPayrollRunButton({ runId }: { runId: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(submitPayrollRun, {
    error: null,
    message: null,
  });

  return (
    <form action={formAction} style={{ display: 'inline' }}>
      <input type="hidden" name="runId" value={runId} />
      <Submit />
      {state.error ? (
        <div className="notice notice-error" style={{ marginTop: 'var(--sp-2)' }}>
          {state.error}
        </div>
      ) : null}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-sm" disabled={pending}>
      {pending ? 'Submitting…' : 'Submit for approval'}
    </button>
  );
}
