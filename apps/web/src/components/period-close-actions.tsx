'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  prepareChecklist,
  settleChecklistItem,
  softCloseOrClose,
  requestReopen,
  approveReopen,
  reopenPeriod,
  type FlowState,
} from '@/app/(app)/ledger/period-close/actions';
import { Sheet } from './sheet';
import type { ChecklistItem } from '@/lib/closing';

/** A single-click action that just needs the period id — prepare, or a plain refresh after one succeeds. */
export function PrepareChecklistButton({ periodId }: { periodId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await prepareChecklist(periodId);
            setError(result.error);
            if (!result.error) router.refresh();
          })
        }
      >
        {pending ? 'Preparing…' : 'Prepare checklist'}
      </button>
      {error ? <div className="notice notice-error" style={{ marginTop: 'var(--sp-2)' }}>{error}</div> : null}
    </div>
  );
}

/** Mark one checklist step complete, waived (with a reason) or failed. */
export function ChecklistItemActions({ periodId, item }: { periodId: string; item: ChecklistItem }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState('');
  const router = useRouter();

  const settle = (status: 'COMPLETE' | 'WAIVED' | 'FAILED', comments = '') =>
    startTransition(async () => {
      const result = await settleChecklistItem(periodId, item.id, status, comments);
      setError(result.error);
      if (!result.error) {
        setWaiving(false);
        router.refresh();
      }
    });

  if (item.status !== 'PENDING') {
    return <span className="faint">{item.completedBy ? `by ${item.completedBy}` : ''}</span>;
  }

  if (waiving) {
    return (
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for waiving"
          style={{ minWidth: 160 }}
        />
        <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => settle('WAIVED', reason)}>
          Confirm
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setWaiving(false)}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => settle('COMPLETE')}>
          Complete
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => setWaiving(true)}>
          Waive
        </button>
        {!item.blocking ? (
          <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={() => settle('FAILED')}>
            Failed
          </button>
        ) : null}
      </div>
      {error ? <div className="notice notice-error" style={{ marginTop: 'var(--sp-2)' }}>{error}</div> : null}
    </div>
  );
}

/** Soft-close or close the period, with an optional reason. */
export function ClosePeriodButton({
  periodId,
  action,
  label,
  pendingLabel,
  canClose,
}: {
  periodId: string;
  action: 'soft-close' | 'close';
  label: string;
  pendingLabel: string;
  canClose: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const router = useRouter();

  return (
    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        style={{ maxWidth: 320 }}
      />
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending || !canClose}
        onClick={() =>
          startTransition(async () => {
            const result = await softCloseOrClose(periodId, action, reason);
            setError(result.error);
            if (!result.error) router.refresh();
          })
        }
      >
        {pending ? pendingLabel : label}
      </button>
      {!canClose ? (
        <span className="faint">Blocking findings must pass first — see Validation above.</span>
      ) : null}
      {error ? <div className="notice notice-error">{error}</div> : null}
    </div>
  );
}

/** Raise a request to reopen a closed period, for another approver to act on. */
export function RequestReopenForm({ periodId }: { periodId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<FlowState, FormData>(requestReopen, {
    error: null,
    message: null,
  });
  const router = useRouter();

  useEffect(() => {
    if (state.message) {
      setOpen(false);
      router.refresh();
    }
    // Only when a fresh success message arrives — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.message]);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Request reopen
      </button>
      {open ? (
        <Sheet open onClose={() => setOpen(false)} title="Request to reopen this period">
          <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
            <input type="hidden" name="periodId" value={periodId} />
            {state.error ? <div className="notice notice-error">{state.error}</div> : null}
            <label className="field">
              Reason
              <textarea
                name="reason"
                rows={3}
                placeholder="Why does this closed period need to be reopened?"
                required
              />
            </label>
            <ReopenSubmit />
          </form>
        </Sheet>
      ) : null}
    </>
  );
}

function ReopenSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Requesting…' : 'Request reopen'}
    </button>
  );
}

/** Approve a reopen request (Rule 4 — cannot be the person who requested it), or reopen once approved. */
export function ReopenRequestActions({
  periodId,
  requestId,
  canApprove,
  canReopen,
}: {
  periodId: string;
  requestId: string;
  canApprove: boolean;
  canReopen: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!canApprove && !canReopen) return null;

  return (
    <div>
      {canApprove ? (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await approveReopen(periodId, requestId);
              setError(result.error);
              if (!result.error) router.refresh();
            })
          }
        >
          {pending ? 'Approving…' : 'Approve'}
        </button>
      ) : null}
      {canReopen ? (
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await reopenPeriod(periodId, requestId);
              setError(result.error);
              if (!result.error) router.refresh();
            })
          }
        >
          {pending ? 'Reopening…' : 'Reopen'}
        </button>
      ) : null}
      {error ? <div className="notice notice-error" style={{ marginTop: 'var(--sp-2)' }}>{error}</div> : null}
    </div>
  );
}
