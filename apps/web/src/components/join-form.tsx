'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { acceptInvitation, type JoinState } from '@/app/join/[token]/actions';
import { PasswordField } from './password-field';

/**
 * Accepting an invitation.
 *
 * Two fields. The email is shown but not editable — it is what the invitation
 * was addressed to, and letting somebody change it would turn a link meant for
 * one worker into an account for anybody holding it.
 */
export function JoinForm({ token, email }: { token: string; email: string }) {
  const accept = acceptInvitation.bind(null, token);
  const [state, action] = useActionState<JoinState, FormData>(accept, {
    error: null,
    field: null,
  });

  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
      {state.error && !state.field ? (
        <div className="notice notice-error">{state.error}</div>
      ) : null}

      <label className="field">
        Email address
        <input value={email} readOnly disabled />
        <span className="faint">This is who the invitation was sent to.</span>
      </label>

      <label className="field">
        Your name
        <input
          name="fullName"
          autoComplete="name"
          defaultValue={state.values?.fullName}
          aria-invalid={state.field === 'fullName' ? true : undefined}
          required
        />
        <span className={state.field === 'fullName' ? 'field-error' : 'faint'}>
          {state.field === 'fullName'
            ? state.error
            : 'Anything you record is signed with this name.'}
        </span>
      </label>

      <label className="field">
        Choose a password
        <PasswordField
          name="password"
          autoComplete="new-password"
          required
          ariaInvalid={state.field === 'password'}
        />
        <span className={state.field === 'password' ? 'field-error' : 'faint'}>
          {state.field === 'password'
            ? state.error
            : 'At least 10 characters. A short phrase you will remember beats a complicated word you will not.'}
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
      {pending ? 'Joining…' : 'Join the farm'}
    </button>
  );
}
