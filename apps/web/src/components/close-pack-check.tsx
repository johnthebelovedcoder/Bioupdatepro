'use client';

import { useState, useTransition } from 'react';
import { checkClosePack, type PackCheck } from '@/app/(app)/ledger/period-close/actions';
import { formatNaira } from '@/lib/money';

/** Check one close pack against its fingerprint and against the ledger as it is now. */
export function ClosePackCheck({ packId }: { packId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PackCheck | null>(null);

  if (!result) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => startTransition(async () => setResult(await checkClosePack(packId)))}>
        {pending ? 'Checking…' : 'Check'}
      </button>
    );
  }
  if (result.error) return <span className="faint">{result.error}</span>;
  if (!result.intact) return <span className="badge badge-danger">Altered since stored</span>;
  if (result.matches) return <span className="badge badge-success">Matches the ledger</span>;
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="badge badge-warning">Ledger has changed since close</span>
      {(result.changes ?? []).slice(0, 8).map((c) => (
        <span key={c.accountNumber} className="faint" style={{ fontSize: 13 }}>
          {c.accountNumber} {c.accountName}: {formatNaira(c.atCloseKobo)} at close, {formatNaira(c.nowKobo)} now
        </span>
      ))}
    </div>
  );
}
