'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatNaira } from '@/lib/money';
import {
  previewIncomeTax,
  provideIncomeTax,
  setIncomeTaxRate,
  type IncomeTaxProvision,
} from '@/app/(app)/ledger/profit-loss/actions';

/**
 * Income tax on the year's profit to date (PCR-084): what is due, what is
 * already provided, and — for a CFO — one press to provide the difference.
 * Safe to press again; a later loss reverses what is no longer due.
 */
export function IncomeTaxPanel({ periodId }: { periodId: string }) {
  const [provision, setProvision] = useState<IncomeTaxProvision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!periodId) return;
    void previewIncomeTax(periodId).then((outcome) => {
      setProvision(outcome.provision);
      setError(outcome.error);
    });
  }, [periodId]);

  if (!periodId) return <span className="faint">No open period to provide income tax in.</span>;
  if (error && !provision) return <span className="faint">Income tax: {error}</span>;
  if (!provision) return <span className="faint">Working out income tax…</span>;

  const toPost = BigInt(provision.taxDueYtdKobo) - BigInt(provision.alreadyProvidedKobo);
  return (
    <div className="stack" style={{ gap: 'var(--sp-2)', fontSize: 14 }}>
      <span>
        Income tax at {provision.ratePercent}% on profit before tax to the end of {provision.periodName} (
        {formatNaira(provision.profitBeforeTaxYtdKobo)}): {formatNaira(provision.taxDueYtdKobo)} due,{' '}
        {formatNaira(provision.alreadyProvidedKobo)} provided.
      </span>
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={pending || toPost === 0n}
          onClick={() =>
            startTransition(async () => {
              const outcome = await provideIncomeTax(periodId);
              setError(outcome.error);
              if (outcome.provision) {
                setProvision({ ...outcome.provision, alreadyProvidedKobo: outcome.provision.taxDueYtdKobo });
                setMessage(`Posted ${formatNaira(outcome.provision.postedKobo)}.`);
                router.refresh();
              }
            })
          }
        >
          {toPost === 0n ? 'Tax is up to date' : `Provide ${formatNaira(toPost)}`}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={pending}
          onClick={() => {
            const answer = window.prompt('Company income tax rate, per cent', provision.ratePercent);
            if (answer === null) return;
            const rate = Number(answer);
            startTransition(async () => {
              const outcome = await setIncomeTaxRate(rate);
              if (outcome.error) {
                setError(outcome.error);
                return;
              }
              const refreshed = await previewIncomeTax(periodId);
              setProvision(refreshed.provision);
              setError(refreshed.error);
            });
          }}
        >
          Change rate
        </button>
      </div>
      {message ? <span className="faint">{message}</span> : null}
      {error ? <span style={{ color: 'var(--danger, #b42318)' }}>{error}</span> : null}
    </div>
  );
}
