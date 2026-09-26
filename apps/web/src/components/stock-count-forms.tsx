'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { decideCount, saveCounts, startCount, submitCount, type CountState } from '@/app/(app)/inventory/counts/actions';
import { formatNaira } from '@/lib/money';

const EMPTY: CountState = { error: null, message: null };

function Notices({ state }: { state: CountState }) {
  return (
    <>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
    </>
  );
}

function Submit({ label, pending }: { label: string; pending: string }) {
  const { pending: busy } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={busy}>
      {busy ? pending : label}
    </button>
  );
}

export function StartCountForm({ stores }: { stores: Array<{ id: string; label: string }> }) {
  const [state, action] = useActionState(startCount, EMPTY);
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <Notices state={state} />
      <div className="grid-auto">
        <label className="field">
          Store
          <select name="warehouseId" defaultValue="" required>
            <option value="" disabled>
              Which store is being counted?
            </option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Recount threshold (%)
          <input name="recountThresholdPercent" type="number" min="0" max="100" step="0.1" defaultValue="5" />
          <span className="faint">A difference bigger than this is counted twice</span>
        </label>
      </div>
      <p className="faint" style={{ margin: 0 }}>
        Starting freezes the store: nothing moves in or out until the count is posted or cancelled.
      </p>
      <div>
        <Submit label="Start count" pending="Freezing the store…" />
      </div>
    </form>
  );
}

export interface CountLine {
  itemId: string;
  item: string;
  bookQuantity: string;
  unitCostKobo: string;
  countedQuantity: string | null;
  countedBy: string | null;
  recountRequired: boolean;
  recountQuantity: string | null;
  recountedBy: string | null;
  reason: string | null;
  varianceQuantity: string | null;
  varianceValueKobo: string | null;
}

/**
 * The count sheet. While counting, each line takes a count (or its recount)
 * and a reason; the book quantity is shown so the counter can see a
 * difference, not so they can copy it.
 */
export function CountSheet({ countId, status, lines }: { countId: string; status: string; lines: CountLine[] }) {
  const [state, action] = useActionState(saveCounts, EMPTY);
  const editable = status === 'COUNTING';
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <input type="hidden" name="countId" value={countId} />
      <Notices state={state} />
      <div className="table-wrap">
        <table className="data wide">
          <thead>
            <tr>
              <th>Item</th>
              <th className="right" style={{ width: 110 }}>Book</th>
              <th className="right" style={{ width: 140 }}>Count</th>
              <th className="right" style={{ width: 140 }}>Recount</th>
              <th className="right" style={{ width: 110 }}>Difference</th>
              <th className="right" style={{ width: 130 }}>Value</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const final = line.recountQuantity ?? line.countedQuantity;
              const difference = line.varianceQuantity ?? (final !== null ? String(Number(final) - Number(line.bookQuantity)) : null);
              return (
                <tr key={line.itemId}>
                  <td style={{ textAlign: 'left' }}>
                    {line.item}
                    {line.recountRequired ? <span className="badge badge-warning" style={{ marginLeft: 6 }}>recount</span> : null}
                  </td>
                  <td className="num right">{Number(line.bookQuantity).toLocaleString()}</td>
                  <td className="num right">
                    {editable && !line.recountRequired ? (
                      <input name={`qty:${line.itemId}`} type="number" min="0" step="0.001" defaultValue={line.countedQuantity ?? ''} style={{ width: 110 }} aria-label="Counted" />
                    ) : (
                      line.countedQuantity ?? '—'
                    )}
                  </td>
                  <td className="num right">
                    {editable && line.recountRequired ? (
                      <input name={`qty:${line.itemId}`} type="number" min="0" step="0.001" defaultValue={line.recountQuantity ?? ''} style={{ width: 110 }} aria-label="Recounted" />
                    ) : (
                      line.recountQuantity ?? '—'
                    )}
                  </td>
                  <td className="num right">{difference !== null ? Number(difference).toLocaleString() : '—'}</td>
                  <td className="num right">{line.varianceValueKobo ? formatNaira(line.varianceValueKobo) : '—'}</td>
                  <td style={{ textAlign: 'left' }}>
                    {editable ? (
                      <input name={`reason:${line.itemId}`} defaultValue={line.reason ?? ''} placeholder="Needed for any difference" style={{ width: '100%' }} aria-label="Reason" />
                    ) : (
                      <span className="faint">{line.reason ?? '—'}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable ? (
        <div>
          <Submit label="Save counts" pending="Saving…" />
        </div>
      ) : null}
    </form>
  );
}

/** Submit (counter), or approve / hold / cancel (someone else). */
export function CountActions({ countId, status }: { countId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<CountState>(EMPTY);
  const router = useRouter();
  const run = (fn: () => Promise<CountState>) =>
    startTransition(async () => {
      const result = await fn();
      setOutcome(result);
      if (!result.error) router.refresh();
    });
  const withNote = (action: 'HOLD' | 'CANCEL') => {
    const note = window.prompt(action === 'HOLD' ? 'What is being investigated?' : 'Why is this count cancelled?') ?? '';
    if (note.trim()) run(() => decideCount(countId, action, note));
  };
  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        {status === 'COUNTING' ? (
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => submitCount(countId))}>
            Submit for approval
          </button>
        ) : null}
        {status === 'SUBMITTED' || status === 'ON_HOLD' ? (
          <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(() => decideCount(countId, 'APPROVE'))}>
            Approve and post
          </button>
        ) : null}
        {status === 'SUBMITTED' ? (
          <button type="button" className="btn" disabled={pending} onClick={() => withNote('HOLD')}>
            Hold for investigation
          </button>
        ) : null}
        {status === 'COUNTING' || status === 'SUBMITTED' || status === 'ON_HOLD' ? (
          <button type="button" className="btn" disabled={pending} onClick={() => withNote('CANCEL')}>
            Cancel count
          </button>
        ) : null}
      </div>
      <Notices state={outcome} />
    </div>
  );
}
