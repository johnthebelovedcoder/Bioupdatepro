'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { activateEmployeePayroll, type FlowState } from '@/app/(app)/staff/employees/actions';

const EMPTY: FlowState = { error: null, message: null };

/** Turn payroll on for one employee, once every §7 blocker is clear. */
export function ActivatePayrollButton({ employeeId }: { employeeId: string }) {
  const [state, formAction] = useActionState<FlowState, FormData>(activateEmployeePayroll, EMPTY);

  return (
    <form action={formAction}>
      <input type="hidden" name="employeeId" value={employeeId} />
      <Pending />
      {state.error ? (
        <div className="faint" style={{ color: 'var(--error-700)', whiteSpace: 'normal' }}>
          {state.error}
        </div>
      ) : null}
      {state.message ? <div className="faint">{state.message}</div> : null}
    </form>
  );
}

function Pending() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Activating…' : 'Activate for payroll'}
    </button>
  );
}
