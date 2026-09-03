'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { parseNairaToKobo } from '@/lib/money';
import { createRecurringJournal, type FlowState } from '@/app/(app)/finance/journals/actions';

interface GlAccountOption {
  id: string;
  accountNumber: string;
  name: string;
}

interface DraftLine {
  glAccountId: string;
  description: string;
  side: 'debit' | 'credit';
  amount: string;
}

function emptyLine(): DraftLine {
  return { glAccountId: '', description: '', side: 'debit', amount: '' };
}

/**
 * A recurring template for a prepayment or accrual — same flat debit/credit
 * every run (§3), generated as a DRAFT each time it comes due and still
 * needing its own approval, never posting itself.
 */
export function CreateRecurringJournalForm({
  accounts,
  today,
}: {
  accounts: GlAccountOption[];
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(createRecurringJournal, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);

  const updateLine = (index: number, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const totalDebit = lines.reduce(
    (s, l) => s + (l.side === 'debit' ? (parseNairaToKobo(l.amount) ?? 0n) : 0n),
    0n,
  );
  const totalCredit = lines.reduce(
    (s, l) => s + (l.side === 'credit' ? (parseNairaToKobo(l.amount) ?? 0n) : 0n),
    0n,
  );
  const balanced = lines.length >= 2 && totalDebit > 0n && totalDebit === totalCredit;

  const linesPayload = JSON.stringify(
    lines
      .filter((l) => l.glAccountId && parseNairaToKobo(l.amount))
      .map((l) => ({
        glAccountId: l.glAccountId,
        description: l.description,
        ...(l.side === 'debit'
          ? { debitKobo: (parseNairaToKobo(l.amount) ?? 0n).toString() }
          : { creditKobo: (parseNairaToKobo(l.amount) ?? 0n).toString() }),
      })),
  );

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        New template
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="New recurring journal">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            Generates a draft journal each period it comes due — every draft still needs its
            own approval before it posts.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Code
            <input name="code" placeholder="e.g. RENT-2026" required />
          </label>
          <label className="field">
            Name
            <input name="name" placeholder="e.g. Monthly office rent" required />
          </label>
          <label className="field">
            Narration
            <input name="narration" placeholder="What this recurring journal is for" required />
          </label>
          <label className="field">
            Amortisation basis
            <select name="basis" defaultValue="MANUAL">
              <option value="STRAIGHT_LINE">Straight line — equal instalments</option>
              <option value="USAGE_BASED">Usage based — varies each run</option>
              <option value="MANUAL">Manual — reviewed each time</option>
            </select>
          </label>
          <label className="field">
            Frequency
            <select name="frequency" defaultValue="MONTHLY" required>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="ANNUALLY">Annually</option>
            </select>
          </label>
          <label className="field">
            Day of month
            <input name="dayOfMonth" type="number" min="1" max="28" defaultValue="1" required />
          </label>
          <label className="field">
            Start date
            <input type="date" name="startDate" defaultValue={today} required />
          </label>
          <label className="field">
            End date<span className="faint"> (optional)</span>
            <input type="date" name="endDate" />
          </label>

          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            <span className="faint">Lines (the flat amount posted every run)</span>
            {lines.map((line, index) => (
              <div
                key={index}
                className="stack"
                style={{ gap: 'var(--sp-2)', padding: 'var(--sp-3)', border: '1px solid var(--line)', borderRadius: 8 }}
              >
                <select
                  value={line.glAccountId}
                  onChange={(e) => updateLine(index, { glAccountId: e.target.value })}
                >
                  <option value="">Choose an account</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountNumber} — {a.name}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="Line description"
                  value={line.description}
                  onChange={(e) => updateLine(index, { description: e.target.value })}
                />
                <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                  <select
                    value={line.side}
                    onChange={(e) => updateLine(index, { side: e.target.value as 'debit' | 'credit' })}
                  >
                    <option value="debit">Debit</option>
                    <option value="credit">Credit</option>
                  </select>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Amount in naira"
                    value={line.amount}
                    onChange={(e) => updateLine(index, { amount: e.target.value })}
                  />
                  {lines.length > 2 ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
              Add line
            </button>
          </div>

          <p className={balanced ? 'faint' : 'notice notice-warning'} style={{ fontSize: 13 }}>
            Dr {(Number(totalDebit) / 100).toLocaleString()} · Cr {(Number(totalCredit) / 100).toLocaleString()}
            {balanced ? ' — balanced' : ' — not balanced yet'}
          </p>

          <input type="hidden" name="lines" value={linesPayload} />

          <Submit disabled={!balanced} />
        </form>
      </Sheet>
    </>
  );
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending || disabled}>
        {pending ? 'Creating…' : 'Create template'}
      </button>
    </div>
  );
}
