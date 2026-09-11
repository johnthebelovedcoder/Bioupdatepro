import { NextResponse } from 'next/server';
import { getToken } from '@/lib/session';

/**
 * The bridge between the phone's outbox and the API.
 *
 * The outbox runs in the browser — it has to, because its whole purpose is to
 * hold work recorded when there was no connection. But the session token lives
 * in an httpOnly cookie on this origin, deliberately unreadable by script (see
 * lib/session.ts: if a script can read the token, maker-checker reduces to
 * "whoever can run script in an approver's browser"). So the browser cannot
 * call the API directly: it has no credential to send, and the API is on
 * another origin anyway.
 *
 * This route is the seam. Same origin, so the cookie is sent automatically;
 * server-side, so the token can be read and attached as a bearer; and a thin
 * pass-through, so the API remains the only place that decides whether a
 * submission is acceptable.
 *
 * Status codes are forwarded unchanged, which matters for two of them:
 *
 *   409  the API saw this idempotency key before. The outbox treats that as
 *        success, because it means an earlier attempt landed and only the
 *        response was lost.
 *   401  the session expired while the work sat in the queue. The item stays
 *        queued and retryable rather than being thrown away — the worker still
 *        did the round.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * Which endpoint each kind of queued work belongs to.
 *
 * An allow-list rather than a computed path: this route forwards an
 * authenticated request to an internal service, and letting the client name the
 * path would make it an open proxy into the API with the user's token attached.
 */
const ROUTES: Record<string, string> = {
  'daily-round': '/operations/rounds',
  treatment: '/operations/treatments',
  harvest: '/operations/harvests',
  'stage-change': '/operations/stage-changes',
  'new-group': '/operations/placements',
  sale: '/operations/sales',
  purchase: '/operations/purchases',
  'egg-collection': '/poultry/eggs/collections',
  'egg-incubation': '/poultry/eggs/incubations',
  'egg-hatch': '/poultry/eggs/hatch',
};

export async function POST(request: Request) {
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ message: 'Not signed in.' }, { status: 401 });
  }

  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey) {
    return NextResponse.json({ message: 'Missing idempotency key.' }, { status: 400 });
  }

  let body: { kind?: string; payload?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Body was not JSON.' }, { status: 400 });
  }

  const path = body.kind ? ROUTES[body.kind] : undefined;
  if (!path) {
    // An unknown kind is a client bug, not a temporary failure, so the item is
    // told plainly that retrying will not help.
    return NextResponse.json(
      { message: `Nothing accepts "${body.kind}" yet.`, retryable: false },
      { status: 501 },
    );
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(body.payload ?? {}),
      cache: 'no-store',
    });
  } catch {
    // The API is unreachable from the server. Worth retrying, so say so with a
    // status the queue treats as temporary.
    return NextResponse.json({ message: 'Could not reach the API.' }, { status: 503 });
  }

  const text = await response.text();
  return new NextResponse(text || null, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}
