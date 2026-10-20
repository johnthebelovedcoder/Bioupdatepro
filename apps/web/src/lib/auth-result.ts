'use server';

import { redirect } from 'next/navigation';
import { clearMfaChallenge, setToken, type SessionUser } from './session';

export interface AuthenticationResult {
  accessToken: string;
  user: SessionUser;
}

export async function finishAuthentication(result: AuthenticationResult, destination: string): Promise<never> {
  await clearMfaChallenge();
  await setToken(result.accessToken);
  redirect(destination);
}
