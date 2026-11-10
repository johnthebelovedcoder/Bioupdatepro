'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';

export async function addMortalityCause(formData: FormData) {
  const speciesKey = String(formData.get('speciesKey') ?? 'poultry');
  await api('/operations/mortality-causes', { method: 'POST', body: { speciesKey, code: formData.get('code'), label: formData.get('label') } });
  revalidatePath('/farm/mortality-causes');
  redirect(`/farm/mortality-causes?species=${encodeURIComponent(speciesKey)}`);
}

export async function toggleMortalityCause(formData: FormData) {
  const speciesKey = String(formData.get('speciesKey') ?? 'poultry');
  const id = String(formData.get('id') ?? '');
  const active = formData.get('active') === 'true';
  await api(`/operations/mortality-causes/${encodeURIComponent(id)}`, { method: 'PATCH', body: { active } });
  revalidatePath('/farm/mortality-causes');
  redirect(`/farm/mortality-causes?species=${encodeURIComponent(speciesKey)}`);
}
