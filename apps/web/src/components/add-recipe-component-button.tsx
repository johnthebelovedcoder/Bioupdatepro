'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { addComponent, type AddComponentState } from '@/app/(app)/production/recipes/actions';
import { Sheet } from './sheet';

const EMPTY: AddComponentState = { error: null };

export function AddRecipeComponentButton({
  recipeId,
  recipeVersionId,
  items,
}: {
  recipeId: string;
  recipeVersionId: string;
  items: Array<{ id: string; code: string; name: string; unit: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction] = useActionState<AddComponentState, FormData>(addComponent, EMPTY);
  const unit = items.find((item) => item.id === selected)?.unit ?? '';

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        Add a component
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Add a component">
        <form
          action={formAction}
          onSubmit={() => setSubmitted(true)}
          className="stack"
          style={{ gap: 'var(--sp-4)' }}
        >
          <input type="hidden" name="recipeId" value={recipeId} />
          <input type="hidden" name="recipeVersionId" value={recipeVersionId} />
          <input type="hidden" name="unitOfMeasureCode" value={unit} />

          <p className="faint">What one batch of this recipe consumes — one line at a time.</p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {submitted && !state.error ? (
            <div className="notice notice-success">
              <strong>Added.</strong> Close this to see it on the list, or add another line.
            </div>
          ) : null}

          <label className="field">
            Item
            <select
              name="componentItemId"
              required
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="" disabled>
                Choose what this line consumes
              </option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid-auto">
            <label className="field">
              Quantity per batch
              <input
                name="quantityPerBatch"
                type="number"
                step="any"
                min="0"
                placeholder="1"
                required
              />
              <span className="faint">{unit ? `in ${unit}` : 'pick an item first'}</span>
            </label>
            <label className="field">
              Expected wastage %
              <input name="wastagePercent" type="number" step="any" min="0" max="100" placeholder="0" />
            </label>
            <label className="field">
              Line type
              <select name="componentType" defaultValue="MATERIAL">
                <option value="MATERIAL">Material</option>
                <option value="PACKAGING">Packaging</option>
              </select>
              <span className="faint">Shown separately in the standard cost</span>
            </label>
          </div>

          <label className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
            <input type="checkbox" name="optional" />
            Optional — a shortage of this warns rather than blocks production
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
      {pending ? 'Adding…' : 'Add component'}
    </button>
  );
}
