'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { signOffRelease, type FlowState } from '@/app/(app)/ledger/controls/actions';

/**
 * Sign off a release against the checks as they stand right now. With any
 * check failing, the written acknowledgement is required — a sign-off is a
 * decision made in the open, not a silent pass.
 */
export function ReleaseSignOffForm({ exceptions }: { exceptions: number }) {
  const [state, formAction] = useActionState<FlowState, FormData>(signOffRelease, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Sign off a release
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Sign off a release">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          {exceptions > 0 ? (
            <div className="notice notice-warning">
              {exceptions} check{exceptions === 1 ? ' is' : 's are'} not clean. Signing off anyway
              needs a written reason, and that reason is kept with the sign-off.
            </div>
          ) : (
            <p className="faint">Every check passes. This records who released, and when.</p>
          )}

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Release
            <input name="releaseLabel" placeholder='e.g. "March 2026 close"' required />
          </label>

          {exceptions > 0 ? (
            <label className="field">
              Why release with exceptions
              <textarea name="exceptionsAcknowledged" rows={3} required />
            </label>
          ) : null}

          <Submit />
        </form>
      </Sheet>
    </>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Signing off…' : 'Sign off'}
      </button>
    </div>
  );
}
