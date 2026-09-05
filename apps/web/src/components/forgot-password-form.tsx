'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  requestPasswordReset,
  type ForgotPasswordState,
} from '@/app/forgot-password/actions';

export function ForgotPasswordForm() {
  const [state, action] = useActionState<ForgotPasswordState, FormData>(requestPasswordReset, {
    submitted: false,
    error: null,
  });

  if (state.submitted) {
    return (
      <div className="notice notice-info">
        If an account exists for that email, a reset link is on its way. It can take a minute
        to arrive — check your spam folder if you don&rsquo;t see it.
      </div>
    );
  }

  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}

      <label className="field">
        Email address
        <input name="email" type="email" autoComplete="email" required autoFocus />
        <span className="faint">The address you sign in with.</span>
      </label>

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Sending…' : 'Send reset link'}
    </button>
  );
}
