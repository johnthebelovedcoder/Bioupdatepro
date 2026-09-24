'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { postAllocation, setEggValue, type FlowState } from '@/app/(app)/ledger/farm-costing/actions';
import { formatNaira, parseNairaToKobo } from '@/lib/money';

const initial: FlowState = { error: null, message: null };

/** PCR-067 — what eggs are worth from a date: the eggs stock item, and a value per crate. */
export function EggValueForm({
  items,
  today,
  current,
}: {
  items: Array<{ id: string; code: string; name: string; unit: string }>;
  today: string;
  current: { itemId: string; eggsPerUnit: number } | null;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(setEggValue, initial);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [eggsPerUnit, setEggsPerUnit] = useState(String(current?.eggsPerUnit ?? 30));

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {current ? 'Change egg value' : 'Set egg value'}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Egg value">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            Eggs collected on or after the date below are valued at this. Table and hatching eggs go into
            the eggs stock item; rejects are counted but carry no value. A new value never changes eggs
            already posted.
          </p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Eggs stock item
            <select name="itemId" defaultValue={current?.itemId ?? ''} required>
              <option value="" disabled>
                Choose the item eggs are stocked as
              </option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.name} ({item.unit})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Eggs in one unit of that item
            <input
              name="eggsPerUnit"
              type="number"
              min="1"
              step="1"
              value={eggsPerUnit}
              onChange={(e) => setEggsPerUnit(e.target.value)}
              required
            />
            <span className="faint">30 for a crate, 1 if the item is counted in single eggs.</span>
          </label>
          <label className="field">
            Value of one {eggsPerUnit === '30' ? 'crate' : 'unit'}
            <input
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="In naira, e.g. 4,500"
              required
            />
            <input type="hidden" name="valuePerUnitKobo" value={(parseNairaToKobo(value) ?? 0n).toString()} />
          </label>
          <label className="field">
            From
            <input name="effectiveFrom" type="date" defaultValue={today} required />
          </label>
          <Submit label="Save value" pendingLabel="Saving…" />
        </form>
      </Sheet>
    </>
  );
}

/**
 * PCR-028/043/064 — tick the month's expense amounts to share, and they are
 * split across the populations alive that month by animal-days.
 */
export function AllocationForm({
  periodId,
  periodName,
  sources,
  shares,
}: {
  periodId: string;
  periodName: string;
  sources: Array<{ glAccountId: string; accountNumber: string; accountName: string; costCentreId: string | null; costCentre: string | null; availableKobo: string }>;
  shares: Array<{ code: string; speciesKey: string; animalDays: string }>;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(postAllocation, initial);
  const key = (s: { glAccountId: string; costCentreId: string | null }) => `${s.glAccountId}:${s.costCentreId ?? ''}`;
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(sources.map((s) => [key(s), formatNaira(s.availableKobo, { symbol: false })])),
  );

  const chosen = sources
    .filter((s) => picked[key(s)])
    .map((s) => ({ glAccountId: s.glAccountId, costCentreId: s.costCentreId, amountKobo: (parseNairaToKobo(amounts[key(s)] ?? '') ?? 0n).toString() }));
  const total = chosen.reduce((sum, s) => sum + BigInt(s.amountKobo), 0n);
  const weight = useMemo(() => shares.reduce((sum, s) => sum + Number(s.animalDays), 0), [shares]);

  if (sources.length === 0) {
    return <p className="muted">No expense in {periodName} is left to share. Post the month&rsquo;s payroll and overheads first.</p>;
  }

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
      <input type="hidden" name="financialPeriodId" value={periodId} />
      <input type="hidden" name="sources" value={JSON.stringify(chosen)} />
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 40 }} />
              <th>Account</th>
              <th className="right" style={{ width: 150 }}>Left to share</th>
              <th className="right" style={{ width: 170 }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={key(s)}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Share ${s.accountNumber}`}
                    checked={!!picked[key(s)]}
                    onChange={(e) => setPicked({ ...picked, [key(s)]: e.target.checked })}
                  />
                </td>
                <td>
                  <span className="num strong">{s.accountNumber}</span> {s.accountName}
                  {s.costCentre ? <div className="faint">{s.costCentre}</div> : null}
                </td>
                <td className="num">{formatNaira(s.availableKobo)}</td>
                <td className="right">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amounts[key(s)] ?? ''}
                    disabled={!picked[key(s)]}
                    onChange={(e) => setAmounts({ ...amounts, [key(s)]: e.target.value })}
                    style={{ textAlign: 'right', maxWidth: 150 }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <strong>How {formatNaira(total.toString())} would be shared</strong>
        {shares.length === 0 || weight === 0 ? (
          <p className="muted">No poultry or snail population was alive in {periodName}.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Population</th>
                  <th>Goes to</th>
                  <th className="right">Animal-days</th>
                  <th className="right">Share</th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => {
                  const part = Number(s.animalDays) / weight;
                  return (
                    <tr key={s.code}>
                      <td className="strong">{s.code}</td>
                      <td className="faint">
                        {s.speciesKey === 'poultry' ? 'Work in Progress (1501), flock cost' : 'Snailery Labour and Facility (612000)'}
                      </td>
                      <td className="num">{Number(s.animalDays).toLocaleString('en-NG')}</td>
                      <td className="num">
                        {formatNaira((BigInt(Math.floor(Number(total) * part))).toString())}{' '}
                        <span className="faint">({(part * 100).toFixed(1)}%)</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Submit label={`Post ${formatNaira(total.toString())} allocation`} pendingLabel="Posting…" disabled={total === 0n} />
    </form>
  );
}

function Submit({ label, pendingLabel, disabled }: { label: string; pendingLabel: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending || disabled}>
        {pending ? pendingLabel : label}
      </button>
    </div>
  );
}
