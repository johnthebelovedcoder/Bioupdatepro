'use client';

import { useState, useTransition } from 'react';
import { receiveTransfer } from '@/app/(app)/inventory/transfers/actions';

/** Confirms stock arrived at the destination store — posted at the original transfer value. */
export function ReceiveTransferButton({ transferId }: { transferId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      <button
        type="button"
        className="btn btn-sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await receiveTransfer(transferId);
            setError(result.error);
          })
        }
      >
        {pending ? 'Receiving…' : 'Receive'}
      </button>
      {error ? <div className="notice notice-error" style={{ marginTop: 'var(--sp-2)' }}>{error}</div> : null}
    </div>
  );
}
