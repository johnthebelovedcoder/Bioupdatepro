'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { closeBatch, type CloseState } from '@/app/(app)/m/close-batch-actions';

/**
 * Close a finished (or trial) batch. It stays in the records for ever — a
 * closed batch is where a cycle's profit is read — but leaves the pickers,
 * the population counts and every later month's share of wages.
 */
export function CloseBatchForm({ code, population, startedOn, today }: { code: string; population: number; startedOn: string; today: string }) {
  const [state, formAction] = useActionState<CloseState, FormData>(closeBatch, { error: null, message: null });
  const [open, setOpen] = useState(false);
  const [writeOff, setWriteOff] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Close batch
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Close ${code}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="code" value={code} />
          <p className="faint">
            A closed batch keeps all its records and its figures, but no longer appears in the round, the pickers or
            later months&rsquo; wage sharing. Closing cannot be undone.
          </p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}
          <label className="field">
            Closes on
            <input name="closedOn" type="date" defaultValue={today} min={startedOn.slice(0, 10)} max={today} required />
          </label>
          <label className="field">
            Why
            <input name="reason" type="text" placeholder="e.g. Sold out, cycle finished — or: trial batch, not real stock" required />
          </label>
          {population > 0 ? (
            <div className="notice notice-warning stack" style={{ gap: 'var(--sp-2)' }}>
              <span>
                {population.toLocaleString('en-NG')} animal{population === 1 ? ' is' : 's are'} still recorded. Record their sale,
                harvest or deaths first — or write {population === 1 ? 'it' : 'them'} off now.
              </span>
              <label className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="writeOffRemaining" checked={writeOff} onChange={(e) => setWriteOff(e.target.checked)} />
                Write off what is left as a loss (their cost goes to Production Loss)
              </label>
            </div>
          ) : null}
          <Submit disabled={population > 0 && !writeOff} />
        </form>
      </Sheet>
    </>
  );
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending || disabled}>
        {pending ? 'Closing…' : 'Close batch'}
      </button>
    </div>
  );
}
