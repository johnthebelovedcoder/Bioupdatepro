'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  addRoutingOperation,
  type AddRoutingOperationState,
} from '@/app/(app)/production/recipes/actions';
import { Sheet } from './sheet';

const EMPTY: AddRoutingOperationState = { error: null };

export function AddRoutingOperationButton({
  recipeId,
  recipeVersionId,
  costCentres,
  costPools,
}: {
  recipeId: string;
  recipeVersionId: string;
  costCentres: Array<{ id: string; code: string; name: string }>;
  costPools: Array<{ id: string; code: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [state, formAction] = useActionState<AddRoutingOperationState, FormData>(
    addRoutingOperation,
    EMPTY,
  );

  return (
    <>
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        Add operation
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Add a routing operation">
        <form
          action={formAction}
          onSubmit={() => setSubmitted(true)}
          className="stack"
          style={{ gap: 'var(--sp-4)' }}
        >
          <input type="hidden" name="recipeId" value={recipeId} />
          <input type="hidden" name="recipeVersionId" value={recipeVersionId} />

          <p className="faint">
            One step this recipe goes through — the labour or machine time it standardly takes, and
            which cost pool absorbs its overhead.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {submitted && !state.error ? (
            <div className="notice notice-success">
              <strong>Added.</strong> Close this to see it on the list, or add another step.
            </div>
          ) : null}

          <label className="field">
            Operation
            <input name="operationName" placeholder="Dress and eviscerate" required />
          </label>

          <div className="grid-auto">
            <label className="field">
              Resource
              <select name="resourceType" required defaultValue="">
                <option value="" disabled>
                  Labour or machine?
                </option>
                <option value="LABOUR">Labour</option>
                <option value="MACHINE">Machine</option>
              </select>
            </label>
            <label className="field">
              Cost centre
              <select name="costCentreId" required defaultValue="">
                <option value="" disabled>
                  Which cost centre
                </option>
                {costCentres.map((centre) => (
                  <option key={centre.id} value={centre.id}>
                    {centre.code} — {centre.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            Cost pool
            <select name="costPoolId" required defaultValue="">
              <option value="" disabled>
                What absorbs this operation&apos;s overhead
              </option>
              {costPools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.code} — {pool.name}
                </option>
              ))}
            </select>
            {costPools.length === 0 ? (
              <span className="faint">
                Nothing to pick — <a href="/production/cost-pools">add a cost pool</a> first.
              </span>
            ) : null}
          </label>

          <div className="grid-auto">
            <label className="field">
              Setup hours
              <input name="setupHours" type="number" step="any" min="0" placeholder="0.5" />
              <span className="faint">once per run, regardless of quantity</span>
            </label>
            <label className="field">
              Run hours, per unit of output
              <input name="runHoursPerUnit" type="number" step="any" min="0" placeholder="0.02" />
            </label>
          </div>

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
      {pending ? 'Adding…' : 'Add operation'}
    </button>
  );
}
