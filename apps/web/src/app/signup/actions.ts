'use server';

import { redirect } from 'next/navigation';
import { setToken, type SessionUser } from '@/lib/session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface SignupState {
  error: string | null;
  /** Which field the error belongs to, so the form can point at it. */
  field?: 'fullName' | 'email' | 'password' | 'farmName' | null;
  /**
   * What was typed, handed back so the form can refill itself.
   *
   * Submitting a server action re-renders the form and uncontrolled inputs come
   * back empty. Without this, somebody who mistypes their password loses their
   * name, their farm's name and their email address along with it — four fields
   * retyped to fix one, on a phone. That is where people give up.
   *
   * The password is deliberately absent. It is the one value never echoed back,
   * because doing so puts it in the rendered HTML.
   */
  values?: { fullName: string; farmName: string; email: string };
}

/**
 * Create a farm and its first user.
 *
 * The person signing up is the owner. Everything the farm needs to function —
 * its chart of accounts, its cost centres, its financial calendar — is built by
 * the API in the same transaction, so what comes back is a farm that can record
 * a round on its first morning rather than an empty shell that fails at the
 * first posting.
 *
 * Like sign-in, the token is read here on the server and only ever leaves as an
 * httpOnly cookie. It never touches browser JavaScript.
 */
export async function signup(
  _previous: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const fullName = String(formData.get('fullName') ?? '').trim();
  const farmName = String(formData.get('farmName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  // Handed back on every failure path so nothing typed is ever lost.
  const kept = { fullName, farmName, email };

  if (!fullName) return fail('Enter your name.', 'fullName', kept);
  if (!farmName) return fail('Enter the name of your farm.', 'farmName', kept);
  if (!email) return fail('Enter your email address.', 'email', kept);
  if (password.length < 10) {
    return fail('Use at least 10 characters. A short phrase you will remember is ideal.', 'password', kept);
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName, email, password, farmName }),
      cache: 'no-store',
    });
  } catch {
    return fail(`Cannot reach the BioAssetPro API at ${API_URL}. Is it running?`, null, kept);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(' ')
      : typeof body?.message === 'string'
        ? body.message
        : 'That did not work. Please try again.';
    // A taken email is the one failure with an obvious next step, so it points
    // at the field rather than sitting at the top of the form.
    return fail(message, response.status === 409 ? 'email' : null, kept);
  }

  const { accessToken } = (await response.json()) as {
    accessToken: string;
    user: SessionUser;
  };

  await setToken(accessToken);
  // Straight into onboarding rather than the dashboard. A farm with no
  // populations in it has nothing to show, and dropping somebody onto empty
  // charts is how a product gets abandoned in the first five minutes.
  redirect('/welcome');
}

function fail(
  error: string,
  field: SignupState['field'],
  values: SignupState['values'],
): SignupState {
  return { error, field: field ?? null, values };
}

/** Which sign-in providers the API actually has configured. */
export async function availableProviders(): Promise<{
  password: boolean;
  google: boolean;
  facebook: boolean;
}> {
  try {
    const response = await fetch(`${API_URL}/auth/providers`, { cache: 'no-store' });
    if (!response.ok) return { password: true, google: false, facebook: false };
    return (await response.json()) as { password: boolean; google: boolean; facebook: boolean };
  } catch {
    // Unreachable API: offer the form, which will report the same problem in
    // words when it is submitted.
    return { password: true, google: false, facebook: false };
  }
}
