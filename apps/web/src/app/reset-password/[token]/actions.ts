'use server';

import { redirect } from 'next/navigation';
import { setToken, type SessionUser } from '@/lib/session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface ResetState {
  error: string | null;
}

/**
 * Set a new password and sign in with it.
 *
 * Mirrors `acceptInvitation` in shape: the email is never a field here
 * either, because it comes from the token, not from whoever is holding the
 * link.
 */
export async function completeReset(
  token: string,
  _previous: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const password = String(formData.get('password') ?? '');
  if (password.length < 10) {
    return { error: 'Use at least 10 characters. A short phrase you will remember is ideal.' };
  }

  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/auth/password-reset/token/${encodeURIComponent(token)}/complete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
        cache: 'no-store',
      },
    );
  } catch {
    return { error: `Cannot reach the API at ${API_URL}. Is it running?` };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(' ')
      : typeof body?.message === 'string'
        ? body.message
        : 'That did not work. Please try again.';
    return { error: message };
  }

  const { accessToken } = (await response.json()) as {
    accessToken: string;
    user: SessionUser;
  };

  await setToken(accessToken);
  redirect('/');
}

/** What the link resolves to, for the page to show before anybody commits. */
export async function describeReset(
  token: string,
): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  try {
    const response = await fetch(
      `${API_URL}/auth/password-reset/token/${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, reason: body?.message ?? 'This link is not valid.' };
    }
    const data = (await response.json()) as { email: string };
    return { ok: true, ...data };
  } catch {
    return { ok: false, reason: 'Cannot reach the server. Try again in a moment.' };
  }
}
