'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Sheet } from './sheet';
import { closeFinancialYear, type FlowState } from '@/app/(app)/ledger/year-end/actions';

/**
 * The year-end close, behind a typed confirmation.
 *
 * Unlike almost everything else here this posts on the spot — there is no
 * approval step behind it — so the one safeguard the screen can add is making
 * sure nobody does it with a stray click.
 */
export function YearEndCloseForm({
  financialYearId,
  yearCode,
  canClose,
  equityAccounts,
}: {
  financialYearId: string;
  yearCode: string;
  canClose: boolean;
  equityAccounts: Array<{ id: string; accountNumber: string; name: string }>;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(closeFinancialYear, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);
  const [rollForward, setRollForward] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (state.message) router.refresh();
    // Only when a fresh success message arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message]);

  return (
    <>
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canClose}
            onClick={() => setOpen(true)}
          >
            Close {yearCode}
          </button>
        </div>
        {!canClose ? (
          <span className="faint">Every blocking check above has to pass first.</span>
        ) : null}
        {state.message ? <div className="notice notice-success">{state.message}</div> : null}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={`Close ${yearCode}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="financialYearId" value={financialYearId} />
          <input type="hidden" name="yearCode" value={yearCode} />

          <div className="notice notice-warning">
            This posts straight away, with no approval step. Revenue and expense are swept to
            retained earnings and the year&rsquo;s closing balances are recorded.
          </div>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <label className="field">
            Retained earnings account
            <select name="retainedEarningsGlAccountId" defaultValue="">
              <option value="">The one this company has configured</option>
              {equityAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.accountNumber} — {account.name}
                </option>
              ))}
            </select>
          </label>

          <label className="row" style={{ gap: 'var(--sp-2)' }}>
            <input
              type="checkbox"
              name="rollForward"
              checked={rollForward}
              onChange={(e) => setRollForward(e.target.checked)}
            />
            Open the next year and carry balance-sheet balances into it
          </label>

          {rollForward ? (
            <label className="field">
              Next year&rsquo;s code<span className="faint"> (optional)</span>
              <input name="nextYearCode" placeholder="Worked out from this one if left blank" />
            </label>
          ) : null}

          <label className="field">
            Type <strong>{yearCode}</strong> to confirm
            <input name="confirm" autoComplete="off" required />
          </label>

          <Submit yearCode={yearCode} />
        </form>
      </Sheet>
    </>
  );
}

function Submit({ yearCode }: { yearCode: string }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Closing…' : `Close ${yearCode}`}
      </button>
    </div>
  );
}
