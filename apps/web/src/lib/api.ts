import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getToken } from './session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * An error the API returned, carrying the message it actually gave.
 *
 * The API's refusals are the product's most important output — "invoiced
 * quantity exceeds accepted quantity", "period is closed", "you cannot approve
 * your own document". Flattening those into "Something went wrong" would throw
 * away the one thing the user needs. So the message is preserved verbatim and
 * shown.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Server components render on every navigation; opt in to caching explicitly. */
  cache?: RequestCache;
  /** When false, a 401 throws instead of redirecting (used by the session probe). */
  redirectOnUnauthorised?: boolean;
}

/**
 * Set while an `optional()` read is in flight.
 *
 * A page whose own subject the API refuses should send the person to the page
 * that explains it. A side panel the API refuses should not: it is a corner of
 * somebody's working screen, and navigating away from the screen they asked for
 * because a reference list was not theirs to read would be worse than the empty
 * list. This marks which of the two is running, per request, so the refusal
 * handling below can tell them apart.
 */
const insideOptional = new AsyncLocalStorage<true>();

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await getToken();
  const {
    method = 'GET',
    body,
    cache = 'no-store',
    redirectOnUnauthorised = true,
  } = options;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      cache,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      `Cannot reach the BioAssetPro API at ${API_URL}. Is it running?`,
      0,
    );
  }

  if (response.status === 401 && redirectOnUnauthorised) {
    redirect('/login?expired=1');
  }

  const detail = response.ok ? null : await safeJson(response);

  // A role refusal is a navigation problem, not a crash.
  //
  // The API's guard answers 403 with "This needs one of: ...", and letting that
  // throw left Next.js rendering the screen's error boundary: the right words,
  // but under HTTP 500. A permissions refusal then arrives in the logs — and in
  // anything alerting on them — as a server fault, which is noise standing in
  // front of the real faults. So a read that is refused for role redirects to
  // the page that explains it, the same way a 401 redirects to the login.
  //
  // Only reads, and only this one message. A refused write keeps throwing so its
  // reason appears next to the button that was pressed rather than on a page
  // nobody asked for, and every other 403 — a closed period, approving your own
  // document — still carries its own reason to the screen.
  if (
    response.status === 403 &&
    method === 'GET' &&
    redirectOnUnauthorised &&
    !insideOptional.getStore() &&
    /This needs one of/i.test(messageFrom(detail, 403))
  ) {
    const from = (await headers()).get('x-pathname');
    redirect(from ? `/no-access?from=${encodeURIComponent(from)}` : '/no-access');
  }

  if (!response.ok) {
    throw new ApiError(messageFrom(detail, response.status), response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  // A handler that returns nothing (null) sends 200 with an empty body.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function messageFrom(detail: unknown, status: number): string {
  if (status === 429) return 'Too many attempts. Wait a few minutes, then try again.';
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const message = (detail as { message: unknown }).message;
    // class-validator returns an array of messages, one per failed rule.
    if (Array.isArray(message)) return message.join(' ');
    if (typeof message === 'string') return message;
  }
  return `The API returned ${status}.`;
}

/** POST that returns the error message rather than throwing — for form actions. */
export async function tryApi<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await api<T>(path, options) };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * For data a screen can do without.
 *
 * A read that fails is not the same thing as a read that came back empty, and
 * the difference matters: `catch { return [] }` turned the API refusing a role
 * into "No payroll run yet" and "No manual journal yet" — the screen telling
 * somebody their records do not exist when it had simply not been allowed to
 * ask. Screens whose subject is the data no longer catch at all: the refusal
 * reaches the screen's error boundary, which says "That screen is not yours".
 *
 * This is for the rest — a side panel, a picker's reference list, something in
 * the shell that appears on every page — where falling back to empty keeps a
 * working screen working, and where blanking the whole page over it would be
 * worse than showing one empty list. It logs, so the failure is visible to
 * whoever is looking at the server, and names the thing so the log is readable.
 */
export async function optional<T>(what: string, load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await insideOptional.run(true, load);
  } catch (caught) {
    // Next.js signals redirect() and notFound() by throwing. Catching those
    // would turn a navigation into a silently empty list, so they pass through.
    if (isNavigation(caught)) throw caught;
    console.error(`Could not load ${what}; showing it as empty instead`, caught);
    return fallback;
  }
}

/** Whether a thrown value is one of Next.js's navigation signals. */
function isNavigation(caught: unknown): boolean {
  const digest = (caught as { digest?: unknown } | null | undefined)?.digest;
  return (
    typeof digest === 'string' &&
    (digest === 'NEXT_NOT_FOUND' || digest.startsWith('NEXT_REDIRECT'))
  );
}
