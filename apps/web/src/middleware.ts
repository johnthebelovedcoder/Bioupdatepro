import { NextResponse, type NextRequest } from 'next/server';
import { isSubscribedKey } from '@/lib/module-keys';
import { canSee, sectionForPath } from '@/lib/permissions';
import { SESSION_COOKIE } from '@/lib/session';

/**
 * Two jobs, both about the URL being the source of truth.
 *
 *   1. Keeps the active-module cookie in step with the path.
 *   2. Turns away a page the signed-in role does not cover, BEFORE it renders.
 *
 * On (2): the API is the boundary and already refuses the data with a 403. What
 * it cannot do is make that refusal legible — a page whose fetch is rejected
 * renders "Application error", which tells the person nothing and looks like a
 * fault in the product rather than a deliberate limit on their account. This
 * catches it early and sends them somewhere that explains itself.
 *
 * The roles here come from the JWT, and that is a deliberate weakening WORTH
 * STATING: a token minted before somebody was moved off a role still claims it
 * until it expires. That is acceptable for choosing which screen to render and
 * would NOT be acceptable for deciding what data to return — which is exactly
 * why the API re-reads roles from the database on every request instead of
 * trusting this. Redirecting is cosmetic; the guard behind it is not.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const gate = roleGate(request);
  if (gate) return gate;

  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'm') return NextResponse.next();

  const key = segments[1];
  if (!isSubscribedKey(key)) return NextResponse.next();
  if (request.cookies.get('bap_module')?.value === key) return NextResponse.next();

  // Set it on the REQUEST as well as the response. The response cookie
  // persists it in the browser, but only the request cookie is visible to the
  // server components rendering this very page — without it the sidebar would
  // be correct one navigation late, which is the bug this exists to fix.
  request.cookies.set('bap_module', key);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set('bap_module', key, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

/** Redirect to the explanation page when the role does not cover this path. */
function roleGate(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;

  // The page that explains the refusal must never refuse entry to itself.
  if (pathname.startsWith('/no-access')) return null;

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null; // Not signed in: the layout's session check handles it.

  const roles = rolesFromToken(token);
  // An unreadable token is a session problem, not a permission one. Let the
  // layout deal with it rather than blaming the user's role.
  if (!roles) return null;

  if (canSee(roles, sectionForPath(pathname))) return null;

  const url = request.nextUrl.clone();
  url.pathname = '/no-access';
  url.search = `?from=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

/**
 * The roles claim, without verifying the signature.
 *
 * Safe ONLY because nothing here grants access — the worst a forged token can
 * do is show somebody a screen whose every request the API then refuses. Real
 * verification happens there, against the database.
 */
function rolesFromToken(token: string): string[] | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { roles?: unknown };
    return Array.isArray(json.roles) ? (json.roles as string[]) : null;
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
