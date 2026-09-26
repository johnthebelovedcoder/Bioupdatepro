'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  configurePolicy,
  decideStandard,
  prepareStandard,
  type StandardState,
} from '@/app/(app)/production/standard-costs/actions';

const EMPTY: StandardState = { error: null, message: null };

function Notices({ state }: { state: StandardState }) {
  return (
    <>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
    </>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Saving…' : label}
      </button>
    </div>
  );
}

/** Configure a year's policy while it is still unlocked. */
export function PolicyForm({ financialYearId, tolerance }: { financialYearId: string; tolerance: string }) {
  const [state, action] = useActionState(configurePolicy, EMPTY);
  return (
    <form action={action} className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <input type="hidden" name="financialYearId" value={financialYearId} />
      <label className="field" style={{ maxWidth: 200 }}>
        Variance tolerance (%)
        <input name="varianceTolerancePercent" type="number" step="0.01" min="0.01" max="100" defaultValue={tolerance} />
      </label>
      <Submit label="Save policy" />
      <div style={{ width: '100%' }}>
        <Notices state={state} />
      </div>
    </form>
  );
}

export function PrepareStandardForm({ recipeVersions, today }: { recipeVersions: Array<{ id: string; label: string }>; today: string }) {
  const [state, action] = useActionState(prepareStandard, EMPTY);
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <Notices state={state} />
      <div className="grid-auto">
        <label className="field">
          Recipe version
          <select name="recipeVersionId" defaultValue="" required>
            <option value="" disabled>
              Feed formula or processing recipe…
            </option>
            {recipeVersions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Applies from
          <input name="effectiveFrom" type="date" defaultValue={today} required />
        </label>
      </div>
      <p className="faint" style={{ margin: 0 }}>
        Rolled up from the recipe&rsquo;s materials at their approved standard rates and its routing&rsquo;s hours at the approved pool rates.
      </p>
      <Submit label="Prepare standard" />
    </form>
  );
}

export function DecideStandard({ versionId }: { versionId: string }) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<StandardState>(EMPTY);
  const router = useRouter();
  const run = (approve: boolean) => {
    const reason = approve ? undefined : window.prompt('Why is this standard rejected?') ?? '';
    if (!approve && !reason?.trim()) return;
    startTransition(async () => {
      const result = await decideStandard(versionId, approve, reason);
      setOutcome(result);
      if (!result.error) router.refresh();
    });
  };
  return (
    <span className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => run(true)}>
        Release
      </button>
      <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(false)}>
        Reject
      </button>
      {outcome.error ? <span style={{ color: 'var(--danger, #b42318)', fontSize: 12 }}>{outcome.error}</span> : null}
    </span>
  );
}
