'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sheet } from './sheet';
import { createBenefitInKind, setEmployeePay, type FlowState } from '@/app/(app)/staff/employees/actions';
import { formatNaira } from '@/lib/money';

export interface PayComponentOption {
  code: string;
  name: string;
  basis: string;
  isTaxable: boolean;
  isPensionable: boolean;
  isNhfBase: boolean;
  isBenefitInKind: boolean;
}

export interface PaySnapshot {
  components: Array<{ code: string; name: string; amountKobo: string; isBenefitInKind?: boolean }>;
  grossPayKobo: string;
  pensionableEmolumentsKobo: string;
  nhfBaseKobo: string;
}

/**
 * An employee's pay as it stands today, and the one place to change it.
 *
 * Each change is effective-dated rather than an edit: the old amount is closed
 * the day before the new one starts, which is what lets last March's payslip
 * still come out the same after a rise in April.
 */
export function EmployeePayForm({
  employeeId,
  employeeName,
  snapshot,
  options,
  today,
}: {
  employeeId: string;
  employeeName: string;
  snapshot: PaySnapshot | null;
  options: PayComponentOption[];
  today: string;
}) {
  const [state, formAction] = useActionState<FlowState, FormData>(setEmployeePay, {
    error: null,
    message: null,
  });
  const [benefitState, benefitAction] = useActionState<FlowState, FormData>(createBenefitInKind, {
    error: null,
    message: null,
  });
  const [open, setOpen] = useState(false);
  const [addingBenefit, setAddingBenefit] = useState(false);
  const [code, setCode] = useState(options[0]?.code ?? '');
  const selected = options.find((option) => option.code === code);
  const basis = selected?.basis ?? 'FIXED';
  const current = snapshot?.components.find((component) => component.code === code);

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        {snapshot && BigInt(snapshot.grossPayKobo) > 0n ? formatNaira(snapshot.grossPayKobo) : 'Set pay'}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={`Pay — ${employeeName}`}>
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          {snapshot && snapshot.components.length > 0 ? (
            <div className="table-wrap">
              <table className="data">
                <tbody>
                  {snapshot.components.map((component) => (
                    <tr key={component.code}>
                      <td style={{ textAlign: 'left' }}>{component.name}{component.isBenefitInKind ? ' · in kind' : ''}</td>
                      <td className="num">{formatNaira(component.amountKobo)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ textAlign: 'left', fontWeight: 600 }}>Gross a month</td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {formatNaira(snapshot.grossPayKobo)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: 13, marginTop: 'var(--sp-2)' }}>
                Pensionable {formatNaira(snapshot.pensionableEmolumentsKobo)} · NHF base{' '}
                {formatNaira(snapshot.nhfBaseKobo)}
              </p>
            </div>
          ) : (
            <p className="faint">No pay is set for them yet. Payroll cannot run for them until it is.</p>
          )}

          <form action={formAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
            <input type="hidden" name="employeeId" value={employeeId} />
            <input type="hidden" name="basis" value={basis} />

            {state.error ? <div className="notice notice-error">{state.error}</div> : null}
            {state.message ? <div className="notice notice-success">{state.message}</div> : null}

            <label className="field">
              Component
              <select name="componentCode" value={code} onChange={(e) => setCode(e.target.value)}>
                {options.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </select>
              {selected ? (
                <span className="faint">
                  {[
                    selected.isTaxable ? 'taxable' : 'not taxable',
                    selected.isPensionable ? 'pensionable' : null,
                    selected.isNhfBase ? 'NHF base' : null,
                    selected.isBenefitInKind ? 'benefit in kind (not paid in cash)' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  {current ? ` · currently ${formatNaira(current.amountKobo)}` : ''}
                </span>
              ) : null}
            </label>

            {basis === 'FIXED' ? (
              <label className="field">
                {selected?.isBenefitInKind ? 'Monthly benefit value (₦)' : 'Amount a month (₦)'}
                <input key={code} name="amount" inputMode="decimal" placeholder="0.00" required />
              </label>
            ) : (
              <label className="field">
                Rate (% of base)
                <input key={code} name="rate" inputMode="decimal" placeholder="0" required />
              </label>
            )}

            <label className="field">
              Takes effect from
              <input name="effectiveFrom" type="date" defaultValue={today} required />
            </label>

            <Submit />
          </form>

          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingBenefit((value) => !value)}>
            {addingBenefit ? 'Close benefit setup' : 'Configure a benefit in kind'}
          </button>
          {addingBenefit ? (
            <form action={benefitAction} className="stack" style={{ gap: 'var(--sp-3)', borderTop: '1px solid var(--line)', paddingTop: 'var(--sp-3)' }}>
              <input type="hidden" name="employeeId" value={employeeId} />
              {benefitState.error ? <div className="notice notice-error">{benefitState.error}</div> : null}
              {benefitState.message ? <div className="notice notice-success">{benefitState.message}</div> : null}
              <p className="faint" style={{ margin: 0 }}>Set up the company component once, then assign each employee an effective-dated monthly value above. In-kind value is included in configured tax bases and excluded from cash pay.</p>
              <label className="field">Code<input name="code" placeholder="COMPANY-CAR" required /></label>
              <label className="field">Name<input name="name" placeholder="Company vehicle benefit" required /></label>
              <label className="field"><span><input type="checkbox" name="taxable" defaultChecked /> Taxable for PAYE</span></label>
              <label className="field"><span><input type="checkbox" name="pensionable" /> Include in pension base</span></label>
              <label className="field"><span><input type="checkbox" name="nhfBase" /> Include in NHF base</span></label>
              <Submit label="Add benefit component" pendingLabel="Saving…" />
            </form>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}

function Submit({ label = 'Send for approval', pendingLabel = 'Saving…' }: { label?: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? pendingLabel : label}
      </button>
    </div>
  );
}
