'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { grantDelegation, type FlowState } from '@/app/(app)/approvals/delegations/actions';
import type { Colleague } from '@/lib/delegations';

/** Lend your own approval authority to a colleague for a window. */
export function GrantDelegationForm({ colleagues, today }: { colleagues: Colleague[]; today: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(grantDelegation, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Delegate my authority
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Delegate your approval authority">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            For the window below, this person can approve anything you could — everything you
            hold a role for, not one document type. They act as themselves; they still cannot
            approve anything they raised.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Delegate to
            <select name="delegateId" defaultValue="" required>
              <option value="" disabled>
                Who this goes to
              </option>
              {colleagues.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Starts
            <input type="date" name="startDate" defaultValue={today} required />
          </label>
          <label className="field">
            Ends
            <input type="date" name="endDate" required />
          </label>
          <label className="field">
            Reason
            <input name="reason" placeholder="Leave, travel, a document stuck with no one else to approve it" required />
          </label>

          <Submit />
        </form>
      </Sheet>
    </>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Granting…' : 'Grant delegation'}
    </button>
  );
}
