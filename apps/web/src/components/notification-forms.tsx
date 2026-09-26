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

/** Which events go out by email and by WhatsApp (AC-015 "approved event"). */
export function NotificationPolicyForm({ events, emailEvents, whatsappEvents, canEdit }: { events: string[]; emailEvents: string[]; whatsappEvents: string[]; canEdit: boolean }) {
  const [state, action] = useActionState(savePolicy, EMPTY);
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <Notices state={state} />
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Event</th>
              <th style={{ width: 90 }}>Email</th>
              <th style={{ width: 90 }}>WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event}>
                <td style={{ textAlign: 'left' }}>{EVENT_LABEL[event] ?? event}</td>
                <td>
                  <input type="checkbox" name="email" value={event} defaultChecked={emailEvents.includes(event)} disabled={!canEdit} aria-label={`${event} by email`} />
                </td>
                <td>
                  <input type="checkbox" name="whatsapp" value={event} defaultChecked={whatsappEvents.includes(event)} disabled={!canEdit} aria-label={`${event} by WhatsApp`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div>
          <Submit label="Save" />
        </div>
      ) : (
        <p className="faint" style={{ margin: 0 }}>An administrator or the CFO chooses these.</p>
      )}
    </form>
  );
}
