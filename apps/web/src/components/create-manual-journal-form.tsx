'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { parseNairaToKobo } from '@/lib/money';
import { createManualJournal, type FlowState } from '@/app/(app)/finance/journals/actions';

interface GlAccountOption {
  id: string;
  accountNumber: string;
  name: string;
}

interface ReasonCodeOption {
  code: string;
  name: string;
  journalTypeId: string | null;
}

interface DraftLine {
  glAccountId: string;
  description: string;
  side: 'debit' | 'credit';
  amount: string;
}

const JOURNAL_TYPES = [
  { code: 'GJ', name: 'General Journal' },
  { code: 'ACCR', name: 'Accrual (auto-reversing)' },
  { code: 'PREPAY', name: 'Prepayment' },
];

function emptyLine(): DraftLine {
  return { glAccountId: '', description: '', side: 'debit', amount: '' };
}

/**
 * Raise a manual journal — at least two lines, debits must equal credits
 * exactly before this will even submit. Sent for approval immediately;
 * there is no separate "save as draft" step exposed here.
 */
export function CreateManualJournalForm({
  accounts,
  reasonCodes,
  today,
}: {
  accounts: GlAccountOption[];
  reasonCodes: ReasonCodeOption[];
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(createManualJournal, {
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
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Raise a journal
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Raise a manual journal">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">At least two lines, debits equal to credits, for approval.</p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Journal type
            <select name="journalTypeCode" defaultValue="GJ" required>
              {JOURNAL_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Reason
            <select name="reasonCode" defaultValue="" required>
              <option value="" disabled>
                Why this journal is needed
              </option>
              {reasonCodes.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Reference
            <input name="reference" placeholder="e.g. ACCR-2026-09-001" required />
          </label>
          <label className="field">
            Journal date
            <input type="date" name="journalDate" defaultValue={today} required />
          </label>
          <label className="field">
            Narration
            <input name="narration" placeholder="What this journal is for" required />
          </label>

          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            <span className="faint">Lines</span>
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
        {pending ? 'Raising…' : 'Raise and send for approval'}
      </button>
    </div>
  );
}
