'use server';

import { redirect } from 'next/navigation';
import { clearToken } from '@/lib/session';
import { finishAuthentication, type AuthenticationResult } from '@/lib/auth-result';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/*
 * Long enough to outlast a cold start, short enough to end in an explanation.
 *
 * The API runs on an instance type that stops when nobody is using it, and the
 * next request has to wait for it to come back: measured at 53 to 56 seconds
 * from cold. Without a deadline the form waits on the platform's, which is
 * both longer and silent. Anything under a minute would turn a successful
 * wake-up into a failure, which is the opposite of the point.
 */
const WAKE_TIMEOUT_MS = 75_000;

export interface LoginState {
  error: string | null;
}

/**
 * Signs in and stores the token in an httpOnly cookie.
 *
 * The token never reaches the browser's JavaScript — the response is read here,
 * on the server, and only the Set-Cookie header crosses back.
 */
export async function login(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'Enter your email address and password.' };
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
    });
  } catch {
    /*
     * This used to name the API's address and ask whether it was running,
     * which reads as a developer's note to themselves. The person seeing it
     * signs into a farm system; the address is of no use to them, and it is
     * not theirs to publish either — the browser never calls the API, so this
     * server-side address appeared on screen for no reason.
     */
    return { error: unreachableMessage() };
  }

  if (response.status === 429) {
    // Account-specific lockout was removed. A 429 now means an upstream
    // platform is temporarily limiting traffic, so never claim the account is
    // blocked or suggest a password reset as a way around it.
    const body = (await response.json().catch(() => null)) as { retryAfterSeconds?: unknown } | null;
    const retryAfterSeconds =
      typeof body?.retryAfterSeconds === 'number' && Number.isFinite(body.retryAfterSeconds)
        ? body.retryAfterSeconds
        : retrySecondsFromHeader(response);
    return {
      error: retryAfterSeconds > 0
        ? `The sign-in service is temporarily limiting requests. ${retryAdvice(retryAfterSeconds)}`
        : 'The sign-in service is temporarily limiting requests. Please wait a moment and try again.',
    };
  }

  /*
   * 502/503/504 from the platform while the instance comes back up. The body
   * is the platform's HTML, not ours, so there is nothing to quote — and the
   * general wording below says "wait a few seconds", which undersells a wake
   * that takes the better part of a minute and invites a second click that
   * starts the wait again.
   */
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return {
      error:
        'BioAssetPro is starting up. This takes up to a minute after a quiet ' +
        'spell — wait for it to finish rather than signing in again.',
    };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    /*
     * The API's own 401 always carries a real string here — see
     * `AuthService.login()`. Falling through to it meant a cold-starting or
     * momentarily unreachable API, which answers with an HTML error page
     * rather than JSON, silently became "Email or password is incorrect" —
     * telling someone their real credentials were wrong when the actual
     * problem was that BioAssetPro had not woken up yet. Only a body this
     * API actually sent should ever name the credentials as the problem.
     */
    const message = Array.isArray(body?.message)
      ? body.message.join(' ')
      : typeof body?.message === 'string'
        ? body.message
        : "BioAssetPro didn't respond correctly — it may still be starting up. Wait a few seconds and try again.";
    return { error: message };
  }

  const result = (await response.json()) as AuthenticationResult;
  return finishAuthentication(result, '/');
}

/**
 * How long to wait from the standard Retry-After header. Accept older
 * bucket-specific headers during a rolling deployment.
 */
function retrySecondsFromHeader(response: Response): number {
  let seconds = 0;
  response.headers.forEach((value, name) => {
    if (!name.toLowerCase().startsWith('retry-after')) return;
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > seconds) seconds = parsed;
  });
  return seconds;
}

function retryAdvice(seconds: number): string {
  if (seconds <= 0) return 'Wait a few minutes, then try again.';
  if (seconds < 90) return `Try again in ${seconds} seconds.`;
  const minutes = Math.ceil(seconds / 60);
  return `Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * What to say when the API could not be reached at all.
 *
 * Away from production the address is the useful part of the message, because
 * the reader is the person who has to start it. In production it is noise at
 * best, so the message says what happened and what to do instead.
 */
function unreachableMessage(): string {
  if (process.env.NODE_ENV !== 'production') {
    return `Cannot reach the BioAssetPro API at ${API_URL}. Is it running?`;
  }
  return (
    'BioAssetPro did not answer in time. It may be starting up after a quiet ' +
    'spell — wait a moment and try again. If this keeps happening, tell whoever ' +
    'administers the server.'
  );
}

export async function logout(): Promise<void> {
  await clearToken();
  redirect('/login');
}
