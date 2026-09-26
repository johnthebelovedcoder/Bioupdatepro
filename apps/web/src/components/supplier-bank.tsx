'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Sheet } from './sheet';
import { changeSupplierBank, verifySupplierBank, type BankState } from '@/app/(app)/suppliers/actions';

const EMPTY: BankState = { error: null, message: null };

/**
 * A vendor's bank account: verified or not, and the two things that can be
 * done about it — change it (which clears the verification) or verify it
 * (by someone other than whoever entered it).
 */
export function SupplierBank({
  id,
  name,
  bankName,
  accountNumberLast4,
  accountName,
  verified,
}: {
  id: string;
  name: string;
  bankName: string | null;
  accountNumberLast4: string | null;
  accountName: string | null;
  verified: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(changeSupplierBank.bind(null, id), EMPTY);
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<BankState>(EMPTY);
  const router = useRouter();

  const verify = () => {
    const reference = window.prompt(`How was ${name}'s account confirmed? (call-back to a known number, bank letter, test transfer)`) ?? '';
    if (!reference.trim()) return;
    startTransition(async () => {
      const result = await verifySupplierBank(id, reference);
      setOutcome(result);
      if (!result.error) router.refresh();
    });
  };

  return (
    <div className="stack" style={{ gap: 4 }}>
      {accountNumberLast4 ? (
        <span>
          {bankName} ••••{accountNumberLast4}{' '}
          <span className={`badge ${verified ? 'badge-success' : 'badge-warning'}`}>{verified ? 'verified' : 'not verified'}</span>
        </span>
      ) : (
        <span className="faint">No bank account</span>
      )}
      <span className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        {accountNumberLast4 && !verified ? (
          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={verify}>
            Verify
          </button>
        ) : null}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
          {accountNumberLast4 ? 'Change' : 'Add'}
        </button>
      </span>
      {outcome.error ? <span style={{ color: 'var(--error-700)', fontSize: 12, whiteSpace: 'normal' }}>{outcome.error}</span> : null}

      <Sheet open={open} onClose={() => setOpen(false)} title={`Bank details — ${name}`}>
        <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}
          <p className="faint" style={{ margin: 0 }}>
            A change is recorded against you and clears the verification: someone else confirms the new account with the vendor before
            anything is paid to it by transfer.
          </p>
          <label className="field">
            Bank
            <input name="bankName" defaultValue={bankName ?? ''} required />
          </label>
          <label className="field">
            Account number
            <input name="accountNumber" inputMode="numeric" required />
          </label>
          <label className="field">
            Account name
            <input name="accountName" defaultValue={accountName ?? ''} required />
          </label>
          <label className="field">
            Why, and on whose instruction
            <input name="reason" required placeholder="e.g. Letter from vendor's MD dated …" />
          </label>
          <Submit />
        </form>
      </Sheet>
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Saving…' : 'Save bank details'}
      </button>
    </div>
  );
}
