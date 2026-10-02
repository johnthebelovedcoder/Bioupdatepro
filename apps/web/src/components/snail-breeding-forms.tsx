'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Sheet } from './sheet';
import type { SnailEggCostSource } from '@/lib/snail-breeding';
import {
  failBreedingCycle,
  recordBreedingCycle,
  recordSnailHatch,
  valueLegacySnailEggCycle,
  type FlowState,
} from '@/app/(app)/m/snail-breeding-actions';

const EMPTY: FlowState = { error: null, message: null };

function useCloseOnSuccess(message: string | null, close: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (message) {
      close();
      router.refresh();
    }
    // Only when a fresh success message arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);
}

export function RecordBreedingCycleForm({
  breeders,
  costSources,
  today,
}: {
  breeders: Array<{ id: string; code: string; stage: string; population: number }>;
  costSources: SnailEggCostSource[];
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(recordBreedingCycle, EMPTY);
  const [open, setOpen] = useState(false);
  const [valueBasis, setValueBasis] = useState<'FVLCTS' | 'ATTRIBUTABLE_COST'>('FVLCTS');
  useCloseOnSuccess(state.message, () => setOpen(false));

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Record a cycle
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Record a breeding cycle">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {breeders.length === 0 ? (
            <div className="notice notice-warning">
              No snail cohort with snails in it yet. Place a breeder cohort first.
            </div>
          ) : null}

          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              Cycle code
              <input name="code" placeholder="BC-2026-01" required />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 150 }}>
              Eggs laid on
              <input name="setOn" type="date" defaultValue={today} max={today} required />
            </label>
          </div>

          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 180 }}>
              Egg valuation basis
              <select name="valueBasis" value={valueBasis} onChange={(event) => setValueBasis(event.target.value as 'FVLCTS' | 'ATTRIBUTABLE_COST')} required>
                <option value="FVLCTS">Fair value less costs to sell</option>
                <option value="ATTRIBUTABLE_COST">Attributable cost (when fair value is unreliable)</option>
              </select>
            </label>
            <label className="field" style={{ flex: 1, minWidth: 140 }}>
              Value per viable egg (₦)
              <input name="valuePerEggKobo" type="number" min="0.01" step="0.01" required />
            </label>
          </div>
          <label className="field">
            Valuation evidence / cost support
            <input name="valueEvidence" placeholder="Market quote, valuation, or attributable cost basis" required />
          </label>
          {valueBasis === 'ATTRIBUTABLE_COST' ? (
            <label className="field">
              Why is fair value clearly unreliable for these eggs?
              <input name="fairValueUnreliableReason" placeholder="Describe why a reliable fair value cannot be determined at initial recognition" required />
            </label>
          ) : null}
          <label className="field">
            Cost source account <span className="faint">(attributable cost only)</span>
            <select name="costSourceAccountId" defaultValue="">
              <option value="">Choose expense account</option>
              {costSources.map((source) => <option key={source.id} value={source.id}>{source.accountNumber} — {source.name}</option>)}
            </select>
          </label>

          <label className="field">
            Breeder cohort
            <select name="breederGroupId" defaultValue="" required>
              <option value="" disabled>
                Choose the cohort that laid
              </option>
              {breeders.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.code} — {group.stage}, {group.population.toLocaleString('en-NG')} snails
                </option>
              ))}
            </select>
          </label>

          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 120 }}>
              Breeders
              <input name="breeders" type="number" min={1} step={1} required />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 120 }}>
              Eggs laid
              <input name="eggsLaid" type="number" min={1} step={1} required />
            </label>
          </div>

          <label className="field">
            Notes<span className="faint"> (optional)</span>
            <input name="notes" placeholder="Medium, pen, anything unusual" />
          </label>

          <Submit label="Record cycle" pending="Recording…" />
        </form>
      </Sheet>
    </>
  );
}

