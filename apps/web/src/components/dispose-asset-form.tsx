'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { disposeAsset, type FlowState } from '@/app/(app)/ledger/fixed-assets/actions';
import { formatNaira } from '@/lib/money';
import type { FixedAssetDisposalOptions } from '@/lib/fixed-assets';

/** Retire one asset — sold, scrapped or lost — and send the disposal for approval. */
export function DisposeAssetForm({
  assetId,
  assetNumber,
  name,
  netBookValueKobo,
  today,
  bankAccounts,
  customers,
}: {
  assetId: string;
  assetNumber: string;
  name: string;
  netBookValueKobo: string;
  today: string;
  bankAccounts: FixedAssetDisposalOptions['bankAccounts'];
  customers: FixedAssetDisposalOptions['customers'];
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(disposeAsset, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);
  const [proceeds, setProceeds] = useState('0');
  const [mode, setMode] = useState<'CASH' | 'CREDIT'>('CASH');
  const hasProceeds = Number(proceeds) > 0;

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

          <label className="field">
            Disposal proceeds, if any (₦)
            <input name="proceedsNaira" type="number" min="0" step="0.01" value={proceeds} onChange={(event) => setProceeds(event.target.value)} />
          </label>

          {hasProceeds ? <>
            <label className="field">
              Proceeds type
              <select name="proceedsMode" value={mode} onChange={(event) => setMode(event.target.value as 'CASH' | 'CREDIT')}>
                <option value="CASH">Received into bank</option>
                <option value="CREDIT">Customer owes us</option>
              </select>
            </label>
            {mode === 'CASH' ? <label className="field">
              Bank account
              <select name="bankAccountId" required defaultValue="">
                <option value="" disabled>Select the receiving bank</option>
                {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} — {account.bankName} {account.accountNumber}</option>)}
              </select>
            </label> : <label className="field">
              Customer
              <select name="customerId" required defaultValue="">
                <option value="" disabled>Select the customer</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} — {customer.name}</option>)}
              </select>
            </label>}
          </> : null}

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
