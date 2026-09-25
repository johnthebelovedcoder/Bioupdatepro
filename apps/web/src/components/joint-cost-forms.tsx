'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { decidePrice, proposePrice, releaseMethod, type PriceState } from '@/app/(app)/production/joint-cost/actions';

const METHODS = [
  ['NRV', 'Relative sales value (NRV) at split-off — the workbook’s method'],
  ['WEIGHT', 'Relative weight'],
  ['SALES_VALUE', 'Relative sales value'],
  ['STANDARD_PERCENTAGE', 'Standard percentages'],
] as const;

/**
 * Two small controls in one: the released method (with a CFO's change), or —
 * given a price — its status with approve/reject while pending.
 */
export function JointCostControls(
  props:
    | { method: string; label: string; priceId?: undefined }
    | { priceId: string; status: string; approvedBy: string | null; rejectionReason: string | null; method?: undefined },
) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<PriceState>({ error: null, message: null });
  const router = useRouter();
  const run = (fn: () => Promise<PriceState>) =>
    startTransition(async () => {
      const result = await fn();
      setOutcome(result);
      if (!result.error) router.refresh();
    });

  if (props.priceId === undefined) {
    return (
      <div className="stack" style={{ gap: 'var(--sp-2)' }}>
        <strong>{props.label}</strong>
        <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <select
            defaultValue={props.method}
            disabled={pending}
            onChange={(event) => {
              const chosen = event.target.value;
              if (chosen !== props.method && window.confirm(`Allocate every processing order by ${chosen} from now on? Only a CFO can.`)) {
                run(() => releaseMethod(chosen));
              }
            }}
          >
            {METHODS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {outcome.error ? <span style={{ color: 'var(--danger, #b42318)' }}>{outcome.error}</span> : null}
        {outcome.message ? <span className="faint">{outcome.message}</span> : null}
      </div>
    );
  }

  if (props.status !== 'PENDING') {
    return (
      <span
        className={`badge ${props.status === 'APPROVED' ? 'badge-success' : 'badge-danger'}`}
        title={props.rejectionReason ?? (props.approvedBy ? `by ${props.approvedBy}` : undefined)}
      >
        {props.status.toLowerCase()}
        {props.approvedBy ? ` · ${props.approvedBy}` : ''}
      </span>
    );
  }
  return (
    <span className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => run(() => decidePrice(props.priceId, true))}>
        Approve
      </button>
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() => {
          const reason = window.prompt('Why is this price rejected?') ?? '';
          if (reason.trim()) run(() => decidePrice(props.priceId, false, reason));
        }}
      >
        Reject
      </button>
      {outcome.error ? <span style={{ color: 'var(--danger, #b42318)', fontSize: 12 }}>{outcome.error}</span> : null}
    </span>
  );
}

export function ProposePriceForm({ items }: { items: Array<{ id: string; label: string }> }) {
  const [state, action] = useActionState<PriceState, FormData>(proposePrice, { error: null, message: null });
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
      <div className="grid-auto">
        <label className="field">
          Output
          <select name="itemId" defaultValue="" required>
            <option value="" disabled>
              Meat, shell, offal…
            </option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Selling price per unit (₦)
          <input name="sellingPrice" type="number" step="0.01" min="0.01" required />
        </label>
        <label className="field">
          Further processing and selling cost per unit (₦)
          <input name="furtherCost" type="number" step="0.01" min="0" defaultValue="0" />
        </label>
        <label className="field">
          Applies from
          <input name="effectiveFrom" type="date" required />
        </label>
      </div>
      <label className="field">
        Evidence
        <input name="evidenceReference" placeholder="e.g. Price list March 2026, or recent sale INV-…" required />
      </label>
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Proposing…' : 'Propose price'}
    </button>
  );
}
