'use server';

import { redirect } from 'next/navigation';
import { setToken, type SessionUser } from '@/lib/session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface JoinState {
  error: string | null;
  field?: 'fullName' | 'password' | null;
  values?: { fullName: string };
}

/**
 * Accept an invitation.
 *
 * The email is NOT a field on this form. It comes from the invitation record on
 * the server, because a link addressed to one worker must not become an account
 * for whoever else got hold of it. The person filling this in chooses only
 * their name and their password.
 */
export async function acceptInvitation(
  token: string,
  _previous: JoinState,
  formData: FormData,
): Promise<JoinState> {
  const fullName = String(formData.get('fullName') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const kept = { fullName };

  if (!fullName) return { error: 'Enter your name.', field: 'fullName', values: kept };
  if (password.length < 10) {
    return {
      error: 'Use at least 10 characters. A short phrase you will remember is ideal.',
      field: 'password',
      values: kept,
    };
  }

  let response: Response;
  try {
    response = await fetch(
      `${API_URL}/auth/invitations/token/${encodeURIComponent(token)}/accept`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName, password }),
        cache: 'no-store',
      },
    );
  } catch {
    return { error: `Cannot reach the API at ${API_URL}. Is it running?`, values: kept };
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    const message = Array.isArray(body?.message)
      ? body.message.join(' ')
      : typeof body?.message === 'string'
        ? body.message
        : 'That did not work. Please try again.';
    return { error: message, values: kept };
  }

  const { accessToken } = (await response.json()) as {
    accessToken: string;
    user: SessionUser;
  };

  await setToken(accessToken);
  // A worker joining an existing farm lands on the daily round, not on
  // onboarding: the farm is already set up, and the round is the job.
  redirect('/');
}

/** What the invitation says, for the page to show before anybody commits. */
export async function describeInvitation(token: string): Promise<
  | { ok: true; email: string; farmName: string; invitedBy: string; roles: string[] }
  | { ok: false; reason: string }
> {
  try {
    const response = await fetch(
      `${API_URL}/auth/invitations/token/${encodeURIComponent(token)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      return { ok: false, reason: body?.message ?? 'This invitation is not valid.' };
    }
    const data = (await response.json()) as {
      email: string;
      farmName: string;
      invitedBy: string;
      roles: string[];
    };
    return { ok: true, ...data };
  } catch {
    return { ok: false, reason: 'Cannot reach the server. Try again in a moment.' };
  }
}
