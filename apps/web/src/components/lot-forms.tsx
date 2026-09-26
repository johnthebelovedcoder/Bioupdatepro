'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { decideLot, saveItemControls, type LotState } from '@/app/(app)/inventory/lots/actions';

const EMPTY: LotState = { error: null, message: null };

/** QA's release or rejection of a quarantined lot — not by whoever received it. */
export function LotDecision({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<LotState>(EMPTY);
  const [note, setNote] = useState('');
  if (state.message) return <span className="faint">{state.message}</span>;
  const decide = (decision: 'RELEASE' | 'REJECT') => start(async () => setState(await decideLot(id, decision, note || undefined)));
  return (
    <div className="stack" style={{ gap: 'var(--sp-1)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Inspection note (needed to reject)" aria-label="Inspection note" />
      <div className="row" style={{ gap: 'var(--sp-1)' }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => decide('RELEASE')}>
          Release
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => decide('REJECT')}>
          Reject
        </button>
      </div>
    </div>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

export function ItemControlsForm({ items }: { items: Array<{ id: string; label: string }> }) {
  const [state, action] = useActionState(saveItemControls, EMPTY);
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
      <div className="grid-auto">
        <label className="field">
          Item
          <select name="itemId" defaultValue="" required>
            <option value="" disabled>
              Choose
            </option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Shelf life (days)
          <input name="shelfLifeDays" type="number" min="1" step="1" placeholder="Blank: no expiry unless the pack says" />
        </label>
      </div>
      <label className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
        <input type="checkbox" name="quarantineOnReceipt" />
        Hold every receipt in quarantine until QA releases it
      </label>
      <div>
        <Save />
      </div>
    </form>
  );
}
