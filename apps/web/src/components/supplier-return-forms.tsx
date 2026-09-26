'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { decideReturn, raiseReturn, type ReturnState } from '@/app/(app)/procurement/returns/actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Working…' : label}
    </button>
  );
}

export interface ReturnableLine {
  grnLineId: string;
  itemCode: string;
  description: string;
  acceptedQuantity: string;
  returnedQuantity: string;
  pendingQuantity: string;
  returnableQuantity: string;
  invoicedQuantity: string;
}

/** The lines of one posted receipt, with how much of each can still go back. */
export function RaiseReturnForm({ grnId, lines }: { grnId: string; lines: ReturnableLine[] }) {
  const [state, action] = useActionState<ReturnState, FormData>(raiseReturn, { error: null, message: null });
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="grnId" value={grnId} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Item</th>
              <th className="right">Accepted</th>
              <th className="right">Invoiced</th>
              <th className="right">Already returned</th>
              <th className="right">Can return</th>
              <th style={{ width: 140 }}>Return now</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.grnLineId}>
                <td style={{ textAlign: 'left' }}>
                  {l.itemCode} — {l.description}
                  <input type="hidden" name="grnLineId" value={l.grnLineId} />
                </td>
                <td className="num right">{Number(l.acceptedQuantity).toLocaleString('en-NG')}</td>
                <td className="num right">{Number(l.invoicedQuantity).toLocaleString('en-NG')}</td>
                <td className="num right">
                  {Number(l.returnedQuantity).toLocaleString('en-NG')}
                  {Number(l.pendingQuantity) > 0 ? <div className="faint">+{Number(l.pendingQuantity)} awaiting approval</div> : null}
                </td>
                <td className="num right">{Number(l.returnableQuantity).toLocaleString('en-NG')}</td>
                <td>
                  <input
                    name="quantity"
                    type="number"
                    min="0"
                    step="0.001"
                    max={Number(l.returnableQuantity)}
                    disabled={Number(l.returnableQuantity) <= 0}
                    aria-label={`Quantity of ${l.itemCode} to return`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-auto">
        <label className="field">
          Returned on
          <input name="returnDate" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
        </label>
        <label className="field">
          Why
          <input name="reason" placeholder="Damaged bags, wrong grade, failed inspection" required />
        </label>
      </div>
      <p className="faint" style={{ fontSize: 13, margin: 0 }}>
        What has not been invoiced comes off goods-received-not-invoiced; what has been invoiced becomes a debit note against the invoice,
        VAT included. The stock leaves once someone else approves.
      </p>
      <div>
        <Submit label="Raise return" />
      </div>
    </form>
  );
}

export function ReturnDecision({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ReturnState>({ error: null, message: null });
  const [note, setNote] = useState('');
  if (state.message) return <span className="faint">{state.message}</span>;
  const decide = (decision: 'APPROVE' | 'REJECT') => start(async () => setState(await decideReturn(id, decision, note || undefined)));
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
