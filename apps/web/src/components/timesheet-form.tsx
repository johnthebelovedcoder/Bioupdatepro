'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { logHours, type FlowState } from '@/app/(app)/finance/timesheets/actions';

/** Log the hours one person worked on one batch on one day. The same day again corrects it. */
export function TimesheetForm({
  employees,
  groups,
  orders = [],
  today,
}: {
  employees: Array<{ id: string; name: string; number: string }>;
  groups: Array<{ id: string; code: string; speciesKey: string }>;
  orders?: Array<{ id: string; orderNumber: string; processingCycle: string }>;
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(logHours, { error: null, message: null });
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<'batch' | 'order'>('batch');
  // The shift, as this device's clock shows it, sent as exact instants.
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const instant = (local: string) => (local ? new Date(local).toISOString() : '');

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
          {orders.length > 0 ? (
            <label className="field">
              Worked on
              <select value={target} onChange={(e) => setTarget(e.target.value as 'batch' | 'order')}>
                <option value="batch">A batch on the farm</option>
                <option value="order">A processing order</option>
              </select>
            </label>
          ) : null}
          {target === 'batch' ? (
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
          ) : (
            <label className="field">
              Processing order
              <select name="productionOrderId" defaultValue="" required>
                <option value="" disabled>
                  Choose an open order
                </option>
                {orders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Day
            <input name="workDate" type="date" defaultValue={today} max={today} required />
          </label>
          <div className="grid-auto">
            <label className="field">
              Shift start<span className="faint"> (optional)</span>
              <input type="datetime-local" onChange={(e) => setStartsAt(instant(e.target.value))} />
            </label>
            <label className="field">
              Shift end
              <input type="datetime-local" onChange={(e) => setEndsAt(instant(e.target.value))} />
            </label>
          </div>
          <input type="hidden" name="startsAt" value={startsAt} />
          <input type="hidden" name="endsAt" value={endsAt} />
          <label className="field">
            Hours
            <input name="hours" type="text" inputMode="decimal" placeholder={startsAt && endsAt ? 'worked out from the shift' : 'e.g. 7.5'} required={!(startsAt && endsAt)} />
            <span className="faint">With the shift given, a shift overlapping another of the same person is refused.</span>
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
