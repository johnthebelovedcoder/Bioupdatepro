'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signup, type SignupState } from '@/app/signup/actions';

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
 */
export function SignupForm() {
  const [state, action] = useActionState<SignupState, FormData>(signup, {
    error: null,
    field: null,
  });

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

      <Field
        label="Password"
        name="password"
        type="password"
        hint="At least 10 characters. A short phrase you will remember beats a complicated word you will not."
        autoComplete="new-password"
        error={state.field === 'password' ? state.error : null}
      />

      <Submit />

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
 * Disabled while submitting.
 *
 * Registration provisions a whole chart of accounts, so it takes a moment on a
 * slow connection — long enough for somebody to press the button twice and
 * wonder why the second attempt says their email is taken.
 */
function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Setting up your farm…' : 'Create my farm'}
    </button>
  );
}
