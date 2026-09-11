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
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  request.headers.set('x-pathname', pathname);

  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'm') {
    return NextResponse.next({ request: { headers: request.headers } });
  }

  const key = segments[1];
  if (!isSubscribedKey(key)) {
    return NextResponse.next({ request: { headers: request.headers } });
  }
  if (request.cookies.get('bap_module')?.value === key) {
    return NextResponse.next({ request: { headers: request.headers } });
  }

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

export const config = {
  /*
   * Everything except Next's own assets and the API bridge. The gate has to see
   * ordinary page requests, which the previous `/m/:path*` matcher did not.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|login|signup|join|offline|forgot-password|reset-password).*)',
  ],
};
