'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Sheet } from './sheet';
import {
  autoMatch,
  createBankAccount,
  ignoreLine,
  importStatement,
  matchLine,
  unsettleLine,
  type FlowState,
} from '@/app/(app)/finance/banking/actions';
import { formatNaira } from '@/lib/money';

const EMPTY: FlowState = { error: null, message: null };

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

export function AddBankAccountForm({
  ledgerAccounts,
}: {
  ledgerAccounts: Array<{ id: string; accountNumber: string; name: string }>;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(createBankAccount, EMPTY);
  const [open, setOpen] = useState(false);
  useCloseOnSuccess(state.message, () => setOpen(false));

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Add a bank account
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add a bank account">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          <label className="field">
            Name
            <input name="name" placeholder="Operating account" required />
          </label>
          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              Bank
              <input name="bankName" placeholder="e.g. GTBank" required />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              Account number
              <input name="accountNumber" inputMode="numeric" autoComplete="off" required />
            </label>
          </div>
          <label className="field">
            Ledger account
            <select name="glAccountId" defaultValue="" required>
              <option value="" disabled>
                The account payments from this bank post to
              </option>
              {ledgerAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.accountNumber} — {account.name}
                </option>
              ))}
            </select>
            <span className="faint">Each bank account needs its own ledger account.</span>
          </label>
          <Submit label="Add account" pending="Adding…" />
        </form>
      </Sheet>
    </>
  );
}

export function ImportStatementForm({ bankAccountId }: { bankAccountId: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(importStatement, EMPTY);
  const [open, setOpen] = useState(false);
  useCloseOnSuccess(state.message, () => setOpen(false));

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Import a statement
      </button>
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
      <Sheet open={open} onClose={() => setOpen(false)} title="Import a bank statement">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="bankAccountId" value={bankAccountId} />
          <p className="faint">
            The CSV your bank exports. Columns are found by their headings — a date, a description,
            and either one amount column or debit and credit columns.
          </p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <label className="field">
            Statement file (.csv)
            <input name="file" type="file" accept=".csv,text/csv" />
          </label>
          <label className="field">
            Or paste it<span className="faint"> (optional)</span>
            <textarea name="csv" rows={4} placeholder="Date,Description,Debit,Credit…" />
          </label>

          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 150 }}>
              Opening balance (₦)
              <input name="openingBalance" inputMode="decimal" required />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 150 }}>
              Closing balance (₦)
              <input name="closingBalance" inputMode="decimal" required />
            </label>
          </div>
          <span className="faint">
            Exactly as printed. The import is refused if the lines do not add up to them — that is
            how a missing or misread line gets caught.
          </span>

          <Submit label="Import" pending="Importing…" />
        </form>
      </Sheet>
    </>
  );
}

export function AutoMatchButton({ bankAccountId }: { bankAccountId: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
      <button
        type="button"
        className="btn"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await autoMatch(bankAccountId);
            setMessage(result.error ?? result.message);
            router.refresh();
          })
        }
      >
        {pending ? 'Matching…' : 'Match automatically'}
      </button>
      {message ? <span className="faint">{message}</span> : null}
    </div>
  );
}

/**
 * What can be done with one statement line: match it to a ledger line of the
 * same amount, set it aside with a reason, or undo either.
 */
export function StatementLineActions({
  bankAccountId,
  line,
  candidates,
}: {
  bankAccountId: string;
  line: { id: string; status: string; amountKobo: string };
  candidates: Array<{ id: string; journalNumber: string; journalDate: string }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState(candidates[0]?.id ?? '');
  const [ignoring, setIgnoring] = useState(false);
  const [reason, setReason] = useState('');
  const router = useRouter();

  const run = (fn: () => Promise<FlowState>) =>
    startTransition(async () => {
      const result = await fn();
      setError(result.error);
      if (!result.error) {
        setIgnoring(false);
        router.refresh();
      }
    });

  if (line.status !== 'UNMATCHED') {
    return (
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        disabled={pending}
        onClick={() => run(() => unsettleLine(bankAccountId, line.id))}
      >
        Undo
      </button>
    );
  }

  if (ignoring) {
    return (
      <div className="row" style={{ gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why — e.g. bank charge to journal"
          style={{ minWidth: 180 }}
        />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={pending}
          onClick={() => run(() => ignoreLine(bankAccountId, line.id, reason))}
        >
          Set aside
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setIgnoring(false)}>
          Cancel
        </button>
        {error ? <div className="faint" style={{ color: 'var(--error-700)' }}>{error}</div> : null}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-1)' }}>
      <div className="row" style={{ gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
        {candidates.length > 0 ? (
          <>
            <select value={choice} onChange={(e) => setChoice(e.target.value)} style={{ maxWidth: 200 }}>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.journalNumber} · {c.journalDate}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={pending || !choice}
              onClick={() => run(() => matchLine(bankAccountId, line.id, choice))}
            >
              Match
            </button>
          </>
        ) : (
          <span className="faint">No ledger line of {formatNaira(line.amountKobo)}</span>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setIgnoring(true)}>
          Set aside
        </button>
      </div>
      {error ? <div className="faint" style={{ color: 'var(--error-700)', whiteSpace: 'normal' }}>{error}</div> : null}
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
