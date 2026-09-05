'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signup, type SignupState } from '@/app/signup/actions';
import { PasswordField } from './password-field';

/**
 * Creating a farm.
 *
 * Four fields, and not one of them is optional or decorative. The farm's name
 * is asked for here rather than in a later settings screen because it names the
 * company the account belongs to — everything else can be changed afterwards,
 * but a farm has to exist before there is anywhere to put a batch.
 *
 * Every field carries a line of help beneath it. On a product whose users are
 * often signing up on a phone, in a second language, "Farm or business name"
 * with nothing under it invites the person to type their own name again.
 *
 * Password and its confirmation are controlled, not uncontrolled like the
 * rest of the form — the one thing this pair needs that a plain
 * `defaultValue` cannot give is comparing the two live, so a mismatch is
 * caught before a farm is provisioned rather than after, on a server round
 * trip that would also make the person retype both.
 */
export function SignupForm() {
  const [state, action] = useActionState<SignupState, FormData>(signup, {
    error: null,
    field: null,
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
      {state.error && !state.field ? (
        <div className="notice notice-error">{state.error}</div>
      ) : null}

      <Field
        label="Your name"
        name="fullName"
        hint="Whoever records or approves something is recorded against this name."
        autoComplete="name"
        defaultValue={state.values?.fullName}
        error={state.field === 'fullName' ? state.error : null}
      />

      <Field
        label="Farm or business name"
        name="farmName"
        hint="The name of the farm itself, not yours — it appears on your reports."
        autoComplete="organization"
        defaultValue={state.values?.farmName}
        error={state.field === 'farmName' ? state.error : null}
      />

      <Field
        label="Email address"
        name="email"
        type="email"
        hint="You will sign in with this."
        autoComplete="email"
        defaultValue={state.values?.email}
        error={state.field === 'email' ? state.error : null}
      />

      <label className="field">
        Password
        <PasswordField
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          ariaInvalid={state.field === 'password'}
          ariaDescribedBy="password-hint"
        />
        <span id="password-hint" className={state.field === 'password' ? 'field-error' : 'faint'}>
          {state.field === 'password'
            ? state.error
            : 'At least 10 characters. A short phrase you will remember beats a complicated word you will not.'}
        </span>
      </label>

      <label className="field">
        Confirm password
        <PasswordField
          name="confirmPassword"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          ariaInvalid={mismatch}
          ariaDescribedBy="confirm-password-hint"
        />
        <span id="confirm-password-hint" className={mismatch ? 'field-error' : 'faint'}>
          {mismatch ? 'This does not match the password above.' : 'Type it again to catch a typo.'}
        </span>
      </label>

      <Submit disabled={mismatch} />

      <p className="faint" style={{ fontSize: 13, margin: 0 }}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  hint,
  type = 'text',
  autoComplete,
  defaultValue,
  error,
}: {
  label: string;
  name: string;
  hint: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  error?: string | null;
}) {
  return (
    <label className="field">
      {label}
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${name}-hint`}
        required
      />
      <span id={`${name}-hint`} className={error ? 'field-error' : 'faint'}>
        {error ?? hint}
      </span>
    </label>
  );
}

/**
 * Disabled while submitting, or while the two passwords disagree.
 *
 * Registration provisions a whole chart of accounts, so it takes a moment on a
 * slow connection — long enough for somebody to press the button twice and
 * wonder why the second attempt says their email is taken.
 */
function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending || disabled}>
      {pending ? 'Setting up your farm…' : 'Create my farm'}
    </button>
  );
}
