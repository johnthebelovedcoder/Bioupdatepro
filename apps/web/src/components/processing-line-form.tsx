'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { setProcessingLine, type FlowState } from '@/app/(app)/ledger/fixed-assets/actions';

export const PROCESSING_LINES = {
  SNAILPRO: 'Snail processing (621200)',
  POULTRYPRO: 'Poultry processing (622100)',
  FEED_MILL: 'Feed mill (623100)',
} as const;

/** PCR-031 — the processing line a machine serves; its depreciation becomes that line's overhead. */
export function ProcessingLineForm({
  assetId,
  assetNumber,
  current,
}: {
  assetId: string;
  assetNumber: string;
  current: keyof typeof PROCESSING_LINES | null;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(setProcessingLine, { error: null, message: null });
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Line
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Processing line for ${assetNumber}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="assetId" value={assetId} />
          <p className="faint">
            A machine that serves one processing line or the feed mill is part of that line&rsquo;s
            cost. Its monthly depreciation posts to the line&rsquo;s overhead instead of general
            depreciation expense. Runs already posted are not changed.
          </p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}
          <label className="field">
            Serves
            <select name="processingCycle" defaultValue={current ?? ''}>
              <option value="">No processing line (general depreciation, 5501)</option>
              {Object.entries(PROCESSING_LINES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
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
        {pending ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
