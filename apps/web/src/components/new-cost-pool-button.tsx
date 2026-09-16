'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createCostPool, type CreatePoolState } from '@/app/(app)/production/cost-pools/actions';
import { Sheet } from './sheet';

const EMPTY: CreatePoolState = { error: null };

export function NewCostPoolButton() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<CreatePoolState, FormData>(createCostPool, EMPTY);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        New cost pool
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="New cost pool">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            A pool of overhead and the one measurable thing that drives it — machine hours, labour
            hours, kilos processed. Set its cost and capacity separately, once this exists.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <div className="grid-auto">
            <label className="field">
              Pool code
              <input name="code" placeholder="POOL-DRESS" required />
            </label>
            <label className="field">
              Name
              <input name="name" placeholder="Dressing line overhead" required />
            </label>
          </div>

          <label className="field">
            Driver
            <input name="driverName" placeholder="Machine hours" required />
            <span className="faint">
              What practical capacity is measured in — the rate becomes cost ÷ this.
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
      {pending ? 'Creating…' : 'Create pool'}
    </button>
  );
}
