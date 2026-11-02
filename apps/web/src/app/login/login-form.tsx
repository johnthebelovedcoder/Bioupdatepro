'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { login, type LoginState } from './actions';
import { PasswordField } from '@/components/password-field';

const initialState: LoginState = { error: null };

/** What we remember about the last person who signed in on this browser. */
interface RememberedUser {
  email: string;
  fullName: string;
}

const STORAGE_KEY = 'bap_last_user';

function getRemembered(): RememberedUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedUser>;
    if (typeof parsed.email === 'string' && typeof parsed.fullName === 'string') {
      return { email: parsed.email, fullName: parsed.fullName };
    }
  } catch { /* empty */ }
  return null;
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, initialState);
  const [remembered, setRemembered] = useState<RememberedUser | null>(null);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    const user = getRemembered();
    if (user) setRemembered(user);
    else setShowFull(true);
  }, []);

  // If there's an error and we're in welcome-back mode, stay in welcome-back
  // mode (don't flip to the full form)
  const welcomeBack = remembered && !showFull;

  if (welcomeBack) {
    return (
      <form action={formAction} className="stack">
        {state.error ? (
          <div className="notice notice-error login-error-notice" role="alert">
            <p className="login-error-copy">{state.error}</p>
          </div>
        ) : null}

        {/* Hidden email field so the server action still receives it */}
        <input type="hidden" name="email" value={remembered.email} />

        <div style={{ textAlign: 'center', padding: 'var(--sp-2) 0' }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'var(--brand-100)',
              color: 'var(--brand-700)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 600,
              marginBottom: 'var(--sp-3)',
            }}
          >
            {remembered.fullName.charAt(0).toUpperCase()}
          </div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>
            Welcome back, {remembered.fullName.split(' ')[0]}
          </div>
          <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>
            {remembered.email}
          </div>
        </div>

        <label className="field">
          Password
          <PasswordField name="password" autoComplete="current-password" required />
        </label>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Link href="/forgot-password" className="faint" style={{ fontSize: 13 }}>
            Forgot password?
          </Link>
        </div>

        <SubmitButton />

        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 13 }}
          onClick={() => setShowFull(true)}
        >
          Use a different account
        </button>
      </form>
    );
  }

  return (
    <form action={formAction} className="stack">
      {state.error ? (
        <div className="notice notice-error login-error-notice" role="alert">
          <p className="login-error-copy">{state.error}</p>
        </div>
      ) : null}

      <label className="field">
        Email address
        <input
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          placeholder="you@bioassetpro.ng"
          defaultValue={remembered?.email}
        />
      </label>

      <label className="field">
        Password
        <PasswordField name="password" autoComplete="current-password" required />
      </label>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Link href="/forgot-password" className="faint" style={{ fontSize: 13 }}>
          Forgot password?
        </Link>
      </div>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}
