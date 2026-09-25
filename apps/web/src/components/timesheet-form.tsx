'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { logHours, type FlowState } from '@/app/(app)/finance/timesheets/actions';

/** Log the hours one person worked on one batch on one day. The same day again corrects it. */
export function TimesheetForm({
  employees,
  groups,
  today,
}: {
  employees: Array<{ id: string; name: string; number: string }>;
  groups: Array<{ id: string; code: string; speciesKey: string }>;
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(logHours, { error: null, message: null });
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} disabled={employees.length === 0}>
        Log hours
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Log hours">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            Hours on a batch, for one person and one day. Logging the same person, batch and day again
            replaces the hours rather than adding to them.
          </p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}
          <label className="field">
            Who
            <select name="employeeId" defaultValue="" required>
              <option value="" disabled>
                Choose a person
              </option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.number})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Batch
            <select name="groupId" defaultValue="" required>
              <option value="" disabled>
                Choose a batch
              </option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} — {g.speciesKey}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Day
            <input name="workDate" type="date" defaultValue={today} max={today} required />
          </label>
          <label className="field">
            Hours
            <input name="hours" type="text" inputMode="decimal" placeholder="e.g. 7.5" required />
          </label>
          <label className="field">
            Note<span className="faint"> (optional)</span>
            <input name="notes" type="text" placeholder="e.g. vaccination, cleaning out" />
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
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Saving…' : 'Save hours'}
      </button>
    </div>
  );
}
