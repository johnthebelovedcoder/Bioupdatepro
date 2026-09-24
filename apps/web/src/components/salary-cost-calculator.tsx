'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import {
  calculateSalaryCost,
  type SalaryCostState,
} from '@/app/(app)/finance/payroll/runs/actions';
import { formatNaira } from '@/lib/money';

/**
 * What a salary costs the farm and what the employee takes home, from the
 * same PAYE and statutory engines a payroll run uses. Records nothing — for
 * an offer letter or a raise, before anyone is on the books.
 */
export function SalaryCostCalculator({ employeeCount }: { employeeCount: number }) {
  const [state, formAction] = useActionState<SalaryCostState, FormData>(calculateSalaryCost, {
    error: null,
    result: null,
  });
  const [open, setOpen] = useState(false);
  const result = state.result;

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Salary calculator
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="What would this salary cost?">
        <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          {state.error ? <div className="notice notice-error">{state.error}</div> : null}

          <label className="field">
            Monthly gross (₦)
            <input name="gross" inputMode="decimal" placeholder="0.00" required />
          </label>
          <label className="field">
            Pensionable pay (₦ a month, optional)
            <input name="pensionable" inputMode="decimal" placeholder="Basic + housing + transport" />
            <span className="faint">Leave blank to use the gross.</span>
          </label>
          <label className="field">
            Basic salary (₦ a month, optional)
            <input name="basic" inputMode="decimal" placeholder="The NHF base" />
            <span className="faint">Leave blank to use the pensionable pay.</span>
          </label>

          <label className="row" style={{ gap: 'var(--sp-2)' }}>
            <input type="checkbox" name="pensionEnrolled" defaultChecked /> Enrolled in a pension
          </label>
          <label className="row" style={{ gap: 'var(--sp-2)' }}>
            <input type="checkbox" name="nhfEnrolled" /> Contributes to NHF
          </label>

          <label className="field">
            Headcount
            <input
              name="employeeCount"
              type="number"
              min={1}
              defaultValue={Math.max(1, employeeCount)}
            />
            <span className="faint">
              Pension and ITF only apply above a headcount, so the farm&rsquo;s size matters.
            </span>
          </label>

          <Submit />

          {result ? (
            <div className="card" style={{ padding: 'var(--sp-4)' }}>
              <dl className="stack" style={{ gap: 'var(--sp-2)', margin: 0 }}>
                <Line label="Gross" value={result.grossKobo} />
                <Line label="PAYE" value={result.monthlyPayeKobo} minus />
                <Line label="Employee pension" value={result.employeePensionKobo} minus />
                <Line label="NHF" value={result.nhfKobo} minus />
                <Line label="Take-home" value={result.netPayKobo} strong />
                <hr style={{ margin: 'var(--sp-2) 0' }} />
                <Line label="Employer pension" value={result.employerPensionKobo} />
                <Line label="NSITF" value={result.nsitfKobo} />
                <Line label="ITF" value={result.itfKobo} />
                <Line label="Cost to the farm" value={result.totalEmployerCostKobo} strong />
              </dl>
              <p className="faint" style={{ marginTop: 'var(--sp-3)', fontSize: 13 }}>
                Rules {result.ruleVersion} · effective PAYE rate{' '}
                {Number((Number(result.effectiveRate) * 100).toFixed(2))}%
                {result.minimumWageExempt ? ' · exempt: at or below the minimum wage' : ''}
              </p>
              <ul className="faint" style={{ fontSize: 13, paddingLeft: 18, margin: 0 }}>
                {result.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </form>
      </Sheet>
    </>
  );
}

function Line({
  label,
  value,
  minus,
  strong,
}: {
  label: string;
  value: string;
  minus?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <dt className="muted">{label}</dt>
      <dd className="num" style={{ margin: 0, fontWeight: strong ? 600 : undefined }}>
        {minus ? '− ' : ''}
        {formatNaira(value)}
      </dd>
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Calculating…' : 'Calculate'}
      </button>
    </div>
  );
}
