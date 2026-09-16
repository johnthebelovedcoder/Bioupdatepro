'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createRecipe, type CreateRecipeState } from '@/app/(app)/production/recipes/actions';
import { Sheet } from './sheet';

const EMPTY: CreateRecipeState = { error: null };

export function NewRecipeButton({
  items,
}: {
  items: Array<{ id: string; code: string; name: string; unit: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<CreateRecipeState, FormData>(createRecipe, EMPTY);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        New recipe
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="New recipe">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            What one run of this recipe produces, and how much of it — the components go on the
            draft version this creates, once it exists.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <div className="grid-auto">
            <label className="field">
              Recipe code
              <input name="code" placeholder="REC-SNAIL-SLIME" required />
            </label>
            <label className="field">
              Name
              <input name="name" placeholder="Snail slime, bottled" required />
            </label>
          </div>

          <label className="field">
            Produces
            <select name="outputItemId" required defaultValue="">
              <option value="" disabled>
                Choose the output item
              </option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </select>
            <span className="faint">
              Not listed? Add it under Items first — a recipe can only produce a real item.
            </span>
          </label>

          <label className="field">
            Batch size
            <input name="batchSize" type="number" step="any" min="0" placeholder="1" required />
            <span className="faint">
              What one run yields, in the output item&apos;s own unit — components below are
              quantities for THIS much output.
            </span>
          </label>

          <Pending />
        </form>
      </Sheet>
    </>
  );
}

function Pending() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Creating…' : 'Create recipe'}
    </button>
  );
}
