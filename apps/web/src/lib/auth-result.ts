'use server';

import { redirect } from 'next/navigation';
import { clearMfaChallenge, clearToken, setMfaChallenge, setToken, type SessionUser } from './session';

export interface AuthenticationResult {
  user: SessionUser;
  accessToken?: string;
  challengeToken?: string;
}

export async function finishAuthentication(result: AuthenticationResult, destination: string): Promise<never> {
  if (result.challengeToken) {
    await clearToken();
    await setMfaChallenge(result.challengeToken);
    redirect('/mfa/verify');
  }
  if (!result.accessToken) throw new Error('The sign-in response did not contain a session token.');
  await clearMfaChallenge();
  await setToken(result.accessToken);
  if (result.user.mfaRequired && !result.user.mfaEnabled) redirect('/mfa/setup');
  redirect(destination);
}
