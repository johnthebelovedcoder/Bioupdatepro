'use server';

import { redirect } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import {
  clearMfaChallenge,
  clearToken,
  getMfaChallenge,
  setToken,
  type SessionUser,
} from '@/lib/session';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface MfaActionState {
  error: string | null;
  recoveryCodes?: string[];
}

export async function verifyMfaLogin(
  _previous: MfaActionState,
  formData: FormData,
): Promise<MfaActionState> {
  const code = String(formData.get('code') ?? '').trim();
  const challengeToken = await getMfaChallenge();
  if (!challengeToken) return { error: 'This sign-in challenge expired. Return to sign in and try again.' };

  let response: Response;
  try {
    response = await fetch(`${API_URL}/auth/mfa/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challengeToken, code }),
      cache: 'no-store',
    });
  } catch {
    return { error: `Cannot reach the BioAssetPro API at ${API_URL}. Is it running?` };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    const message = typeof body?.message === 'string'
      ? body.message
      : 'That code was not accepted. Check it and try again.';
    return { error: message };
  }
  const result = await response.json() as { accessToken: string; user: SessionUser };
  await setToken(result.accessToken);
  await clearMfaChallenge();
  redirect('/');
}

export async function confirmMfaSetup(
  _previous: MfaActionState,
  formData: FormData,
): Promise<MfaActionState> {
  const code = String(formData.get('code') ?? '').trim();
  try {
    const result = await api<{ recoveryCodes: string[] }>('/auth/mfa/confirm', {
      method: 'POST',
      body: { code },
    });
    return { error: null, recoveryCodes: result.recoveryCodes };
  } catch (caught) {
    return {
      error: caught instanceof ApiError ? caught.message : 'Could not confirm authenticator setup.',
    };
  }
}

export async function finishMfaSetup(): Promise<never> {
  await clearToken();
  await clearMfaChallenge();
  redirect('/login?mfa=enabled');
}
