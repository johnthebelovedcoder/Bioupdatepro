'use client';

import Link from 'next/link';
import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { createFromHarvest, createFeedOrder, type FlowState } from '@/app/(app)/production/actions';
import type { AvailableHarvest, Recipe } from '@/lib/production';
import { translator } from '@/lib/i18n';
import type { LanguageCode } from '@/lib/farm-config';

/** Raise a processing order — from a harvest (SnailPro/PoultryPro), or a Feed Mill run. */
export function CreateProductionOrderForm({
  harvests,
  recipes,
  farms,
  branches,
  language = 'en',
}: {
  harvests: AvailableHarvest[];
  recipes: Recipe[];
  farms: Array<{ id: string; code: string; name: string }>;
  branches: Array<{ id: string; code: string; name: string }>;
  language?: LanguageCode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'harvest' | 'feed'>('harvest');
  const selectable = recipes.filter((r) => r.activeVersionId);
  const say = translator(language);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {say('order.raise')}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={say('order.dialog')}>
        <div className="row" style={{ gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'harvest' ? 'btn-primary' : 'btn-ghost'}`}
            aria-pressed={mode === 'harvest'}
            onClick={() => setMode('harvest')}
          >
            {say('order.harvestMode')}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === 'feed' ? 'btn-primary' : 'btn-ghost'}`}
            aria-pressed={mode === 'feed'}
            onClick={() => setMode('feed')}
          >
            {say('order.feedMode')}
          </button>
        </div>

        {mode === 'harvest' ? (
          <HarvestForm harvests={harvests} recipes={selectable.filter((r) => !r.outputIsFeed)} language={language} onDone={() => setOpen(false)} />
        ) : (
          <FeedForm recipes={selectable.filter((r) => r.outputIsFeed)} farms={farms} branches={branches} language={language} onDone={() => setOpen(false)} />
        )}
      </Sheet>
    </>
  );
}

function HarvestForm({
  harvests,
  recipes,
  language,
  onDone,
}: {
  harvests: AvailableHarvest[];
  recipes: Recipe[];
  language: LanguageCode;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(createFromHarvest, {
    error: null,
    message: null,
  });
  const [step, setStep] = useState(0);
  const activeStep = useRef<HTMLFieldSetElement>(null);
  const say = translator(language);
  const nextStep = () => {
    const invalid = activeStep.current?.querySelector<HTMLInputElement | HTMLSelectElement>(':invalid');
    if (invalid) { invalid.reportValidity(); return; }
    setStep((current) => Math.min(2, current + 1));
  };

  if (state.message) {
    return <div className="stack"><div className="notice notice-success">{state.message}</div><button type="button" className="btn btn-primary" onClick={onDone}>{say('common.done')}</button></div>;
  }

  if (harvests.length === 0) {
    return (
      <div className="stack"><p className="muted">{say('order.noHarvest')}</p><Link className="btn" href="/farm/readiness">{say('order.checkHarvest')}</Link></div>
    );
  }

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      <StepProgress step={step} language={language} />

      <fieldset ref={activeStep} hidden={step !== 0} className="stack form-step">
      <legend className="field-label">{say('order.harvest')}</legend>
      <label className="field">
        {say('order.harvest')}
        <select name="harvestRecordId" defaultValue="" required>
          <option value="" disabled>{say('order.harvestPlaceholder')}</option>
          {harvests.map((h) => (
            <option key={h.id} value={h.id}>
            {h.date} — {h.groupCode} ({h.speciesKey === 'SNAIL' ? say('order.snail') : say('order.poultry')}) —{' '}
              {h.count} animals, {h.weightKg} kg, grade {h.grade}
            </option>
          ))}
        </select>
      </label>
      </fieldset>

      <fieldset ref={step === 1 ? activeStep : null} hidden={step !== 1} className="stack form-step">
      <legend className="field-label">{say('order.product')}</legend>
      <label className="field">
        {say('order.product')}
        <select name="recipeVersionId" defaultValue="" required>
          <option value="" disabled>{say('order.productPlaceholder')}</option>
          {recipes.map((r) => (
            <option key={r.id} value={r.activeVersionId!}>
              {r.name} → {r.outputItemCode} — {r.outputItemDescription}
            </option>
          ))}
        </select>
        {recipes.length === 0 ? (
          <span className="faint">{say('order.recipeMissing')} <Link href="/production/recipes">{say('order.product')}</Link></span>
        ) : null}
      </label>
      </fieldset>

      <fieldset ref={step === 2 ? activeStep : null} hidden={step !== 2} className="stack form-step">
      <legend className="field-label">{say('order.outputTitle')}</legend>
      <label className="field">
        {say('order.plannedOutput')}
        <input name="plannedOutputQuantity" type="number" step="0.001" min="0.001" inputMode="decimal" aria-describedby="planned-output-help" required />
        <span id="planned-output-help" className="field-hint">{say('order.outputHint')}</span>
      </label>
      </fieldset>

      <StepControls step={step} onBack={() => setStep((current) => Math.max(0, current - 1))} onNext={nextStep} language={language} label={say('order.raise')} pendingLabel={say('common.raising')} />
    </form>
  );
}

