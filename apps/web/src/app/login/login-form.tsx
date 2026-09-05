'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { login, type LoginState } from './actions';
import { PasswordField } from '@/components/password-field';

const initialState: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction] = useActionState(login, initialState);

  return (
    <form action={formAction} className="stack">
      {state.error ? (
        <div className="notice notice-error" role="alert">
          {state.error}
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
