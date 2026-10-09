'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { verifyMfaLogin, type MfaActionState } from '../actions';

const EMPTY: MfaActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary" type="submit" disabled={pending}>
      {pending ? 'Verifying…' : 'Verify and sign in'}
    </button>
  );
}

export function VerifyMfaForm() {
  const [state, action] = useActionState(verifyMfaLogin, EMPTY);
  return (
    <form action={action} className="stack">
      {state.error ? <div className="notice notice-error" role="alert">{state.error}</div> : null}
      <label className="field">
        Authenticator or recovery code
        <input name="code" autoComplete="one-time-code" autoFocus required />
      </label>
      <SubmitButton />
    </form>
  );
}
