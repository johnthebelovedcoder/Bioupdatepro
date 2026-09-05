'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { completeReset, type ResetState } from '@/app/reset-password/[token]/actions';

/** One field: the new password. The email is shown but fixed — it comes from the link, not from whoever is holding it. */
export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const complete = completeReset.bind(null, token);
  const [state, action] = useActionState<ResetState, FormData>(complete, { error: null });

  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}

      <label className="field">
        Email address
        <input value={email} readOnly disabled />
        <span className="faint">This is whose password you are setting.</span>
      </label>

      <label className="field">
        New password
        <input name="password" type="password" autoComplete="new-password" required autoFocus />
        <span className="faint">
          At least 10 characters. A short phrase you will remember beats a complicated word you
          will not.
        </span>
      </label>

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Setting password…' : 'Set password and sign in'}
    </button>
  );
}
