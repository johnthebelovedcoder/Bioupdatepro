import { NextResponse, type NextRequest } from 'next/server';
import { isSubscribedKey } from '@/lib/module-keys';

/**
 * Keeps the active-module cookie in step with the path, and forwards the
 * requested path to the Server Components that render it.
 *
 * The role gate that used to live here — turning away a page the signed-in
 * role does not cover, before it renders — moved to `(app)/layout.tsx`.
 * Edge middleware only ever had the JWT's roles claim to check against the
 * HARDCODED role→section table; it had no way to see a company's admin-set
 * overrides (`RoleSectionAccess`, US-897-035) without an extra network round
 * trip on every navigation. The layout already makes a real API call for the
 * signed-in user and already fetches those overrides for the sidebar — so it
 * is the layout, not this file, that can actually get the answer right. This
 * file forwards `x-pathname` so that check has something to check against.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  request.headers.set('x-pathname', pathname);

  const renewed = await renewSession(request);
  const next = () => {
    const response = NextResponse.next({ request: { headers: request.headers } });
    if (renewed) response.cookies.set(SESSION_COOKIE, renewed, SESSION_COOKIE_OPTIONS);
    return response;
  };

  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'm') {
    return next();
  }

  const key = segments[1];
  if (!isSubscribedKey(key)) {
    return next();
  }
  if (request.cookies.get('bap_module')?.value === key) {
    return next();
  }

  // Set it on the REQUEST as well as the response. The response cookie
  // persists it in the browser, but only the request cookie is visible to the
  // server components rendering this very page — without it the sidebar would
  // be correct one navigation late, which is the bug this exists to fix.
  request.cookies.set('bap_module', key);
  const response = next();
  response.cookies.set('bap_module', key, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

const SESSION_COOKIE = 'bap_session';
/** Must match setToken() in lib/session.ts. */
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 60 * 60 * 12,
};
/** Renew at most this often: often enough to never lapse, rarely enough to cost nothing. */
const RENEW_AFTER_SECONDS = 30 * 60;
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * Keep an active session alive.
 *
 * A token used to last twelve hours from sign-in no matter what, so someone
 * working through the afternoon was signed out mid-task. Now, once a token is
 * half an hour old, the next page load swaps it for a fresh twelve-hour one —
 * a session ends after twelve idle hours, or seven days after the password
 * was entered (the API's cap), whichever is first.
 *
 * Never fatal: if the API cannot be reached the old token is kept, and the
 * layout's own check decides what happens next. The token is only read here
 * to see how old it is — the API verifies it.
 */
async function renewSession(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  let issuedAt: number;
  let expiresAt: number;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { iat?: number; exp?: number };
    issuedAt = payload.iat ?? 0;
    expiresAt = payload.exp ?? 0;
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (now - issuedAt < RENEW_AFTER_SECONDS || expiresAt <= now) return null;

  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const { accessToken } = (await response.json()) as { accessToken?: string };
    if (!accessToken) return null;
    // Visible to the server components rendering this very request, too.
    request.cookies.set(SESSION_COOKIE, accessToken);
    return accessToken;
  } catch {
    return null;
  }
}

export const config = {
  /*
   * Everything except Next's own assets and the API bridge. The gate has to see
   * ordinary page requests, which the previous `/m/:path*` matcher did not.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|login|signup|join|offline|forgot-password|reset-password).*)',
  ],
};
