'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { setMarketPrice, type MarketPriceState } from '@/app/(app)/agripro/biological-assets/actions';
import type { SpeciesBreed } from '@/lib/trade';

const MODULES = [
  { key: 'snail', label: 'SnailPro' },
  { key: 'poultry', label: 'PoultryPro' },
];

/**
 * Setting a species/breed's governed market price (US-897-011) — separate
 * from raising a valuation itself. This only sets where the valuation form's
 * price fields default from; it still requires its own evidence, the same
 * as a valuation does, because a price on file is itself a market assertion.
 */
export function MarketPriceForm({ speciesBreeds }: { speciesBreeds: SpeciesBreed[] }) {
  const [state, formAction] = useActionState<MarketPriceState, FormData>(setMarketPrice, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);
  const [speciesKey, setSpeciesKey] = useState('snail');

  const breedOptions = speciesBreeds.filter((b) => b.speciesKey === speciesKey);

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Set a market price
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Set a market price">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            Where the valuation form&apos;s price fields default from for this species/breed —
            still overridable, and a valuation still needs its own evidence.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <div className="grid-auto">
            <label className="field">
              Module
              <select
                name="speciesKey"
                value={speciesKey}
                onChange={(event) => setSpeciesKey(event.target.value)}
              >
                {MODULES.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Breed
              <input name="breed" list="market-price-breed-options" placeholder="Type or choose" required />
              <datalist id="market-price-breed-options">
                {breedOptions.map((b) => (
                  <option key={b.id} value={b.name} />
                ))}
              </datalist>
            </label>
          </div>

          <div className="grid-auto">
            <label className="field">
              Effective from
              <input type="date" name="effectiveFrom" defaultValue={today()} required />
            </label>
            <label className="field">
              Market price per unit (₦)
              <input name="marketPricePerUnit" type="number" step="any" inputMode="decimal" required />
            </label>
            <label className="field">
              Costs to sell per unit (₦)
              <span className="faint"> (optional)</span>
              <input name="costsToSellPerUnit" type="number" step="any" inputMode="decimal" />
            </label>
          </div>

          <label className="field">
            Based on
            <input
              name="evidenceReference"
              placeholder="A price list, a buyer quotation, a market survey"
              required
            />
          </label>

          <Submit />
        </form>
      </Sheet>
    </>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Saving…' : 'Set price'}
      </button>
    </div>
  );
}
