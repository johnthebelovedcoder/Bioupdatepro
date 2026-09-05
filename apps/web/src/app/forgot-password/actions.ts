'use server';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface ForgotPasswordState {
  submitted: boolean;
  error: string | null;
}

/**
 * Always the same outcome, whether or not the email had an account.
 *
 * The API already returns the same `{ok: true}` shape either way (see
 * `PasswordResetService.requestForSelf()`'s own comment) — this stays
 * equally quiet about it rather than, say, surfacing a "user not found"
 * network error as if it meant something different from success.
 */
export async function requestPasswordReset(
  _previous: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { submitted: false, error: 'Enter your email address.' };

  try {
    await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });
  } catch {
    return { submitted: false, error: `Cannot reach the API at ${API_URL}. Is it running?` };
  }

  // Reached even if the API call above 404s or errors — the point of the
  // generic response is that nothing about this form's own behaviour should
  // let someone tell an account apart from a mistyped email either.
  return { submitted: true, error: null };
}

export async function emailAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/auth/providers`, { cache: 'no-store' });
    if (!response.ok) return false;
    const data = (await response.json()) as { email?: boolean };
    return Boolean(data.email);
  } catch {
    return false;
  }
}
