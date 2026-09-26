'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { decideWriteOff, type FlowState } from '@/app/(app)/inventory/transfers/actions';

/** A write-off's status, and approve/reject while it waits (PCR-014). */
export function WriteOffDecision({ id, status, rejectionReason }: { id: string; status: string; rejectionReason: string | null }) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<FlowState>({ error: null, message: null });
  const router = useRouter();
  if (status !== 'PENDING') {
    return (
      <span className={`badge ${status === 'POSTED' ? 'badge-success' : 'badge-danger'}`} title={rejectionReason ?? undefined}>
        {status === 'POSTED' ? 'posted' : 'rejected'}
      </span>
    );
  }
  const run = (approve: boolean) => {
    const reason = approve ? undefined : window.prompt('Why is this write-off rejected?') ?? '';
    if (!approve && !reason?.trim()) return;
    startTransition(async () => {
      const result = await decideWriteOff(id, approve, reason);
      setOutcome(result);
      if (!result.error) router.refresh();
    });
  };
  return (
    <span className="stack" style={{ gap: 4 }}>
      <span className="row" style={{ gap: 'var(--sp-2)' }}>
        <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => run(true)}>
          Approve
        </button>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(false)}>
          Reject
        </button>
      </span>
      {outcome.error ? <span style={{ color: 'var(--error-700)', fontSize: 12, whiteSpace: 'normal' }}>{outcome.error}</span> : null}
    </span>
  );
}
