'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Card } from './ui';
import { parseNairaToKobo } from '@/lib/money';
import { capitaliseAsset, type FlowState } from '@/app/(app)/ledger/fixed-assets/actions';

interface Named {
  id: string;
  code: string;
  name: string;
}

/**
 * Capitalising an asset — landed cost, useful life, and where the cost sits.
 *
 * Nothing here posts by itself: this raises the capitalisation and sends it
 * for approval, the same maker-checker every other document type here goes
 * through before the ledger moves.
 */
export function CapitaliseAssetForm({
  costCentres,
  today,
}: {
  costCentres: Named[];
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(capitaliseAsset, {
    error: null,
    message: null,
  });
  const [cost, setCost] = useState('');

  return (
    <Card title="Capitalise an asset" subtitle="Landed cost and useful life, for approval">
      <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}
        {state.message ? <div className="notice notice-success">{state.message}</div> : null}

        <div className="grid-auto">
          <label className="field">
            Name
            <input name="name" placeholder="e.g. Delivery van" required />
          </label>
          <label className="field">
            Class
            <input name="assetClass" placeholder="e.g. Vehicle, Machinery, Building" required />
          </label>
          <label className="field">
            Acquisition date
            <input type="date" name="acquisitionDate" defaultValue={today} required />
          </label>
          <label className="field">
            Cost
            <input
              type="text"
              inputMode="decimal"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              placeholder="Landed cost, in naira"
              required
            />
            <input name="costKobo" type="hidden" value={(parseNairaToKobo(cost) ?? 0n).toString()} />
          </label>
          <label className="field">
            Useful life (months)
            <input name="usefulLifeMonths" type="number" min="1" placeholder="e.g. 60" required />
          </label>
          <label className="field">
            Cost centre<span className="faint"> (optional)</span>
            <select name="costCentreId" defaultValue="">
              <option value="">None</option>
              {costCentres.map((cc) => (
                <option key={cc.id} value={cc.id}>
                  {cc.code} — {cc.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Submit />
      </form>
    </Card>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Capitalising…' : 'Capitalise'}
      </button>
    </div>
  );
}
