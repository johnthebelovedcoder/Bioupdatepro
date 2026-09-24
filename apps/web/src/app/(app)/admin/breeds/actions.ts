'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface FlowState {
  error: string | null;
  message: string | null;
}

/**
 * Register a breed and the age, in days, at which each stage begins. The
 * placement form offers these as suggestions, and the stage-change check uses
 * the ages to flag a population moved on too early.
 */
export async function createBreed(_previous: FlowState, formData: FormData): Promise<FlowState> {
  const speciesKey = String(formData.get('speciesKey') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const classification = String(formData.get('classification') ?? '').trim();
  const openingStage = String(formData.get('openingStage') ?? '').trim();
  if (!speciesKey || !code || !name) return { error: 'Give the breed a code and a name.', message: null };

  const names = formData.getAll('stageName').map((v) => String(v).trim());
  const days = formData.getAll('stageMinDay').map((v) => String(v).trim());
  // A stage left without an age is one this breed does not go through.
  const stages = names
    .map((stageName, index) => ({ stageName, day: days[index] ?? '' }))
    .filter((stage) => stage.stageName !== '' && stage.day !== '')
    .map((stage) => ({ stageName: stage.stageName, minDay: Number(stage.day) }));

  if (stages.some((stage) => !Number.isInteger(stage.minDay) || stage.minDay < 0)) {
    return { error: 'Each stage needs a starting day of zero or more, in whole days.', message: null };
  }
  if (stages.length === 0) {
    return { error: 'Give at least one stage an age in days.', message: null };
  }
  for (let i = 1; i < stages.length; i += 1) {
    if (stages[i]!.minDay < stages[i - 1]!.minDay) {
      return { error: `${stages[i]!.stageName} starts before ${stages[i - 1]!.stageName}.`, message: null };
    }
  }

  try {
    await api('/masters/species-breeds', {
      method: 'POST',
      body: {
        speciesKey,
        code,
        name,
        openingStage: openingStage || stages[0]!.stageName,
        ...(classification ? { classification } : {}),
        stages,
      },
    });
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not add that breed.',
      message: null,
    };
  }

  revalidatePath('/admin/breeds');
  return { error: null, message: `${name} added.` };
}
