'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { raiseFromPlan, saveQualitySpec, type MillState } from '@/app/(app)/feed-mill/actions';

const EMPTY: MillState = { error: null, message: null };

function Submit({ label, small }: { label: string; small?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn btn-primary${small ? ' btn-sm' : ''}`} disabled={pending}>
      {pending ? 'Working…' : label}
    </button>
  );
}

export function QualitySpecForm({ items }: { items: Array<{ id: string; label: string }> }) {
  const [state, action] = useActionState(saveQualitySpec, EMPTY);
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
      <label className="field">
        Feed
        <select name="itemId" defaultValue="" required>
          <option value="" disabled>
            Which finished feed
          </option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid-auto">
        <label className="field">
          Protein at least (%)
          <input name="minProteinPercent" type="number" step="0.01" min="0" />
        </label>
        <label className="field">
          Moisture at most (%)
          <input name="maxMoisturePercent" type="number" step="0.01" min="0" />
        </label>
        <label className="field">
          Aflatoxin at most (ppb)
          <input name="maxAflatoxinPpb" type="number" step="0.01" min="0" />
        </label>
      </div>
      <label className="field">
        How it is sampled
        <input name="samplingNote" placeholder="One composite sample of 500 g per batch" />
      </label>
      <div>
        <Submit label="Save limits" />
      </div>
    </form>
  );
}

/** Raise a milling order for the plan's shortfall, as a draft. */
export function RaiseFeedOrder({
  recipeVersionId,
  recipeName,
  quantity,
  farms,
  branches,
}: {
  recipeVersionId: string;
  recipeName: string;
  quantity: string;
  farms: Array<{ id: string; name: string }>;
  branches: Array<{ id: string; name: string }>;
}) {
  const [state, action] = useActionState(raiseFromPlan, EMPTY);
  if (state.message) return <span className="badge badge-success">{state.message}</span>;
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-1)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      <input type="hidden" name="recipeVersionId" value={recipeVersionId} />
      <div className="row" style={{ gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
        <input name="plannedOutputQuantity" type="number" step="0.001" min="0.001" defaultValue={quantity} style={{ width: 100 }} aria-label="Quantity to mill" />
        <select name="farmId" defaultValue={farms[0]?.id ?? ''} aria-label="Farm" style={{ width: 110 }}>
          {farms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <input type="hidden" name="branchId" value={branches[0]?.id ?? ''} />
        <Submit label="Raise order" small />
      </div>
      <span className="faint" style={{ fontSize: 12 }}>
        by {recipeName}
      </span>
    </form>
  );
}
