'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import {
  runCreditCheck,
  setPartyStatus,
  setStandardCost,
  type CreditCheckState,
  type FlowState,
} from '@/app/(app)/master-actions';
import { formatNaira } from '@/lib/money';

const EMPTY: FlowState = { error: null, message: null };

/** Change a customer's or supplier's status, with a reason when blocking. */
export function PartyStatusForm({
  kind,
  id,
  name,
  status,
}: {
  kind: 'customers' | 'suppliers';
  id: string;
  name: string;
  status: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(setPartyStatus, EMPTY);
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState(status);

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Status
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`${name} — status`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Status
            <select name="status" value={next} onChange={(e) => setNext(e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive — kept on file, not traded with</option>
              <option value="BLOCKED">Blocked — refused everywhere</option>
            </select>
          </label>

          {next === 'BLOCKED' ? (
            <label className="field">
              Why
              <textarea name="reason" rows={3} required />
            </label>
          ) : (
            <label className="field">
              Note<span className="faint"> (optional)</span>
              <input name="reason" />
            </label>
          )}

          <Submit idle="Save" busy="Saving…" />
        </form>
      </Sheet>
    </>
  );
}

/** How much more this customer can be sold on credit. */
export function CreditCheckForm({ id, name }: { id: string; name: string }) {
  const [state, formAction] = useActionState<CreditCheckState, FormData>(runCreditCheck, {
    error: null,
    result: null,
  });
  const [open, setOpen] = useState(false);
  const result = state.result;

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Credit check
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Credit check — ${name}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="id" value={id} />
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <label className="field">
            Proposed sale (₦)
            <input name="amount" inputMode="decimal" placeholder="0.00" defaultValue="0" required />
          </label>

          <Submit idle="Check" busy="Checking…" />

          {result ? (
            <div className={`notice ${result.passed ? 'notice-success' : 'notice-warning'}`}>
              <strong>{result.passed ? 'Within limit.' : 'Would not pass.'}</strong>
              <div style={{ marginTop: 'var(--sp-2)' }}>
                Limit {result.creditLimitKobo ? formatNaira(result.creditLimitKobo) : 'not set'} ·
                owed {formatNaira(result.outstandingKobo)}
                {result.availableKobo !== null ? ` · available ${formatNaira(result.availableKobo)}` : ''}
              </div>
              {result.reasons.length > 0 ? (
                <ul style={{ margin: 'var(--sp-2) 0 0', paddingLeft: 18 }}>
                  {result.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </form>
      </Sheet>
    </>
  );
}

/** Set what one unit of an item is valued at, from a date. */
export function StandardCostForm({
  id,
  name,
  currentKobo,
  today,
}: {
  id: string;
  name: string;
  currentKobo: string | null;
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(setStandardCost, EMPTY);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        {currentKobo ? formatNaira(currentKobo) : 'Set cost'}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Standard cost — ${name}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="id" value={id} />
          <p className="faint">
            What one unit is valued at in stock, from the date given. Earlier movements keep the
            cost they were valued at.
          </p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Cost per unit (₦)
            <input name="cost" inputMode="decimal" placeholder="0.00" required />
          </label>
          <label className="field">
            Effective from
            <input name="effectiveFrom" type="date" defaultValue={today} required />
          </label>
          <label className="field">
            Source<span className="faint"> (optional)</span>
            <input name="sourceReference" placeholder="Supplier quote, costing sheet…" />
          </label>

          <Submit idle="Save cost" busy="Saving…" />
        </form>
      </Sheet>
    </>
  );
}

function Submit({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? busy : idle}
      </button>
    </div>
  );
}
