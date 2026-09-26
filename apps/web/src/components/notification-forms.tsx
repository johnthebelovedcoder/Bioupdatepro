'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { savePolicy, sendCode, setConsent, verifyCode, type NoticeState } from '@/app/(app)/notifications/actions';

const EMPTY: NoticeState = { error: null, message: null };

const EVENT_LABEL: Record<string, string> = {
  SUBMISSION: 'Something is waiting for my approval',
  APPROVAL: 'My document was approved',
  REJECTION: 'My document was rejected',
  RETURN: 'My document was sent back',
  ESCALATION: 'An approval was escalated',
  REMINDER: 'Reminder of something waiting',
  CANCELLATION: 'A document was cancelled',
  POSTING: 'My document was posted',
};

function Notices({ state }: { state: NoticeState }) {
  return (
    <>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
    </>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Working…' : label}
    </button>
  );
}

export interface MyNotifications {
  whatsappAvailable: boolean;
  whatsappNumber: string | null;
  verified: boolean;
  codePending: boolean;
  consented: boolean;
  consentedAt: string | null;
  emailEvents: string[];
  whatsappEvents: string[];
}

/** My WhatsApp: the number, its code, and my consent — which only I can give or take back. */
export function WhatsAppSettings({ mine }: { mine: MyNotifications }) {
  const [numberState, numberAction] = useActionState(sendCode, EMPTY);
  const [codeState, codeAction] = useActionState(verifyCode, EMPTY);
  const [pending, startTransition] = useTransition();
  const [consentState, setConsentState] = useState<NoticeState>(EMPTY);
  const router = useRouter();

  if (!mine.whatsappAvailable) {
    return <p className="faint" style={{ margin: 0 }}>WhatsApp is not set up for this farm yet. Notices come in the app and by email.</p>;
  }

  const toggle = (consent: boolean) =>
    startTransition(async () => {
      const result = await setConsent(consent);
      setConsentState(result);
      if (!result.error) router.refresh();
    });

  return (
    <div className="stack" style={{ gap: 'var(--sp-4)' }}>
      <form action={numberAction} className="stack" style={{ gap: 'var(--sp-2)' }}>
        <Notices state={numberState} />
        <label className="field">
          WhatsApp number
          <input name="number" inputMode="tel" defaultValue={mine.whatsappNumber ?? ''} placeholder="0803 123 4567" required />
          <span className="faint">
            {mine.whatsappNumber ? (mine.verified ? 'Verified.' : 'Not verified yet.') : 'We send a code to it to check it is yours.'} Changing it
            needs a new code and your agreement again.
          </span>
        </label>
        <div>
          <Submit label={mine.whatsappNumber ? 'Send a new code' : 'Send a code'} />
        </div>
      </form>

      {mine.whatsappNumber && !mine.verified ? (
        <form action={codeAction} className="stack" style={{ gap: 'var(--sp-2)' }}>
          <Notices state={codeState} />
          <label className="field">
            The 6-digit code
            <input name="code" inputMode="numeric" maxLength={6} required />
          </label>
          <div>
            <Submit label="Verify" />
          </div>
        </form>
      ) : null}

      {mine.verified ? (
        <div className="stack" style={{ gap: 'var(--sp-2)' }}>
          <Notices state={consentState} />
          {mine.consented ? (
            <>
              <p style={{ margin: 0 }}>
                You agreed to approval notices on WhatsApp{mine.consentedAt ? ` on ${mine.consentedAt.slice(0, 10)}` : ''}.
              </p>
              <div>
                <button type="button" className="btn" disabled={pending} onClick={() => toggle(false)}>
                  Stop WhatsApp messages
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ margin: 0 }}>
                We only message you on WhatsApp if you agree, and only about the events your farm has approved for WhatsApp. You can stop at any
                time.
              </p>
              <div>
                <button type="button" className="btn btn-primary" disabled={pending} onClick={() => toggle(true)}>
                  I agree to WhatsApp messages
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Events grouped as the person reads them: what needs them, and news of their own documents. */
const GROUPS: Array<{ title: string; events: Array<{ key: string; label: string; hint: string }> }> = [
  {
    title: 'Needs you',
    events: [
      { key: 'SUBMISSION', label: 'Something is waiting for my approval', hint: 'A document reached your approval level' },
      { key: 'REMINDER', label: 'Reminder of something waiting', hint: 'An approval has waited longer than it should' },
      { key: 'ESCALATION', label: 'An approval was escalated', hint: 'It went unanswered and moved up to you' },
    ],
  },
  {
    title: 'About your documents',
    events: [
      { key: 'APPROVAL', label: 'Approved', hint: 'Your document was approved' },
      { key: 'REJECTION', label: 'Rejected', hint: 'Your document was rejected, with the reason' },
      { key: 'RETURN', label: 'Sent back', hint: 'Your document came back for a change' },
      { key: 'POSTING', label: 'Posted', hint: 'Your document reached the ledger' },
      { key: 'CANCELLATION', label: 'Cancelled', hint: 'A document was cancelled' },
    ],
  },
];

function Toggle({ name, value, checked, disabled, label }: { name: string; value: string; checked: boolean; disabled: boolean; label: string }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" name={name} value={value} defaultChecked={checked} disabled={disabled} aria-label={label} />
      <span className="switch-track" />
    </label>
  );
}

/** Which events go out by email and by WhatsApp (AC-015 "approved event"). In the app, always. */
export function NotificationPolicyForm({
  events,
  emailEvents,
  whatsappEvents,
  canEdit,
  whatsappAvailable = false,
}: {
  events: string[];
  emailEvents: string[];
  whatsappEvents: string[];
  canEdit: boolean;
  whatsappAvailable?: boolean;
}) {
  const [state, action] = useActionState(savePolicy, EMPTY);
  const known = new Set(events);
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <Notices state={state} />
      <table className="pref-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>In app</th>
            <th>Email</th>
            <th>WhatsApp</th>
          </tr>
        </thead>
        {GROUPS.map((group) => (
          <tbody key={group.title}>
            <tr className="pref-group">
              <td colSpan={4}>{group.title}</td>
            </tr>
            {group.events
              .filter((e) => known.has(e.key))
              .map((e) => (
                <tr key={e.key} className="pref-row">
                  <td>
                    <div className="pref-label">{e.label}</div>
                    <div className="pref-hint">{e.hint}</div>
                  </td>
                  <td>
                    <span className="pref-always">Always</span>
                  </td>
                  <td>
                    <Toggle name="email" value={e.key} checked={emailEvents.includes(e.key)} disabled={!canEdit} label={`${e.label} by email`} />
                  </td>
                  <td>
                    <Toggle
                      name="whatsapp"
                      value={e.key}
                      checked={whatsappEvents.includes(e.key)}
                      disabled={!canEdit}
                      label={`${e.label} by WhatsApp${whatsappAvailable ? '' : ' (once WhatsApp is set up)'}`}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        ))}
      </table>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <span className="faint" style={{ fontSize: 13 }}>
          {canEdit
            ? 'These apply to everyone on the farm. WhatsApp also needs each person to verify their number and agree.'
            : 'These apply to everyone on the farm; an administrator or the CFO chooses them.'}
        </span>
        {canEdit ? <Submit label="Save changes" /> : null}
      </div>
    </form>
  );
}
