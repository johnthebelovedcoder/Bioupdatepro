'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import {
  recordPayrollPayment,
  type FlowState,
} from '@/app/(app)/finance/payroll/runs/actions';
import { formatNaira } from '@/lib/money';

interface Bucket {
  bucket: string;
  label: string;
  outstandingKobo: string;
}

/**
 * Clear one of a posted run's payables: net salaries to staff, or a statutory
 * remittance. Only payables with something outstanding are offered, and the
 * amount starts at exactly what is owed — part-payment is allowed, overpaying
 * is refused by the API.
 */
export function PayrollPaymentForm({
  runId,
  runReference,
  buckets,
  bankAccounts,
  today,
  initialBucket,
}: {
  runId: string;
  runReference: string;
  buckets: Bucket[];
  bankAccounts: Array<{ id: string; accountNumber: string; name: string }>;
  today: string;
  initialBucket?: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(recordPayrollPayment, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);
  const payable = buckets.filter((b) => BigInt(b.outstandingKobo) > 0n);
  const [bucket, setBucket] = useState(initialBucket ?? payable[0]?.bucket ?? '');
  const selected = payable.find((b) => b.bucket === bucket);

  if (payable.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className={initialBucket ? 'btn btn-sm' : 'btn btn-primary'}
        onClick={() => {
          if (initialBucket) setBucket(initialBucket);
          setOpen(true);
        }}
      >
        {initialBucket ? 'Pay' : 'Record a payment'}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={`Pay — ${runReference}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="runReference" value={runReference} />

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            What is being paid
            <select name="bucket" value={bucket} onChange={(e) => setBucket(e.target.value)}>
              {payable.map((b) => (
                <option key={b.bucket} value={b.bucket}>
                  {b.label} — {formatNaira(b.outstandingKobo)} outstanding
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Amount (₦)
            <input
              key={bucket}
              name="amount"
              inputMode="decimal"
              defaultValue={selected ? formatNaira(selected.outstandingKobo, { symbol: false }) : ''}
              required
            />
          </label>

          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              Paid on
              <input name="paymentDate" type="date" defaultValue={today} required />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              Method
              <select name="method" defaultValue="BANK_TRANSFER">
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CHEQUE">Cheque</option>
                <option value="CASH">Cash</option>
              </select>
            </label>
          </div>

          <label className="field">
            Paid from
            <select name="bankGlAccountId" defaultValue="" required>
              <option value="" disabled>
                Choose an account
              </option>
              {bankAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.accountNumber} — {account.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Reference<span className="faint"> (optional)</span>
            <input name="reference" placeholder="Bank batch number, remittance receipt…" />
          </label>

          <p className="faint">
            Sent for approval as soon as it is raised. The payable only goes down once a second
            person approves it.
          </p>

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
        {pending ? 'Raising…' : 'Raise payment'}
      </button>
    </div>
  );
}
