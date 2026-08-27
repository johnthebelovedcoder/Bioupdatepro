'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useState } from 'react';
import { Card } from './ui';
import {
  activatePayroll,
  type ActivatePayrollState,
} from '@/app/(app)/finance/payroll/actions';

export function ActivatePayrollForm() {
  const [state, formAction] = useActionState<ActivatePayrollState, FormData>(activatePayroll, {
    error: null,
    message: null,
  });
  const [nhf, setNhf] = useState(true);

  return (
    <Card
      title="Activate payroll"
      subtitle="One confirm turns on the current statutory rates for this company"
    >
      <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}
        {state.message ? <div className="notice notice-success">{state.message}</div> : null}

        <p style={{ fontSize: 14, lineHeight: 1.6 }}>
          This applies the Nigeria Tax Act 2025 PAYE bands, rent and pension reliefs, and the
          pension, NHF, NSITF and ITF rates effective 1 January 2026 — the same figures every
          payslip in this application is calculated against, verified against the client&rsquo;s
          own workbook. There is nothing to type in: these are statutory rates, not company
          preferences.
        </p>

        <label className="field row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
          <input
            type="checkbox"
            name="nhfCompanyParticipation"
            checked={nhf}
            style={{ width: 'auto', minHeight: 0 }}
            onChange={(event) => setNhf(event.target.checked)}
          />
          Participate in the National Housing Fund
          <span className="faint">
            (opt-in for the private sector — only staff who enrol individually are deducted)
          </span>
        </label>

        <Submit />
      </form>
    </Card>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Activating…' : 'Activate payroll'}
      </button>
    </div>
  );
}
