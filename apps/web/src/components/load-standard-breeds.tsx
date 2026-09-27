'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { loadStandardBreeds, type FlowState } from '@/app/(app)/admin/breeds/actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-sm btn-ghost" disabled={pending}>
      {pending ? 'Loading…' : 'Load the standard list'}
    </button>
  );
}

/** Adds the workbook's approved species or breeds this farm does not have yet. */
export function LoadStandardBreeds({ speciesKey }: { speciesKey: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(loadStandardBreeds, { error: null, message: null });
  return (
    <form action={formAction} style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
      <input type="hidden" name="speciesKey" value={speciesKey} />
      <Submit />
      {state.error ? <span className="faint" role="alert">{state.error}</span> : null}
      {state.message ? <span className="faint" role="status">{state.message}</span> : null}
    </form>
  );
}
