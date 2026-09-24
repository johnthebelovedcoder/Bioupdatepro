'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { explodeRecipe, type ExplosionState } from '@/app/(app)/production/actions';
import { formatNaira, formatQuantity } from '@/lib/money';

/**
 * Plan a batch: what this recipe version would draw from the store to make a
 * given quantity, wastage included, and what that costs at today's standard.
 */
export function ExplodeRecipeForm({
  recipeVersionId,
  batchSize,
  outputUnit,
}: {
  recipeVersionId: string;
  batchSize: string;
  outputUnit?: string;
}) {
  const [state, formAction] = useActionState<ExplosionState, FormData>(explodeRecipe, {
    error: null,
    result: null,
  });
  const [open, setOpen] = useState(false);
  const result = state.result;

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Plan a batch
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Plan a batch">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="recipeVersionId" value={recipeVersionId} />
          <p className="faint">Nothing is reserved or posted — this only works out the quantities.</p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <label className="field">
            Output to make{outputUnit ? ` (${outputUnit})` : ''}
            <input name="quantity" inputMode="decimal" defaultValue={batchSize} required />
          </label>

          <Submit />

          {result ? (
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              <p>
                {formatQuantity(result.batches, 2)} batch{result.batches === '1' ? '' : 'es'} ·
                materials {formatNaira(result.totalMaterialCostKobo)} ·{' '}
                {formatNaira(result.unitMaterialCostKobo)} per unit of output
              </p>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th className="right">Issue</th>
                      <th className="right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.components.map((component) => (
                      <tr key={component.lineNumber}>
                        <td style={{ textAlign: 'left' }}>
                          {component.itemCode} — {component.description}
                          {component.optional ? <span className="faint"> (optional)</span> : null}
                          {component.grossQuantity !== component.netQuantity ? (
                            <div className="faint">
                              {formatQuantity(component.netQuantity)} before wastage
                            </div>
                          ) : null}
                        </td>
                        <td className="num">
                          {formatQuantity(component.grossQuantity)} {component.unitOfMeasure}
                        </td>
                        <td className="num">{formatNaira(component.extendedCostKobo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </form>
      </Sheet>
    </>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Working out…' : 'Work it out'}
      </button>
    </div>
  );
}
