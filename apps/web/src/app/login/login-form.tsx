'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { login, type LoginState } from './actions';

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
        <input name="password" type="password" autoComplete="current-password" required />
      </label>

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
