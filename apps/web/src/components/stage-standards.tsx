'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveStageStandards, type FlowState } from '@/app/(app)/admin/breeds/actions';

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-sm" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

/**
 * One stage's standards: target live weight (harvest readiness, weighing
 * variance) and feed per head per day (the feed plan's fallback).
 */
export function StageStandardsForm({
  stage,
}: {
  stage: { id: string; stageName: string; minDay: number; targetWeightGrams: number | null; dailyFeedGramsPerHead: number | null };
}) {
  const [state, action] = useActionState<FlowState, FormData>(saveStageStandards, { error: null, message: null });
  return (
    <form action={action} className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="hidden" name="stageId" value={stage.id} />
      <span style={{ minWidth: 150 }}>
        {stage.stageName} <span className="faint">from day {stage.minDay}</span>
      </span>
      <input name="targetWeightGrams" type="number" min="1" step="1" defaultValue={stage.targetWeightGrams ?? ''} placeholder="Target g" aria-label={`${stage.stageName} target weight, grams`} style={{ width: 110 }} />
      <input name="dailyFeedGramsPerHead" type="number" min="1" step="1" defaultValue={stage.dailyFeedGramsPerHead ?? ''} placeholder="Feed g/day" aria-label={`${stage.stageName} feed per head per day, grams`} style={{ width: 110 }} />
      <Save />
      {state.error ? <span className="notice notice-error">{state.error}</span> : null}
      {state.message ? <span className="faint">{state.message}</span> : null}
    </form>
  );
}
