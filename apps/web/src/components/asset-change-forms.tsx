'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { decideImpairment, requestImpairment, transferAsset, type FlowState } from '@/app/(app)/ledger/fixed-assets/actions';
import { formatNaira } from '@/lib/money';

const EMPTY: FlowState = { error: null, message: null };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Working…' : label}
    </button>
  );
}

/** Raise an impairment down to the recoverable amount (IAS 36); the controller or CFO approves. */
export function ImpairAssetForm({ assetId, assetNumber, netBookValueKobo, today }: { assetId: string; assetNumber: string; netBookValueKobo: string; today: string }) {
  const [state, action] = useActionState(requestImpairment, EMPTY);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Impair
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Impair ${assetNumber}`}>
        <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="assetId" value={assetId} />
          <p className="faint">
            Carried at {formatNaira(netBookValueKobo)}. If it can now recover less — by use or by sale — the difference is an impairment loss.
            The finance controller or CFO approves it; depreciation then spreads what is left over the remaining life.
          </p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}
          <label className="field">
            Recoverable amount (₦)
            <input name="recoverableAmount" type="number" step="0.01" min="0" required />
          </label>
          <label className="field">
            As of
            <input name="impairedOn" type="date" defaultValue={today} max={today} required />
          </label>
          <label className="field">
            What indicates it
            <input name="reason" placeholder="Flood damage to the incubator housing" required />
          </label>
          <label className="field">
            Evidence
            <input name="evidence" placeholder="Engineer's report ref., valuation, photos" />
          </label>
          <Submit label="Raise impairment" />
        </form>
      </Sheet>
    </>
  );
}

/** Move an asset to another cost centre; no journal, depreciation follows it. */
export function TransferAssetForm({
  assetId,
  assetNumber,
  current,
  costCentres,
  today,
}: {
  assetId: string;
  assetNumber: string;
  current: string | null;
  costCentres: Array<{ id: string; code: string; name: string }>;
  today: string;
}) {
  const [state, action] = useActionState(transferAsset, EMPTY);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Move
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Move ${assetNumber}`}>
        <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="assetId" value={assetId} />
          <p className="faint">Now in {current ?? 'no cost centre'}. It stays in the same account; depreciation from the next run carries the new cost centre.</p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}
          <label className="field">
            To cost centre
            <select name="toCostCentreId" defaultValue="" required>
              <option value="" disabled>
                Choose
              </option>
              {costCentres.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            From
            <input name="effectiveOn" type="date" defaultValue={today} required />
          </label>
          <label className="field">
            Why
            <input name="reason" placeholder="Moved to the new hatchery building" required />
          </label>
          <Submit label="Move asset" />
        </form>
      </Sheet>
    </>
  );
}

export function ImpairmentDecision({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<FlowState>(EMPTY);
  const [note, setNote] = useState('');
  if (state.message) return <span className="faint">{state.message}</span>;
  const decide = (decision: 'APPROVE' | 'REJECT') => start(async () => setState(await decideImpairment(id, decision, note || undefined)));
  return (
    <div className="stack" style={{ gap: 'var(--sp-1)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (needed to reject)" aria-label="Decision note" />
      <div className="row" style={{ gap: 'var(--sp-1)' }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => decide('APPROVE')}>
          Approve
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => decide('REJECT')}>
          Reject
        </button>
      </div>
    </div>
  );
}
