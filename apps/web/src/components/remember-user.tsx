'use client';

import { useEffect } from 'react';

const STORAGE_KEY = 'bap_last_user';

/**
 * Remembers who is signed in, so the login page can greet them by name next
 * time. Writes to localStorage on mount — nothing else, no state, no render.
 *
 * The value is the person's name and email, never a token or session. It is
 * read only by the login form's welcome-back screen and cleared only when the
 * user explicitly switches accounts.
 */
export function RememberUser({ email, fullName }: { email: string; fullName: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ email, fullName }));
    } catch { /* quota, private browsing, etc */ }
  }, [email, fullName]);

  return null;
}
