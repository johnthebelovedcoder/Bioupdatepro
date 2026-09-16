'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { activateVersion, type ActivateVersionState } from '@/app/(app)/production/recipes/actions';

const EMPTY: ActivateVersionState = { error: null };

/** Once active, a version is costed and selectable on a processing order — and locked. */
export function ActivateRecipeVersionButton({
  recipeId,
  recipeVersionId,
}: {
  recipeId: string;
  recipeVersionId: string;
}) {
  const [state, formAction] = useActionState<ActivateVersionState, FormData>(activateVersion, EMPTY);

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-2)' }}>
      <input type="hidden" name="recipeId" value={recipeId} />
      <input type="hidden" name="recipeVersionId" value={recipeVersionId} />
      <Pending />
      {state.error ? (
        <span className="faint" style={{ color: 'var(--error-700)' }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function Pending() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Activating…' : 'Activate this version'}
    </button>
  );
}
