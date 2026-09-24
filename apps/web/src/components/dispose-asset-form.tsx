'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { disposeAsset, type FlowState } from '@/app/(app)/ledger/fixed-assets/actions';
import { formatNaira } from '@/lib/money';

/** Retire one asset — sold, scrapped or lost — and send the disposal for approval. */
export function DisposeAssetForm({
  assetId,
  assetNumber,
  name,
  netBookValueKobo,
  today,
}: {
  assetId: string;
  assetNumber: string;
  name: string;
  netBookValueKobo: string;
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(disposeAsset, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Dispose
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={`Dispose of ${assetNumber}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="assetId" value={assetId} />
          <p className="faint">
            {name} — net book value {formatNaira(netBookValueKobo)}. Once approved, its cost and
            accumulated depreciation come off the register, and depreciation stops.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Left service on
            <input name="disposedOn" type="date" defaultValue={today} max={today} required />
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
        {pending ? 'Sending…' : 'Send for approval'}
      </button>
    </div>
  );
}