export function SnailHatchForm({
  cycleId,
  code,
  eggsLaid,
  today,
}: {
  cycleId: string;
  code: string;
  eggsLaid: number;
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(recordSnailHatch, EMPTY);
  const [failState, failAction] = useActionState<FlowState, FormData>(failBreedingCycle, EMPTY);
  const [open, setOpen] = useState(false);
  const [hatched, setHatched] = useState('');
  useCloseOnSuccess(state.message ?? failState.message, () => setOpen(false));

  const hatchedNumber = Number(hatched) || 0;
  const unhatched = Math.max(0, eggsLaid - hatchedNumber);

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
        Record hatch
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Hatch — ${code}`}>
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="cycleId" value={cycleId} />
          <input type="hidden" name="unhatchedCount" value={unhatched} />
          <p className="faint">
            {eggsLaid.toLocaleString('en-NG')} eggs were laid. Every one is either hatched or not;
            the hatchlings become their own cohort.
          </p>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 1, minWidth: 120 }}>
              Hatched
              <input
                name="hatchedCount"
                type="number"
                min={0}
                max={eggsLaid}
                step={1}
                value={hatched}
                onChange={(e) => setHatched(e.target.value)}
                required
              />
              <span className="faint">{unhatched.toLocaleString('en-NG')} did not hatch</span>
            </label>
            <label className="field" style={{ flex: 1, minWidth: 150 }}>
              Hatched on
              <input name="hatchedOn" type="date" defaultValue={today} max={today} required />
            </label>
          </div>

          {hatchedNumber > 0 ? (
            <label className="field">
              New hatchling cohort code
              <input name="hatchlingGroupCode" placeholder={`HT-${code}`} required />
            </label>
          ) : null}

          <Submit label="Record hatch" pending="Recording…" />
        </form>

        <form
          action={failAction}
          className="stack"
          style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-5)', borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)' }}
        >
          <input type="hidden" name="cycleId" value={cycleId} />
          <span className="faint">Nothing hatched at all?</span>
          {failState.error ? <div className="notice notice-error">{failState.error}</div> : null}
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <input name="reason" placeholder="What happened — flooding, predators…" style={{ flex: 1, minWidth: 200 }} required />
            <FailSubmit />
          </div>
        </form>
      </Sheet>
    </>
  );
}

export function ValueLegacySnailEggCycleForm({ cycleId, code, costSources }: { cycleId: string; code: string; costSources: SnailEggCostSource[] }) {
  const [state, action] = useActionState<FlowState, FormData>(valueLegacySnailEggCycle, EMPTY);
  const [open, setOpen] = useState(false);
  const [valueBasis, setValueBasis] = useState<'FVLCTS' | 'ATTRIBUTABLE_COST'>('FVLCTS');
  useCloseOnSuccess(state.message, () => setOpen(false));
  return <>
    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setOpen(true)}>Value existing eggs</button>
    <Sheet open={open} onClose={() => setOpen(false)} title={`Value legacy eggs — ${code}`}>
      <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
        <input type="hidden" name="cycleId" value={cycleId} />
        <p className="faint">This posts a current-period opening recognition for the cycle’s remaining viable eggs. Use current FVLCTS evidence, or attributable costs supported by posted expense.</p>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}
        <label className="field">Valuation basis<select name="valueBasis" value={valueBasis} onChange={(event) => setValueBasis(event.target.value as 'FVLCTS' | 'ATTRIBUTABLE_COST')}><option value="FVLCTS">Fair value less costs to sell</option><option value="ATTRIBUTABLE_COST">Attributable cost</option></select></label>
        <label className="field">Value per egg (₦)<input name="valuePerEggNaira" type="number" min="0.01" step="0.01" required /></label>
        <label className="field">Evidence / cost support<input name="valueEvidence" required /></label>
        {valueBasis === 'ATTRIBUTABLE_COST' ? <label className="field">Why is fair value clearly unreliable for these eggs?<input name="fairValueUnreliableReason" placeholder="Explain why a reliable fair value cannot be determined" required /></label> : null}
        <label className="field">Expense source account (cost basis)<select name="costSourceAccountId" defaultValue=""><option value="">Choose expense account</option>{costSources.map((a) => <option key={a.id} value={a.id}>{a.accountNumber} — {a.name}</option>)}</select></label>
        <Submit label="Value and post" pending="Posting…" />
      </form>
    </Sheet>
  </>;
}

function FailSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-ghost" disabled={pending}>
      {pending ? 'Recording…' : 'Record as failed'}
    </button>
  );
}

function Submit({ label, pending: pendingLabel }: { label: string; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? pendingLabel : label}
      </button>
    </div>
  );
}
