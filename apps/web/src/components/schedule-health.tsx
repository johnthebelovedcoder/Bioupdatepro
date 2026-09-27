'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { scheduleHealthEvent, skipHealthEvent, type HealthState } from '@/app/(app)/m/health-actions';

const KINDS = ['Vaccination', 'Deworming', 'Treatment', 'Vitamin', 'Health check'];

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? busy : label}
    </button>
  );
}

/** Put a vaccination or treatment on a batch's programme, for the day it is due (PLY-008). */
export function ScheduleHealthButton({ groups, groupLabel, today }: { groups: string[]; groupLabel: string; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<HealthState, FormData>(scheduleHealthEvent, { error: null, message: null });
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)} disabled={groups.length === 0}>
        Schedule
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Schedule a vaccination or treatment">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}
          <label className="field">
            {groupLabel}
            <select name="groupCode" required defaultValue={groups[0]}>
              {groups.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Kind
            <select name="kind" defaultValue="Vaccination">
              {KINDS.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Vaccine or treatment
            <input name="name" placeholder="Newcastle (Lasota), Gumboro…" required />
          </label>
          <label className="field">
            Due on
            <input name="dueOn" type="date" defaultValue={today} required />
          </label>
          <label className="field">
            Dose and route<span className="faint"> (optional)</span>
            <input name="detail" placeholder="1 dose per bird, in drinking water" />
          </label>
          <div>
            <Submit label="Schedule it" busy="Scheduling…" />
          </div>
        </form>
      </Sheet>
    </>
  );
}

/** Stand a scheduled event down with the reason — not given, and not counted as missed. */
export function SkipHealthEvent({ eventId, name }: { eventId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<HealthState, FormData>(skipHealthEvent, { error: null, message: null });
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        Not giving it
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Not giving ${name}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}
          <input type="hidden" name="eventId" value={eventId} />
          <label className="field">
            Why
            <input name="reason" placeholder="Vet stood it down; programme changed…" required />
          </label>
          <div>
            <Submit label="Stand it down" busy="Saving…" />
          </div>
        </form>
      </Sheet>
    </>
  );
}
