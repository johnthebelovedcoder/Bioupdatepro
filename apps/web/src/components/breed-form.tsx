'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { createBreed, type FlowState } from '@/app/(app)/admin/breeds/actions';

/**
 * Add a breed. The species' own stages are laid out ready — the only thing a
 * farm has to supply is the age each one starts at for this breed, which is
 * exactly the part no registry can know for them.
 */
export function BreedForm({
  speciesKey,
  speciesLabel,
  stages,
}: {
  speciesKey: string;
  speciesLabel: string;
  stages: string[];
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(createBreed, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
        Add a breed
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={`Add a ${speciesLabel.toLowerCase()} breed`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="speciesKey" value={speciesKey} />

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 120 }}>
              Code
              <input name="code" placeholder="ROSS308" required />
            </label>
            <label className="field" style={{ flex: 2, minWidth: 180 }}>
              Name
              <input name="name" placeholder="Ross 308" required />
            </label>
          </div>

          <label className="field">
            Classification<span className="faint"> (optional)</span>
            <input name="classification" placeholder="Broiler, layer, dual-purpose…" />
          </label>

          <label className="field">
            A new population starts at
            <select name="openingStage" defaultValue={stages[0] ?? ''}>
              {stages.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="stack" style={{ gap: 'var(--sp-2)', border: 0, padding: 0, margin: 0 }}>
            <legend className="faint" style={{ marginBottom: 'var(--sp-2)' }}>
              Age each stage begins, in days. Leave blank for a stage this breed does not go through.
            </legend>
            {stages.map((stage, index) => (
              <div key={stage} className="row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
                <input type="hidden" name="stageName" value={stage} />
                <span style={{ flex: 1 }}>{stage}</span>
                <input
                  name="stageMinDay"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={index === 0 ? 0 : undefined}
                  style={{ width: 110 }}
                  aria-label={`${stage} starts on day`}
                />
              </div>
            ))}
          </fieldset>

          <Submit />
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
        {pending ? 'Adding…' : 'Add breed'}
      </button>
    </div>
  );
}
