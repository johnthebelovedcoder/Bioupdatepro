'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { createPayrollRun, type FlowState } from '@/app/(app)/finance/payroll/runs/actions';

interface PeriodOption {
  id: string;
  name: string;
}

/**
 * Create a payroll run for one financial period and calculate it straight
 * away — nothing posts here, this only raises the run and sends it for
 * approval once a maker submits it from the list below.
 */
export function CreatePayrollRunForm({ periods }: { periods: PeriodOption[] }) {
  const [state, formAction] = useActionState<FlowState, FormData>(createPayrollRun, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Run payroll
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Run payroll">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="faint">
            One run per period — every active employee's pay is calculated against the rates
            in force as at that period.
          </p>

          {state.error ? <div className="notice notice-error">{state.error}</div> : null}
          {state.message ? <div className="notice notice-success">{state.message}</div> : null}

          <label className="field">
            Period
            <select name="financialPeriodId" defaultValue="" required>
              <option value="" disabled>
                Choose a period
              </option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.name}
                </option>
              ))}
            </select>
          </label>

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
        {pending ? 'Calculating…' : 'Create and calculate'}
      </button>
    </div>
  );
}
