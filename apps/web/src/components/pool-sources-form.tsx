'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { setPoolSources, type PoolSourceState } from '@/app/(app)/production/cost-pools/actions';

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : 'Save sources'}
    </button>
  );
}

/** The expense accounts a pool's cost comes from (AC-MFG-004). */
export function PoolSourcesForm({
  poolId,
  poolCode,
  current,
  accounts,
  costCentres,
}: {
  poolId: string;
  poolCode: string;
  current: Array<{ glAccountId: string; costCentreId: string | null }>;
  accounts: Array<{ id: string; label: string }>;
  costCentres: Array<{ id: string; label: string }>;
}) {
  const [state, action] = useActionState<PoolSourceState, FormData>(setPoolSources, { error: null, message: null });
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(current.length ? current.map((c) => ({ ...c })) : [{ glAccountId: '', costCentreId: null as string | null }]);
  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Ledger sources
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Where ${poolCode}'s cost comes from`}>
        <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
          <input type="hidden" name="poolId" value={poolId} />
          <p className="faint">The expense accounts whose posted cost is this pool. A cost centre narrows an account to that centre.</p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}
          {rows.map((row, i) => (
            <div key={i} className="grid-auto">
              <label className="field">
                Account
                <select
                  name="glAccountId"
                  value={row.glAccountId}
                  onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, glAccountId: e.target.value } : x)))}
                >
                  <option value="">— none —</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Cost centre
                <select
                  name="costCentreId"
                  value={row.costCentreId ?? ''}
                  onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, costCentreId: e.target.value || null } : x)))}
                >
                  <option value="">Any</option>
                  {costCentres.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((r) => [...r, { glAccountId: '', costCentreId: null }])}>
              + Another account
            </button>
          </div>
          <Save />
        </form>
      </Sheet>
    </>
  );
}
