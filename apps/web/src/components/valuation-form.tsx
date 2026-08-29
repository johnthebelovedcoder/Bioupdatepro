'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { formatNaira } from '@/lib/money';
import { requestValuation, type ValuationState } from '@/app/(app)/agripro/biological-assets/actions';
import type { BiologicalAssetGroup, MarketPrice } from '@/lib/biological-assets';

/**
 * Raising a valuation.
 *
 * This form asserts two numbers — a market price and a cost to sell — and
 * nothing else on the page can. §61.6 calls that a decision, not a fact, and
 * singles out who may make it: whoever fills this in is the preparer: a
 * Finance Controller still has to approve it before the gain or loss
 * reaches the ledger. Submitting sends it to /approvals; it does not post.
 *
 * Choosing a population prefills the price fields from the governed market
 * price list (US-897-011) where one exists for its species/breed — still
 * just a starting point, editable, and still requiring its own evidence.
 */
export function ValuationForm({
  groups,
  marketPrices,
}: {
  groups: BiologicalAssetGroup[];
  marketPrices: MarketPrice[];
}) {
  const [state, formAction] = useActionState<ValuationState, FormData>(requestValuation, {
    error: null,
    message: null,
  });
  const valued = groups.filter((g) => g.acquisitionPosted);
  const [open, setOpen] = useState(false);
  const [marketPricePerUnit, setMarketPricePerUnit] = useState('');
  const [costsToSellPerUnit, setCostsToSellPerUnit] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');

  function onChooseGroup(groupId: string) {
    const group = valued.find((g) => g.id === groupId);
    const priced = group
      ? marketPrices.find((p) => p.speciesKey === group.speciesKey && p.breed === group.breed)
      : undefined;
    setMarketPricePerUnit(priced ? koboToNaira(priced.marketPricePerUnitKobo) : '');
    setCostsToSellPerUnit(priced ? koboToNaira(priced.costsToSellPerUnitKobo) : '');
    setEvidenceReference(priced ? priced.evidenceReference : '');
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Raise a valuation
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Raise a valuation">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            Fair value less costs to sell — the market price and what it costs to realise it.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Population
            <select
              name="groupId"
              required
              defaultValue=""
              onChange={(event) => onChooseGroup(event.target.value)}
            >
              <option value="" disabled>
                Choose a population
              </option>
              {valued.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} — {g.breed} ({g.stage}, {g.population} alive
                  {g.currentFvlctsPerUnitKobo
                    ? `, currently ${formatNaira(g.currentFvlctsPerUnitKobo)}/unit`
                    : ''}
                  )
                </option>
              ))}
            </select>
          </label>

          <div className="grid-auto">
            <label className="field">
              Valuation date
              <input type="date" name="valuationDate" defaultValue={today()} required />
            </label>
            <label className="field">
              Market price per unit (₦)
              <input
                name="marketPricePerUnit"
                type="number"
                step="any"
                inputMode="decimal"
                required
                value={marketPricePerUnit}
                onChange={(event) => setMarketPricePerUnit(event.target.value)}
              />
            </label>
            <label className="field">
              Costs to sell per unit (₦)
              <span className="faint"> (optional)</span>
              <input
                name="costsToSellPerUnit"
                type="number"
                step="any"
                inputMode="decimal"
                value={costsToSellPerUnit}
                onChange={(event) => setCostsToSellPerUnit(event.target.value)}
              />
            </label>
          </div>

          <label className="field">
            Market evidence
            <input
              name="evidenceReference"
              placeholder="A price list, a buyer quotation, a market survey"
              required
              value={evidenceReference}
              onChange={(event) => setEvidenceReference(event.target.value)}
            />
            <span className="faint">
              A valuation cannot be raised without something backing the price — a price list, a
              quotation, a survey.
            </span>
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

/** Kobo, as a string off the wire, to a plain naira number string for a
 *  `<input type="number">` value — the reverse of parseNairaToKobo. */
function koboToNaira(kobo: string): string {
  const value = Number(BigInt(kobo)) / 100;
  return value === 0 ? '' : String(value);
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Raising…' : 'Raise valuation'}
      </button>
    </div>
  );
}