function FeedForm({
  recipes,
  farms,
  branches,
  language,
  onDone,
}: {
  recipes: Recipe[];
  farms: Array<{ id: string; code: string; name: string }>;
  branches: Array<{ id: string; code: string; name: string }>;
  language: LanguageCode;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(createFeedOrder, {
    error: null,
    message: null,
  });
  const [step, setStep] = useState(0);
  const activeStep = useRef<HTMLFieldSetElement>(null);
  const say = translator(language);
  const nextStep = () => {
    const invalid = activeStep.current?.querySelector<HTMLInputElement | HTMLSelectElement>(':invalid');
    if (invalid) { invalid.reportValidity(); return; }
    setStep((current) => Math.min(2, current + 1));
  };

  if (state.message) {
    return <div className="stack"><div className="notice notice-success">{state.message}</div><button type="button" className="btn btn-primary" onClick={onDone}>{say('common.done')}</button></div>;
  }

  return (
    <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      <StepProgress step={step} language={language} />

      <fieldset ref={activeStep} hidden={step !== 0} className="stack form-step">
      <legend className="field-label">{say('order.stepSource')}</legend>
      <label className="field">
        {say('order.farm')}
        <select name="farmId" defaultValue={farms[0]?.id ?? ''} required>
          {farms.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        {say('order.branch')}
        <select name="branchId" defaultValue={branches[0]?.id ?? ''} required>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        {say('order.feedFor')}
        <select name="speciesKey" defaultValue="" required>
          <option value="" disabled>
            {say('order.feedFor')}…
          </option>
          <option value="snail">{say('order.snail')}</option>
          <option value="poultry">{say('order.poultry')}</option>
        </select>
      </label>
      </fieldset>

      <fieldset ref={step === 1 ? activeStep : null} hidden={step !== 1} className="stack form-step">
      <legend className="field-label">{say('order.feedRecipe')}</legend>

      <label className="field">
        {say('order.feedRecipe')}
        <select name="recipeVersionId" defaultValue="" required>
          <option value="" disabled>
            {say('order.productPlaceholder')}
          </option>
          {recipes.map((r) => (
            <option key={r.id} value={r.activeVersionId!}>
              {r.name} → {r.outputItemCode} — {r.outputItemDescription}
            </option>
          ))}
        </select>
        {recipes.length === 0 ? (
          <span className="faint">{say('order.recipeMissing')} <Link href="/production/recipes">{say('order.product')}</Link></span>
        ) : null}
      </label>
      </fieldset>

      <fieldset ref={step === 2 ? activeStep : null} hidden={step !== 2} className="stack form-step">
      <legend className="field-label">{say('order.outputTitle')}</legend>
      <label className="field">
        {say('order.plannedOutput')}
        <input name="plannedOutputQuantity" type="number" step="0.001" min="0.001" inputMode="decimal" aria-describedby="planned-feed-help" required />
        <span id="planned-feed-help" className="field-hint">{say('order.outputHint')}</span>
      </label>
      </fieldset>

      <StepControls step={step} onBack={() => setStep((current) => Math.max(0, current - 1))} onNext={nextStep} language={language} label={say('order.raise')} pendingLabel={say('common.raising')} />
    </form>
  );
}

function StepProgress({ step, language }: { step: number; language: LanguageCode }) {
  const say = translator(language);
  const labels = [say('order.stepSource'), say('order.stepRecipe'), say('order.stepOutput')];
  return (
    <div className="notice notice-info" aria-live="polite">
      <strong>{say('order.stepProgress', { step: step + 1, total: 3, label: labels[step] ?? labels[0]! })}</strong>
      <span className="faint" style={{ display: 'block' }}>{say('order.progressHint')}</span>
    </div>
  );
}

function StepControls({
  step,
  onBack,
  onNext,
  language,
  label,
  pendingLabel,
}: {
  step: number;
  onBack: () => void;
  onNext: () => void;
  language: LanguageCode;
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  const say = translator(language);
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-3)' }}>
      {step > 0 ? <button type="button" className="btn btn-ghost" onClick={onBack} disabled={pending}>{say('common.back')}</button> : <span />}
      {step < 2 ? (
        <button type="button" className="btn btn-primary" onClick={onNext}>{say('common.continue')}</button>
      ) : (
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? pendingLabel : label}
        </button>
      )}
    </div>
  );
}
