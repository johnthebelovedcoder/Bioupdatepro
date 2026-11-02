'use client';

import { useActionState, useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signup, type SignupState } from '@/app/signup/actions';
import { PasswordField } from './password-field';

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

type Step = 0 | 1 | 2 | 3 | 4 | 5;
const TOTAL_STEPS = 6;

export function SignupForm({ hasSocialSignIn }: { hasSocialSignIn?: boolean }) {
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

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  if (state.values && step === 5) {
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

  function next() {
    if (step < 5) setStep((step + 1) as Step);
  }

  function back() {
    if (step > 0) setStep((step - 1) as Step);
  }

  function onEnter(e: KeyboardEvent, canProceed: boolean) {
    if (e.key === 'Enter' && canProceed) {
      e.preventDefault();
      next();
    }
  }

  const progress = ((step + 1) / TOTAL_STEPS) * 100;

  const canNext: Record<Step, boolean> = {
    0: fullName.trim().length > 0,
    1: email.trim().length > 0 && email.includes('@'),
    2: password.length >= 10,
    3: confirmPassword.length > 0 && !mismatch && password === confirmPassword,
    4: farmName.trim().length > 0,
    5: selectedModules.length > 0,
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--surface, #fff)',
      zIndex: 1000,
    }}>
      {/* Progress bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        background: 'var(--gray-200)',
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: 'var(--brand-600)',
          transition: 'width 0.4s ease',
          borderRadius: '0 2px 2px 0',
        }} />
      </div>

      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="brand-mark" aria-hidden="true" style={{ width: 32, height: 32, fontSize: 13 }}>BA</span>
          <span style={{ fontWeight: 600, fontSize: 15 }}>BioAssetPro</span>
        </div>
        <Link href="/login" style={{ fontSize: 14, color: 'var(--brand-600)', textDecoration: 'none' }}>
          Already have an account?
        </Link>
      </div>

      {/* Main content area — centered */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 24px',
        overflow: 'auto',
      }}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          {/* Step 1: Name */}
          {step === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-600)', marginBottom: 8 }}>
                  1 / {TOTAL_STEPS}
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
                  What is your name?
                </h1>
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 15 }}>
                  This is how you appear on reports and approvals.
                </p>
              </div>
              <input
                ref={inputRef}
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onKeyDown={(e) => onEnter(e, canNext[0])}
                placeholder="e.g. Adebayo Okafor"
                style={{
                  fontSize: 20,
                  padding: '14px 0',
                  border: 'none',
                  borderBottom: '2px solid var(--gray-300)',
                  outline: 'none',
                  background: 'transparent',
                  width: '100%',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => { e.target.style.borderBottomColor = 'var(--brand-600)'; }}
                onBlur={(e) => { e.target.style.borderBottomColor = 'var(--gray-300)'; }}
              />
            </div>
          )}

          {/* Step 2: Email */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-600)', marginBottom: 8 }}>
                  2 / {TOTAL_STEPS}
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
                  What is your email?
                </h1>
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 15 }}>
                  You will sign in with this.
                </p>
              </div>
              <input
                ref={inputRef}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => onEnter(e, canNext[1])}
                placeholder="you@example.com"
                style={{
                  fontSize: 20,
                  padding: '14px 0',
                  border: 'none',
                  borderBottom: '2px solid var(--gray-300)',
                  outline: 'none',
                  background: 'transparent',
                  width: '100%',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => { e.target.style.borderBottomColor = 'var(--brand-600)'; }}
                onBlur={(e) => { e.target.style.borderBottomColor = 'var(--gray-300)'; }}
              />
              {state.field === 'email' && (
                <div className="notice notice-error" style={{ fontSize: 14 }}>{state.error}</div>
              )}
            </div>
          )}

          {/* Step 3: Password */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-600)', marginBottom: 8 }}>
                  3 / {TOTAL_STEPS}
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
                  Choose a password
                </h1>
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 15 }}>
                  At least 10 characters. A short phrase you will remember beats a complicated word you will not.
                </p>
              </div>
              <div>
                <PasswordField
                  name="password"
                  autoComplete="new-password"
                  required
                  autoFocus
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </div>
          )}

          {/* Step 4: Confirm password */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-600)', marginBottom: 8 }}>
                  4 / {TOTAL_STEPS}
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
                  Confirm your password
                </h1>
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 15 }}>
                  Type it again to catch a typo.
                </p>
              </div>
              <div>
                <PasswordField
                  name="confirmPassword"
                  autoComplete="new-password"
                  required
                  autoFocus
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  ariaInvalid={mismatch}
                />
                {mismatch && (
                  <p style={{ color: 'var(--red-600)', fontSize: 14, margin: '8px 0 0' }}>
                    This does not match the password above.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Step 5: Farm name */}
          {step === 4 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-600)', marginBottom: 8 }}>
                  5 / {TOTAL_STEPS}
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
                  What is your farm called?
                </h1>
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 15 }}>
                  This appears on your reports and invoices.
                </p>
              </div>
              <input
                ref={inputRef}
                type="text"
                autoComplete="organization"
                value={farmName}
                onChange={(e) => setFarmName(e.target.value)}
                onKeyDown={(e) => onEnter(e, canNext[4])}
                placeholder="e.g. Kajola Farms"
                style={{
                  fontSize: 20,
                  padding: '14px 0',
                  border: 'none',
                  borderBottom: '2px solid var(--gray-300)',
                  outline: 'none',
                  background: 'transparent',
                  width: '100%',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => { e.target.style.borderBottomColor = 'var(--brand-600)'; }}
                onBlur={(e) => { e.target.style.borderBottomColor = 'var(--gray-300)'; }}
              />
              {state.field === 'farmName' && (
                <div className="notice notice-error" style={{ fontSize: 14 }}>{state.error}</div>
              )}
            </div>
          )}

          {/* Step 6: Module selection */}
          {step === 5 && (
            <form action={action}>
              <input type="hidden" name="fullName" value={fullName} />
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="password" value={password} />
              <input type="hidden" name="farmName" value={farmName} />
              {selectedModules.map((m) => (
                <input key={m} type="hidden" name="modules" value={m} />
              ))}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand-600)', marginBottom: 8 }}>
                    6 / {TOTAL_STEPS}
                  </div>
                  <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
                    What does your farm do?
                  </h1>
                  <p className="muted" style={{ margin: '8px 0 0', fontSize: 15 }}>
                    Pick the modules you need. You can change this later.
                  </p>
                </div>

                {state.error && (
                  <div className="notice notice-error">{state.error}</div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -8 }}>
                  <button
                    type="button"
                    style={{
                      fontSize: 13,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      padding: 0,
                      color: 'var(--brand-600)',
                    }}
                    onClick={selectAll}
                  >
                    Select all
                  </button>
                </div>

                <div style={{ display: 'grid', gap: 10 }}>
                  {AVAILABLE_MODULES.map((mod) => {
                    const checked = mod.alwaysOn || selectedModules.includes(mod.key);
                    const disabled = mod.alwaysOn || mod.comingSoon;
                    return (
                      <label
                        key={mod.key}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 14,
                          padding: '14px 16px',
                          borderRadius: 10,
                          border: `2px solid ${checked ? 'var(--brand-500)' : 'var(--gray-200)'}`,
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
                          style={{ marginTop: 3, accentColor: 'var(--brand-600)', width: 18, height: 18 }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 600 }}>
                            {mod.label}
                            {mod.alwaysOn && (
                              <span className="muted" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
                                Always included
                              </span>
                            )}
                            {mod.comingSoon && (
                              <span style={{
                                fontWeight: 500,
                                fontSize: 11,
                                marginLeft: 8,
                                padding: '2px 8px',
                                borderRadius: 4,
                                background: 'var(--gray-200)',
                                color: 'var(--gray-600)',
                              }}>
                                Coming soon
                              </span>
                            )}
                          </div>
                          <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
                            {mod.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Submit button row for last step */}
                <div style={{
                  display: 'flex',
                  gap: 12,
                  paddingTop: 8,
                  paddingBottom: 16,
                }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={back}
                    style={{ padding: '12px 24px', fontSize: 15 }}
                  >
                    Back
                  </button>
                  <SubmitButton disabled={selectedModules.length === 0} />
                </div>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Footer nav — shown on steps 0-4 (step 5 has its own submit) */}
      {step < 5 && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 24px',
          maxWidth: 528,
          width: '100%',
          margin: '0 auto',
        }}>
          {step > 0 ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={back}
              style={{ padding: '12px 24px', fontSize: 15 }}
            >
              Back
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canNext[step]}
            onClick={next}
            style={{ padding: '12px 32px', fontSize: 15 }}
          >
            Next
          </button>
        </div>
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
      style={{ flex: 1, padding: '12px 24px', fontSize: 15 }}
      disabled={pending || disabled}
    >
      {pending ? 'Setting up your farm...' : 'Create my farm'}
    </button>
  );
}
