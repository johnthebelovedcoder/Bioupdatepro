'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  approveOrder,
  approveTransaction,
  rejectTransaction,
  type FlowState,
} from '@/app/(app)/procurement/actions';

const EMPTY: FlowState = { error: null, message: null };

/**
 * Approving, in one button.
 *
 * The refusal is shown next to the button rather than on a page of its own,
 * because the refusals here are usually about the person pressing it — you
 * raised this, so you cannot approve it; this is above your limit — and those
 * read as answers to the click, not as errors.
 */
export function ApproveOrderButton({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(approveOrder, EMPTY);

  return (
    <form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <Pending idle="Approve" busy="Approving…" />
      {state.error ? <div className="faint" style={{ color: 'var(--error-700)' }}>{state.error}</div> : null}
      {state.message ? <div className="faint">{state.message}</div> : null}
    </form>
  );
}

/**
 * Approve or send back anything sitting in the queue.
 *
 * One form, two buttons. The reason field sits under both rather than wedged
 * between them, because it belongs to the decision rather than to the Reject
 * button — and because a cramped input squeezed into a table cell reads as a
 * stray box nobody knows the purpose of. Rejecting requires a reason; the
 * server enforces that, since the person who raised the document has to be
 * told what to fix.
 */
export function DecideButtons({ transactionId }: { transactionId: string }) {
  const [approveState, approveAction] = useActionState<FlowState, FormData>(
    approveTransaction,
    EMPTY,
  );
  const [rejectState, rejectAction] = useActionState<FlowState, FormData>(
    rejectTransaction,
    EMPTY,
  );
  const [pressed, setPressed] = useState<'approve' | 'reject' | null>(null);
  const problem = approveState.error ?? rejectState.error;

  return (
    <form className="stack" style={{ gap: 'var(--sp-2)', minWidth: 240 }}>
      <input type="hidden" name="transactionId" value={transactionId} />
      {/*
        Which button was pressed, so only that one reports progress.
        `useFormStatus` is per form, not per button, so both said "…ing" at
        once — and being told "Rejecting…" a moment after pressing Approve is
        alarming in a way a loading state should never be.
      */}
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        <Pending
          idle="Approve"
          busy="Approving…"
          formAction={approveAction}
          onPress={() => setPressed('approve')}
          reports={pressed === 'approve'}
        />
        <Pending
          idle="Reject"
          busy="Rejecting…"
          tone="btn-ghost"
          formAction={rejectAction}
          onPress={() => setPressed('reject')}
          reports={pressed === 'reject'}
        />
      </div>
      <input
        name="comments"
        placeholder="Reason — required to reject"
        style={{ minHeight: 0, whiteSpace: 'normal' }}
      />
      {problem ? (
        <div className="faint" style={{ color: 'var(--error-700)', whiteSpace: 'normal' }}>
          {problem}
        </div>
      ) : null}
    </form>
  );
}

function Pending({
  idle,
  busy,
  tone = 'btn-primary',
  formAction,
  onPress,
  /** False when another button in the same form is the one doing the work. */
  reports = true,
}: {
  idle: string;
  busy: string;
  tone?: string;
  /** Set when several buttons share one form and each submits somewhere else. */
  formAction?: (formData: FormData) => void;
  onPress?: () => void;
  reports?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`btn ${tone}`}
      disabled={pending}
      onClick={onPress}
      {...(formAction ? { formAction } : {})}
    >
      {pending && reports ? busy : idle}
    </button>
  );
}
