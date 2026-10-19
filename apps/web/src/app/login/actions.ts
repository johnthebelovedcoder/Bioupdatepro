'use server';

import { redirect } from 'next/navigation';
import { clearToken } from '@/lib/session';
import { finishAuthentication, type AuthenticationResult } from '@/lib/auth-result';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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
    });
  } catch {
    return {
      error: `Cannot reach the BioAssetPro API at ${API_URL}. Is it running?`,
    };
  }

  if (response.status === 429) {
    // The API's throttle answers with its exception's name, which means nothing
    // to a person. It does say how long the wait is, though, in a Retry-After
    // header named after whichever bucket ran out — and "wait a few minutes"
    // sent people back to the form every thirty seconds to spend the attempts
    // they were waiting to get back.
    return { error: `Too many sign-in attempts. ${retryAdvice(response)}` };
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
 * How long to wait, from whichever Retry-After header the throttle sent.
 *
 * The headers are named per bucket — `Retry-After-account` when it is this
 * account's attempts that are spent, `Retry-After-ceiling` when the whole
 * server is being hammered — so take the longest of them rather than guessing
 * which one applies.
 */
function retryAdvice(response: Response): string {
  let seconds = 0;
  response.headers.forEach((value, name) => {
    if (!name.toLowerCase().startsWith('retry-after')) return;
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > seconds) seconds = parsed;
  });

  if (seconds <= 0) return 'Wait a few minutes, then try again.';
  if (seconds < 90) return `Try again in ${Math.max(1, Math.ceil(seconds / 10) * 10)} seconds.`;
  const minutes = Math.ceil(seconds / 60);
  return `Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

export async function logout(): Promise<void> {
  await clearToken();
  redirect('/login');
}
