import 'server-only';
import { cookies } from 'next/headers';

/**
 * The session token lives in an httpOnly cookie, never in localStorage and
 * never in a JavaScript variable.
 *
 * This matters more here than in most apps: the token is the sole proof of who
 * is approving a transaction. If a script on the page can read it, maker-checker
 * reduces to "whoever can run script in an approver's browser", which is not a
 * control. httpOnly means every API call has to go through the server side of
 * Next, which is why the data layer is server components and server actions
 * rather than client-side fetching.
 */

export const SESSION_COOKIE = 'bap_session';

export interface SessionUser {
  userId: string;
  email: string;
  fullName: string;
  roles: string[];
}

export async function getToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function setToken(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // Secure is dropped in development because localhost is plain http; any
    // real deployment sets NODE_ENV=production and gets it back.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
}

export async function clearToken(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
