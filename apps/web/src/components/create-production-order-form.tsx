'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { createFromHarvest, createFeedOrder, type FlowState } from '@/app/(app)/production/actions';
import type { AvailableHarvest, Recipe } from '@/lib/production';

const SPECIES_LABEL: Record<string, string> = { SNAIL: 'Snail', POULTRY: 'Poultry' };

/** Raise a processing order — from a harvest (SnailPro/PoultryPro), or a Feed Mill run. */
export function CreateProductionOrderForm({
  harvests,
  recipes,
  farms,
  branches,
}: {
  harvests: AvailableHarvest[];
  recipes: Recipe[];
  farms: Array<{ id: string; code: string; name: string }>;
  branches: Array<{ id: string; code: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'harvest' | 'feed'>('harvest');
  const selectable = recipes.filter((r) => r.activeVersionId);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Raise an order
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Raise a processing order">
        <div className="row" style={{ gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'harvest' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMode('harvest')}
          >
            From a harvest
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'feed' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMode('feed')}
          >
            Feed mill
          </button>
        </div>

        {mode === 'harvest' ? (
          <HarvestForm harvests={harvests} recipes={selectable} onDone={() => setOpen(false)} />
        ) : (
          <FeedForm recipes={selectable} farms={farms} branches={branches} onDone={() => setOpen(false)} />
        )}
      </Sheet>
    </>
  );
}

function HarvestForm({
  harvests,
  recipes,
  onDone,
}: {
  harvests: AvailableHarvest[];
  recipes: Recipe[];
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(createFromHarvest, {
    error: null,
    message: null,
  });

  if (state.message) {
    return <div className="notice notice-success">{state.message}</div>;
  }

  if (harvests.length === 0) {
    return (
      <p className="faint">
        No harvest is waiting for a processing order — every harvest recorded so far already has
        one, or none has been recorded yet.
      </p>
    );
  }

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}

      <label className="field">
        Harvest
        <select name="harvestRecordId" defaultValue="" required>
          <option value="" disabled>
            Which harvest this order processes
          </option>
          {harvests.map((h) => (
            <option key={h.id} value={h.id}>
              {h.date} — {h.groupCode} ({SPECIES_LABEL[h.speciesKey] ?? h.speciesKey}) —{' '}
              {h.count} animals, {h.weightKg} kg, grade {h.grade}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Recipe
        <select name="recipeVersionId" defaultValue="" required>
          <option value="" disabled>
            What this batch is packaged as
          </option>
          {recipes.map((r) => (
            <option key={r.id} value={r.activeVersionId!}>
              {r.name} → {r.outputItemCode} — {r.outputItemDescription}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Order number
        <input name="orderNumber" placeholder="PROC-2026-001" required />
      </label>

      <label className="field">
        Planned output quantity
        <input name="plannedOutputQuantity" type="number" step="0.001" min="0.001" required />
      </label>

      <Submit onDone={onDone} success={!!state.message} label="Raise order" pendingLabel="Raising…" />
    </form>
  );
}

function FeedForm({
  recipes,
  farms,
  branches,
  onDone,
}: {
  recipes: Recipe[];
  farms: Array<{ id: string; code: string; name: string }>;
  branches: Array<{ id: string; code: string; name: string }>;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(createFeedOrder, {
    error: null,
    message: null,
  });

  if (state.message) {
    return <div className="notice notice-success">{state.message}</div>;
  }

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}

      <label className="field">
        Farm
        <select name="farmId" defaultValue={farms[0]?.id ?? ''} required>
          {farms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Branch
        <select name="branchId" defaultValue={branches[0]?.id ?? ''} required>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Recipe
        <select name="recipeVersionId" defaultValue="" required>
          <option value="" disabled>
            Which feed this mills
          </option>
          {recipes.map((r) => (
            <option key={r.id} value={r.activeVersionId!}>
              {r.name} → {r.outputItemCode} — {r.outputItemDescription}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Order number
        <input name="orderNumber" placeholder="FEED-2026-001" required />
      </label>

      <label className="field">
        Planned output quantity
        <input name="plannedOutputQuantity" type="number" step="0.001" min="0.001" required />
      </label>

      <Submit onDone={onDone} success={!!state.message} label="Raise order" pendingLabel="Raising…" />
    </form>
  );
}

function Submit({
  label,
  pendingLabel,
  onDone,
  success,
}: {
  label: string;
  pendingLabel: string;
  onDone: () => void;
  success: boolean;
}) {
  const { pending } = useFormStatus();
  if (success) {
    return (
      <button type="button" className="btn btn-primary" onClick={onDone}>
        Done
      </button>
    );
  }
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}
