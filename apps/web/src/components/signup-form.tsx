'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signup, type SignupState } from '@/app/signup/actions';
import { PasswordField } from './password-field';

/**
 * Multi-step farm signup.
 *
 * Three steps rather than one long form:
 *   1. Your name and email
 *   2. Password
 *   3. Farm name and module selection
 *
 * Each step is one screen with a progress indicator. The data accumulates in
 * local state and only submits to the server on the final step, which is the
 * only one that can fail for a reason the person didn't already control (a
 * taken email, a network error).
 */

/** The species modules the user can subscribe to. */
const AVAILABLE_MODULES = [
  {
    key: 'agripro',
    label: 'AgriPro Core',
    description: 'Financial management, GL, procurement, sales, payroll, approvals',
    alwaysOn: true,
  },
  {
    key: 'poultry',
    label: 'PoultryPro',
    description: 'Flocks, egg collection, incubation, feed, mortality',
    alwaysOn: false,
  },
  {
    key: 'snail',
    label: 'SnailPro',
    description: 'Cohorts, breeding, harvest, growth tracking',
    alwaysOn: false,
  },
  {
    key: 'fish',
    label: 'FishPro',
    description: 'Pond management, stocking, feeding, harvest',
    alwaysOn: false,
    comingSoon: true,
  },
  {
    key: 'dairy',
    label: 'DairyPro',
    description: 'Herds, milking, calving, yield tracking',
    alwaysOn: false,
    comingSoon: true,
  },
  {
    key: 'pig',
    label: 'PigPro',
    description: 'Batches, farrowing, weight tracking, feed',
    alwaysOn: false,
    comingSoon: true,
  },
  {
    key: 'goat',
    label: 'GoatPro',
    description: 'Flocks, kidding, weight tracking, feed',
    alwaysOn: false,
    comingSoon: true,
  },
  {
    key: 'rabbit',
    label: 'RabbitPro',
    description: 'Colonies, kindling, weight tracking, feed',
    alwaysOn: false,
    comingSoon: true,
  },
] satisfies readonly { key: string; label: string; description: string; alwaysOn: boolean; comingSoon?: boolean }[];

const STEPS = ['About you', 'Secure your account', 'Your farm'] as const;
type Step = 0 | 1 | 2;

