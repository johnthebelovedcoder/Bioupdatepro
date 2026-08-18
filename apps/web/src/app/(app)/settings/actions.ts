'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { CONFIG_COOKIE } from '@/lib/farm-config.server';

/**
 * Saves the farm's settings.
 *
 * Writes only what differs from the defaults, so the cookie stays small and a
 * farm that has changed nothing carries nothing. Replaced by a write to the
 * organisation's settings record once tenancy exists.
 */
export async function saveSettings(overrides: unknown): Promise<void> {
  const store = await cookies();
  const encoded = encodeURIComponent(JSON.stringify(overrides));

  // A cookie over about 4KB is silently dropped by browsers, which would look
  // like the save had worked. Refuse loudly instead.
  if (encoded.length > 3500) {
    throw new Error('Too many settings changed at once to store on this device.');
  }

  store.set(CONFIG_COOKIE, encoded, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  // Settings change what every page renders, so nothing cached may survive.
  revalidatePath('/', 'layout');
}

export async function resetSettings(): Promise<void> {
  const store = await cookies();
  store.delete(CONFIG_COOKIE);
  revalidatePath('/', 'layout');
}
