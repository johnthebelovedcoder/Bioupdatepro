'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';

/**
 * Saves the farm's settings.
 *
 * Writes only what differs from the defaults — same discipline the cookie
 * this replaced already had — to a real per-company record instead of a
 * browser cookie. See `CompanyConfig`'s own schema comment for why that
 * move mattered: settings are shared across a team everywhere else in this
 * product, and this one screen silently wasn't.
 */
export async function saveSettings(overrides: unknown): Promise<void> {
  await api('/company-config', { method: 'POST', body: { overrides } });

  // Settings change what every page renders, so nothing cached may survive.
  revalidatePath('/', 'layout');
}

export async function resetSettings(): Promise<void> {
  await api('/company-config', { method: 'DELETE' });
  revalidatePath('/', 'layout');
}
