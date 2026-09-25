'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { setMachineHours, type FlowState } from '@/app/(app)/ledger/fixed-assets/actions';
import { PROCESSING_LINES } from './processing-line-form';

/**
 * PCR-031 by machine hours — how long a machine ran on each processing line
 * in a month. That month's depreciation for it is split by these hours.
 */
export function MachineHoursForm({
  assetId,
  assetNumber,
  periods,
}: {
  assetId: string;
  assetNumber: string;
  periods: Array<{ id: string; name: string; status: string }>;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(setMachineHours, { error: null, message: null });
  const [open, setOpen] = useState(false);
  const open_ = periods.filter((p) => p.status === 'OPEN');

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Hours
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Machine hours for ${assetNumber}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="assetId" value={assetId} />
          <p className="faint">
            For a machine shared between lines. Its depreciation for the month is split across the lines by
            these hours; a month with no hours goes to its one line, or to general depreciation. Saving
            replaces what was logged for that month.
          </p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}
          <label className="field">
            Month
            <select name="financialPeriodId" defaultValue={open_[open_.length - 1]?.id ?? ''} required>
              {open_.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {Object.entries(PROCESSING_LINES).map(([line, label]) => (
            <label key={line} className="field">
              {label}
              <input name={line} type="text" inputMode="decimal" placeholder="Hours, e.g. 42.5" />
            </label>
          ))}
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
