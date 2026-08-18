'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { MODULE_COOKIE } from '@/lib/active-module';
import { getModule } from '@/lib/modules';

/**
 * Switch the working species module.
 *
 * The subscription check happens here, on the server. A client that posts
 * `fish` without a FishPro subscription is refused — the switcher hides
 * unsubscribed modules, but hiding a control is not access control.
 */
export async function switchModule(key: string): Promise<void> {
  const module = getModule(key);
  if (!module || !module.subscribed) {
    throw new Error('That module is not part of your subscription.');
  }

  const store = await cookies();
  store.set(MODULE_COOKIE, module.key, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect(`/m/${module.key}`);
}
