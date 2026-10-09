'use server';

import { redirect } from 'next/navigation';
import { clearMfaChallenge, setMfaChallenge, setToken, type SessionUser } from './session';

export type AuthenticationResult =
  | { accessToken: string; user: SessionUser; mfaSetupRequired?: boolean }
  | { mfaRequired: true; challengeToken: string };

export async function finishAuthentication(result: AuthenticationResult, destination: string): Promise<never> {
  if ('challengeToken' in result) {
    await setMfaChallenge(result.challengeToken);
    redirect('/mfa/verify');
  }
  await clearMfaChallenge();
  await setToken(result.accessToken);
  redirect(result.mfaSetupRequired ? '/mfa/setup' : destination);
}
