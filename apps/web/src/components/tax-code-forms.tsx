'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Sheet } from './sheet';
import {
  createTaxCode,
  setTaxCodeActive,
  setTaxRate,
  type FlowState,
} from '@/app/(app)/ledger/tax/codes/actions';

const EMPTY: FlowState = { error: null, message: null };

/** Close the sheet and refresh the page once a fresh success message arrives. */
function useCloseOnSuccess(message: string | null, close: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (message) {
      close();
      router.refresh();
    }
    // Only when a fresh success message arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);
}

export function AddTaxCodeForm({ today }: { today: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(createTaxCode, EMPTY);
  const [open, setOpen] = useState(false);
  const [taxType, setTaxType] = useState<'VAT' | 'WHT'>('VAT');
  useCloseOnSuccess(state.message, () => setOpen(false));

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Add a code
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add a tax code">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <label className="field">
            Tax
            <select
              name="taxType"
              value={taxType}
              onChange={(e) => setTaxType(e.target.value as 'VAT' | 'WHT')}
            >
              <option value="VAT">VAT</option>
              <option value="WHT">Withholding tax (WHT)</option>
            </select>
          </label>

          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              Code
              <input name="code" placeholder={taxType === 'VAT' ? 'VAT-REDUCED' : 'WHT-HIRE'} required />
            </label>
            <label className="field" style={{ flex: 2, minWidth: 180 }}>
              Name
              <input name="name" required />
            </label>
          </div>

          {taxType === 'VAT' ? (
            <label className="field">
              Treatment
              <select name="treatment" defaultValue="STANDARD">
                <option value="STANDARD">Standard — output tax charged, input tax recoverable</option>
                <option value="ZERO_RATED">Zero-rated — no output tax, input tax recoverable</option>
                <option value="EXEMPT">Exempt — no output tax, input tax not recoverable</option>
                <option value="OUT_OF_SCOPE">Outside the scope of VAT</option>
              </select>
            </label>
          ) : (
            <label className="field">
              Category<span className="faint"> (optional)</span>
              <input name="whtCategory" placeholder="Defaults to the name" />
            </label>
          )}

          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 120 }}>
              Rate (%)
              <input name="ratePercent" inputMode="decimal" placeholder="7.5" required />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 150 }}>
              From
              <input name="effectiveFrom" type="date" defaultValue={today} required />
            </label>
          </div>

          <label className="field">
            Source
            <input name="sourceReference" placeholder="The Act, circular or adviser's letter" required />
          </label>

          <Submit label="Add code" pending="Adding…" />
        </form>
      </Sheet>
    </>
  );
}

export function SetRateForm({
  taxCodeId,
  code,
  currentRatePercent,
  today,
}: {
  taxCodeId: string;
  code: string;
  currentRatePercent: string | null;
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(setTaxRate, EMPTY);
  const [open, setOpen] = useState(false);
  useCloseOnSuccess(state.message, () => setOpen(false));

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        New rate
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`New rate — ${code}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="taxCodeId" value={taxCodeId} />
          <p className="faint">
            {currentRatePercent !== null ? `Currently ${currentRatePercent}%. ` : ''}
            The current rate stays in force until the day before the new one starts, so past
            documents keep the rate they were calculated at. A new rate cannot start inside a
            period that has been closed or filed.
          </p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 120 }}>
              New rate (%)
              <input name="ratePercent" inputMode="decimal" required />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 150 }}>
              From
              <input name="effectiveFrom" type="date" defaultValue={today} required />
            </label>
          </div>
          <label className="field">
            Source
            <input name="sourceReference" placeholder="The Act, circular or adviser's letter" required />
          </label>

          <Submit label="Set rate" pending="Saving…" />
        </form>
      </Sheet>
    </>
  );
}

export function ToggleTaxCodeButton({ taxCodeId, active }: { taxCodeId: string; active: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setTaxCodeActive(taxCodeId, !active);
            setError(result.error);
            if (!result.error) router.refresh();
          })
        }
      >
        {pending ? '…' : active ? 'Deactivate' : 'Reactivate'}
      </button>
      {error ? <div className="notice notice-error" style={{ marginTop: 'var(--sp-2)' }}>{error}</div> : null}
    </div>
  );
}

function Submit({ label, pending: pendingLabel }: { label: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? pendingLabel : label}
      </button>
    </div>
  );
}
