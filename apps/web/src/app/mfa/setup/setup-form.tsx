'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { confirmMfaSetup, finishMfaSetup, type MfaActionState } from '../actions';

const EMPTY: MfaActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary" type="submit" disabled={pending}>
      {pending ? 'Confirming…' : 'Enable MFA'}
    </button>
  );
}

function FinishButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary" formAction={finishMfaSetup} disabled={pending}>
      Continue to sign in
    </button>
  );
}

export function SetupMfaForm() {
  const [state, action] = useActionState(confirmMfaSetup, EMPTY);
  if (state.recoveryCodes) {
    return (
      <div className="stack">
        <div className="notice notice-success">
          Authenticator MFA is enabled. Save these recovery codes somewhere private; each works once,
          and they cannot be shown again.
        </div>
        <ul className="stack" aria-label="One-time recovery codes">
          {state.recoveryCodes.map((code) => (
            <li key={code}><code>{code}</code></li>
          ))}
        </ul>
        <form action={finishMfaSetup}>
          <FinishButton />
        </form>
      </div>
    );
  }

  return (
    <form action={action} className="stack">
      {state.error ? <div className="notice notice-error" role="alert">{state.error}</div> : null}
      <label className="field">
        Six-digit authenticator code
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
      </label>
      <SubmitButton />
    </form>
  );
}