export function SignupForm() {
  const [state, action] = useActionState<SignupState, FormData>(signup, {
    error: null,
    field: null,
  });

  const [step, setStep] = useState<Step>(0);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [farmName, setFarmName] = useState('');
  const [selectedModules, setSelectedModules] = useState<string[]>(['poultry', 'snail']);

  // Restore values from server state when the final step errors
  if (state.values && step === 2) {
    if (state.values.fullName && !fullName) setFullName(state.values.fullName);
    if (state.values.email && !email) setEmail(state.values.email);
    if (state.values.farmName && !farmName) setFarmName(state.values.farmName);
  }

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  function toggleModule(key: string) {
    setSelectedModules((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  function selectAll() {
    setSelectedModules(
      AVAILABLE_MODULES.filter((m) => !m.alwaysOn && !m.comingSoon).map((m) => m.key),
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--sp-5)' }}>
      {/* Progress indicator */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          justifyContent: 'center',
        }}
      >
        {STEPS.map((label, i) => (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-2)',
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 600,
                background:
                  i < step
                    ? 'var(--brand-600)'
                    : i === step
                      ? 'var(--brand-600)'
                      : 'var(--gray-200)',
                color:
                  i <= step ? 'white' : 'var(--gray-500)',
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              {i < step ? '✓' : i + 1}
            </div>
            <span
              className="show-on-desktop"
              style={{
                fontSize: 13,
                fontWeight: i === step ? 600 : 400,
                color: i === step ? 'var(--gray-900)' : 'var(--gray-500)',
              }}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  width: 24,
                  height: 2,
                  background: i < step ? 'var(--brand-600)' : 'var(--gray-200)',
                  borderRadius: 1,
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Name & Email */}
      {step === 0 && (
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Let&apos;s get started</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>
              Tell us who you are
            </div>
          </div>

          <label className="field">
            Your name
            <input
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Adebayo Okafor"
            />
            <span className="faint">
              Whoever records or approves something is recorded against this name.
            </span>
          </label>

          <label className="field">
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <span className="faint">You will sign in with this.</span>
          </label>

          <button
            type="button"
            className="btn btn-primary"
            disabled={!fullName.trim() || !email.trim() || !email.includes('@')}
            onClick={() => setStep(1)}
          >
            Continue
          </button>

          <p className="faint" style={{ fontSize: 13, margin: 0 }}>
            Already have an account? <Link href="/login">Sign in</Link>
          </p>
        </div>
      )}

      {/* Step 2: Password */}
      {step === 1 && (
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Secure your account</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>
              Choose a strong password
            </div>
          </div>

          <label className="field">
            Password
            <PasswordField
              name="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              ariaDescribedBy="password-hint"
            />
            <span id="password-hint" className="faint">
              At least 10 characters. A short phrase you will remember beats a complicated word you will not.
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
            <span
              id="confirm-password-hint"
              className={mismatch ? 'field-error' : 'faint'}
            >
              {mismatch
                ? 'This does not match the password above.'
                : 'Type it again to catch a typo.'}
            </span>
          </label>

          <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setStep(0)}
            >
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={password.length < 10 || mismatch || !confirmPassword}
              onClick={() => setStep(2)}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Farm name & Modules */}
      {step === 2 && (
        <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
          {/* Hidden fields from previous steps */}
          <input type="hidden" name="fullName" value={fullName} />
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="password" value={password} />
          {selectedModules.map((m) => (
            <input key={m} type="hidden" name="modules" value={m} />
          ))}

          {state.error ? (
            <div className="notice notice-error">{state.error}</div>
          ) : null}

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Set up your farm</div>
            <div className="muted" style={{ fontSize: 14, marginTop: 2 }}>
              Name your farm and choose what you need
            </div>
          </div>

          <label className="field">
            Farm or business name
            <input
              type="text"
              name="farmName"
              autoComplete="organization"
              required
              value={farmName}
              onChange={(e) => setFarmName(e.target.value)}
              placeholder="e.g. Kajola Farms"
            />
            <span className={state.field === 'farmName' ? 'field-error' : 'faint'}>
              {state.field === 'farmName'
                ? state.error
                : 'The name of the farm itself — it appears on your reports.'}
            </span>
          </label>

          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'var(--sp-3)',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>What does your farm do?</span>
              <button
                type="button"
                className="faint"
                style={{
                  fontSize: 13,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                }}
                onClick={selectAll}
              >
                Select all
              </button>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 'var(--sp-2)',
              }}
            >
              {AVAILABLE_MODULES.map((mod) => {
                const checked = mod.alwaysOn || selectedModules.includes(mod.key);
                const disabled = mod.alwaysOn || mod.comingSoon;
                return (
                  <label
                    key={mod.key}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'var(--sp-3)',
                      padding: 'var(--sp-3)',
                      borderRadius: 8,
                      border: `1.5px solid ${checked ? 'var(--brand-500)' : 'var(--gray-200)'}`,
                      background: checked ? 'var(--brand-50)' : 'transparent',
                      cursor: disabled ? 'default' : 'pointer',
                      opacity: mod.comingSoon ? 0.55 : 1,
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleModule(mod.key)}
                      style={{ marginTop: 2, accentColor: 'var(--brand-600)' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {mod.label}
                        {mod.alwaysOn && (
                          <span
                            className="muted"
                            style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}
                          >
                            Always included
                          </span>
                        )}
                        {mod.comingSoon && (
                          <span
                            style={{
                              fontWeight: 500,
                              fontSize: 11,
                              marginLeft: 6,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: 'var(--gray-200)',
                              color: 'var(--gray-600)',
                            }}
                          >
                            Coming soon
                          </span>
                        )}
                      </div>
                      <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                        {mod.description}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--sp-3)' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setStep(1)}
            >
              Back
            </button>
            <SubmitButton disabled={!farmName.trim() || selectedModules.length === 0} />
          </div>
        </form>
      )}
    </div>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn btn-primary"
      style={{ flex: 1 }}
      disabled={pending || disabled}
    >
      {pending ? 'Setting up your farm…' : 'Create my farm'}
    </button>
  );
}
