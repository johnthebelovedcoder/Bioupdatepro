'use server';

import { revalidatePath } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export interface LogState {
  error: string | null;
  message: string | null;
}

const fail = (caught: unknown, fallback: string): LogState => ({ error: caught instanceof ApiError ? caught.message : fallback, message: null });

export async function saveStandard(_previous: LogState, formData: FormData): Promise<LogState> {
  const v = (k: string) => String(formData.get(k) ?? '').trim();
  try {
    await api('/poultry/incubation-log/standard', {
      method: 'POST',
      body: {
        minTemperatureC: v('minTemperatureC'),
        maxTemperatureC: v('maxTemperatureC'),
        minHumidityPercent: v('minHumidityPercent'),
        maxHumidityPercent: v('maxHumidityPercent'),
        readingIntervalHours: Number(v('readingIntervalHours')),
      },
    });
  } catch (caught) {
    return fail(caught, 'Could not save the standard.');
  }
  revalidatePath('/farm/incubation');
  return { error: null, message: 'Standard saved.' };
}

export async function recordReading(_previous: LogState, formData: FormData): Promise<LogState> {
  const v = (k: string) => String(formData.get(k) ?? '').trim();
  const id = v('incubationBatchId');
  const kind = v('kind') === 'CANDLING' ? 'CANDLING' : 'ENVIRONMENT';
  const readAt = v('readAt');
  let result: { exceptions: string[] };
  try {
    result = await api(`/poultry/incubation-log/batches/${id}/readings`, {
      method: 'POST',
      body:
        kind === 'ENVIRONMENT'
          ? {
              kind,
              ...(readAt ? { readAt } : {}),
              temperatureC: v('temperatureC') || undefined,
              humidityPercent: v('humidityPercent') || undefined,
              turned: formData.get('turned') === 'on',
              note: v('note') || undefined,
            }
          : {
              kind,
              ...(readAt ? { readAt } : {}),
              fertileCount: Number(v('fertileCount') || 0),
              clearCount: Number(v('clearCount') || 0),
              deadInShellCount: Number(v('deadInShellCount') || 0),
              note: v('note') || undefined,
            },
    });
  } catch (caught) {
    return fail(caught, 'Could not record that reading.');
  }
  revalidatePath('/farm/incubation');
  return result.exceptions.length
    ? { error: null, message: `Recorded as an exception: ${result.exceptions.join(' ')} A supervisor acknowledges it before the hatch.` }
    : { error: null, message: 'Recorded.' };
}

/** Register an incubator or change its capacity. */
export async function saveIncubator(_previous: LogState, formData: FormData): Promise<LogState> {
  const v = (k: string) => String(formData.get(k) ?? '').trim();
  try {
    await api('/poultry/incubation-log/incubators', {
      method: 'POST',
      body: { code: v('code'), name: v('name'), capacityEggs: Number(v('capacityEggs')), active: formData.get('inactive') !== 'on' },
    });
  } catch (caught) {
    return fail(caught, 'Could not save that incubator.');
  }
  revalidatePath('/farm/incubation');
  return { error: null, message: 'Saved.' };
}

export async function acknowledgeReading(id: string, actionTaken: string): Promise<LogState> {
  try {
    await api(`/poultry/incubation-log/readings/${id}/acknowledge`, { method: 'POST', body: { actionTaken } });
  } catch (caught) {
    return fail(caught, 'Could not acknowledge it.');
  }
  revalidatePath('/farm/incubation');
  return { error: null, message: 'Acknowledged.' };
}

/** Registered incubators and their room, for the set form's suggestions. */
export async function listIncubators(): Promise<Array<{ code: string; name: string; free: number }>> {
  try {
    const rows = await api<Array<{ code: string; name: string; free: number; active: boolean }>>('/poultry/incubation-log/incubators');
    return rows.filter((r) => r.active).map((r) => ({ code: r.code, name: r.name, free: r.free }));
  } catch {
    return [];
  }
}
