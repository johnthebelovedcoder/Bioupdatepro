'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createFarm, createPen, type StructureState } from '@/app/(app)/pens/actions';
import { Card } from './ui';

interface FarmOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Adding a house, pen or section.
 *
 * The farm picker only appears when there is more than one farm. A business
 * with a single site should not be asked which of its one farms a pen belongs
 * to — that is a question with no information in it, and the answer is filled
 * in server-side.
 */
export function PenForm({ farms }: { farms: FarmOption[] }) {
  const [state, action] = useActionState<StructureState, FormData>(createPen, {
    error: null,
    created: null,
  });

  return (
    <Card
      title="Add a house or pen"
      subtitle="Where the animals actually live — a poultry house, a snail pen, a nursery section"
    >
      <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}
        {state.created ? (
          <div className="notice notice-success">
            <span>
              <strong>{state.created}</strong> added. You can place a population in it now.
            </span>
          </div>
        ) : null}

        {farms.length > 1 ? (
          <label className="field">
            Which farm?
            <select name="farmId" defaultValue={state.values?.farmId ?? farms[0]?.id}>
              {farms.map((farm) => (
                <option key={farm.id} value={farm.id}>
                  {farm.name} ({farm.code})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="farmId" value={farms[0]?.id ?? ''} />
        )}

        <div className="grid-auto">
          <label className="field">
            Code
            <input name="code" defaultValue={state.values?.code} required />
            <span className="faint">Short — PH-01, PEN-A, NURSERY.</span>
          </label>
          <label className="field">
            Name
            <input name="name" defaultValue={state.values?.name} required />
            <span className="faint">What people call it out loud.</span>
          </label>
        </div>

        <Submit label="Add house or pen" pendingLabel="Adding…" />
      </form>
    </Card>
  );
}

/** Shown when there is no farm yet — a pen has to belong to something. */
export function FarmForm() {
  const [state, action] = useActionState<StructureState, FormData>(createFarm, {
    error: null,
    created: null,
  });

  return (
    <Card title="Add a farm" subtitle="A site. Most businesses have one; some have several">
      <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}
        {state.created ? (
          <div className="notice notice-success">
            <strong>{state.created}</strong> added.
          </div>
        ) : null}

        <div className="grid-auto">
          <label className="field">
            Code
            <input name="farmCode" defaultValue={state.values?.farmCode} required />
            <span className="faint">MAIN, IBADAN, SITE-2.</span>
          </label>
          <label className="field">
            Name
            <input name="farmName" defaultValue={state.values?.farmName} required />
          </label>
        </div>

        <Submit label="Add farm" pendingLabel="Adding…" />
      </form>
    </Card>
  );
}

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? pendingLabel : label}
      </button>
    </div>
  );
}
