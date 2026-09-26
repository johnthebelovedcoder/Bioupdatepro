'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { cancelLeave, decideLeave, requestLeave, savePolicy, type LeaveState } from '@/app/(app)/staff/leave/actions';

const EMPTY: LeaveState = { error: null, message: null };

function Notices({ state }: { state: LeaveState }) {
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

export function LeaveRequestForm({ employees, today }: { employees: Array<{ id: string; label: string }>; today: string }) {
  const [state, action] = useActionState(requestLeave, EMPTY);
  const [type, setType] = useState('ANNUAL');
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <Notices state={state} />
      <div className="grid-auto">
        <label className="field">
          Employee
          <select name="employeeId" defaultValue="" required>
            <option value="" disabled>
              Who is going on leave?
            </option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Type
          <select name="type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ANNUAL">Annual (full pay)</option>
            <option value="SICK">Sick (full pay, certificate)</option>
            <option value="MATERNITY">Maternity</option>
            <option value="UNPAID">Unpaid</option>
          </select>
        </label>
        <label className="field">
          First day
          <input name="startDate" type="date" defaultValue={today} required />
        </label>
        <label className="field">
          Last day
          <input name="endDate" type="date" defaultValue={today} required />
        </label>
      </div>
      <label className="field">
        Reason
        <input name="reason" required />
      </label>
      <div className="grid-auto">
        <label className="field">
          Handover
          <input name="handover" placeholder="Who covers, and what they need to know" />
        </label>
        <label className="field">
          {type === 'SICK' ? 'Medical certificate' : 'Evidence (optional)'}
          <input name="evidenceReference" required={type === 'SICK'} placeholder={type === 'SICK' ? 'Clinic and certificate number' : ''} />
        </label>
      </div>
      <Submit label="Request leave" />
    </form>
  );
}

export function LeaveDecision({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<LeaveState>(EMPTY);
  const router = useRouter();
  const run = (fn: () => Promise<LeaveState>) =>
    startTransition(async () => {
      const result = await fn();
      setOutcome(result);
      if (!result.error) router.refresh();
    });
  const ask = (question: string) => window.prompt(question) ?? '';
  return (
    <span className="stack" style={{ gap: 4 }}>
      <span className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        {status === 'PENDING' ? (
          <>
            <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => run(() => decideLeave(id, true))}>
              Approve
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={pending}
              onClick={() => {
                const note = ask('Why is this leave refused?');
                if (note.trim()) run(() => decideLeave(id, false, note));
              }}
            >
              Refuse
            </button>
          </>
        ) : null}
        {status === 'PENDING' || status === 'APPROVED' ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={pending}
            onClick={() => {
              const note = status === 'APPROVED' ? ask('Why is approved leave cancelled?') : 'Withdrawn';
              if (note.trim()) run(() => cancelLeave(id, note));
            }}
          >
            Cancel
          </button>
        ) : null}
      </span>
      {outcome.error ? <span style={{ color: 'var(--error-700)', fontSize: 12, whiteSpace: 'normal' }}>{outcome.error}</span> : null}
    </span>
  );
}

export function LeavePolicyForm({ policy }: { policy: Record<string, number> }) {
  const [state, action] = useActionState(savePolicy, EMPTY);
  const field = (name: string, label: string) => (
    <label className="field">
      {label}
      <input name={name} type="number" min="0" step="1" defaultValue={policy[name]} />
    </label>
  );
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <Notices state={state} />
      <div className="grid-auto">
        {field('annualDays', 'Annual days')}
        {field('annualServiceMonths', 'Annual after (months)')}
        {field('carryOverYears', 'Carry over (years)')}
        {field('sickDays', 'Sick days a year')}
        {field('maternityWeeks', 'Maternity weeks')}
        {field('maternityPayPercent', 'Maternity pay (%)')}
        {field('maternityServiceMonths', 'Maternity pay after (months)')}
      </div>
      <p className="faint" style={{ margin: 0 }}>The policy can be more generous than the Labour Act, never less.</p>
      <Submit label="Save policy" />
    </form>
  );
}
