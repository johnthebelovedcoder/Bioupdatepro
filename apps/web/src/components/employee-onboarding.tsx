'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  decidePay,
  recordCheck,
  recordJobChange,
  saveDetails,
  type StepState,
} from '@/app/(app)/staff/employees/[id]/actions';
import { formatNaira } from '@/lib/money';

export interface Onboarding {
  on: string;
  employee: {
    id: string;
    employeeNumber: string;
    name: string;
    payrollActive: boolean;
    employmentStatus: string;
    employmentType: string;
    employmentDate: string;
    pensionEnrolled: boolean;
    nhfEnrolled: boolean;
    dateOfBirth: string | null;
    details: Record<string, string | null>;
  };
  steps: Array<{ key: string; title: string; complete: boolean; missing: string[] }>;
  allComplete: boolean;
  assignments: Array<{
    id: string;
    effectiveFrom: string;
    current: boolean;
    employmentStatus: string;
    employmentType: string;
    department: string | null;
    costCentre: string | null;
    branch: string | null;
    farm: string | null;
    reportingManager: string | null;
    designation: string | null;
    grade: string | null;
    shift: string | null;
    reason: string | null;
    recordedBy: string | null;
  }>;
  pay: Array<{
    id: string;
    code: string;
    name: string;
    amountKobo: string | null;
    rate: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: string;
    preparedBy: string | null;
    approvedBy: string | null;
    inForce: boolean;
  }>;
  checks: Array<{
    code: string;
    label: string;
    required: boolean;
    status: string;
    reference: string | null;
    note: string | null;
    verifiedBy: string | null;
    verifiedAt: string | null;
  }>;
  documentPack: { answered: number; total: number };
}

type Option = { value: string; label: string };

const EMPTY: StepState = { error: null, message: null };
const STATUSES = ['PROBATION', 'ACTIVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED', 'RETIRED'];
const TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'CASUAL', 'INTERN'];
const words = (value: string) => value.toLowerCase().replace(/_/g, ' ');

/**
 * Onboarding in the workbook's four steps — Personal, Employment,
 * Compensation, Documents — each marked done only when Employee_Master_Checks
 * would pass it, with what is missing said plainly.
 */
export function EmployeeOnboarding({
  data,
  departments,
  costCentres,
  branches,
  farms,
  managers,
  payForm,
}: {
  data: Onboarding;
  departments: Option[];
  costCentres: Option[];
  branches: Option[];
  farms: Option[];
  managers: Option[];
  payForm: React.ReactNode;
}) {
  const firstOpen = data.steps.findIndex((step) => !step.complete);
  const [active, setActive] = useState(firstOpen === -1 ? 0 : firstOpen);
  const step = data.steps[active]!;

  return (
    <div className="stack">
      <ol className="row" style={{ gap: 'var(--sp-2)', listStyle: 'none', padding: 0, margin: 0, flexWrap: 'wrap' }}>
        {data.steps.map((s, index) => (
          <li key={s.key} style={{ flex: '1 1 160px' }}>
            <button
              type="button"
              onClick={() => setActive(index)}
              className={`btn ${index === active ? 'btn-primary' : ''}`}
              style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}
              aria-current={index === active ? 'step' : undefined}
            >
              <span aria-hidden>{s.complete ? '✓' : index + 1}</span>
              {s.title}
              {!s.complete ? <span className="badge badge-warning" style={{ marginLeft: 'auto' }}>{s.missing.length}</span> : null}
            </button>
          </li>
        ))}
      </ol>

      {step.missing.length > 0 ? (
        <div className="notice notice-warning">
          <strong>Still needed:</strong> {step.missing.join('; ')}.
        </div>
      ) : (
        <div className="notice notice-success">{step.title} is complete.</div>
      )}

      {step.key === 'PERSONAL' ? <PersonalStep data={data} /> : null}
      {step.key === 'EMPLOYMENT' ? (
        <EmploymentStep data={data} departments={departments} costCentres={costCentres} branches={branches} farms={farms} managers={managers} />
      ) : null}
      {step.key === 'COMPENSATION' ? <CompensationStep data={data} payForm={payForm} /> : null}
      {step.key === 'DOCUMENTS' ? <DocumentsStep data={data} /> : null}

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="btn" disabled={active === 0} onClick={() => setActive(active - 1)}>
          Back
        </button>
        <button type="button" className="btn" disabled={active === data.steps.length - 1} onClick={() => setActive(active + 1)}>
          Next step
        </button>
      </div>
    </div>
  );
}

function Notices({ state }: { state: StepState }) {
  return (
    <>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
    </>
  );
}

function Field({ name, label, value, type = 'text' }: { name: string; label: string; value?: string | null; type?: string }) {
  return (
    <label className="field">
      {label}
      <input name={name} type={type} defaultValue={value ?? ''} />
    </label>
  );
}

function PersonalStep({ data }: { data: Onboarding }) {
  const [state, action] = useActionState(saveDetails, EMPTY);
  const d = data.employee.details;
  return (
    <form action={action} className="card stack" style={{ padding: 'var(--sp-5)', gap: 'var(--sp-4)' }}>
      <input type="hidden" name="employeeId" value={data.employee.id} />
      <Notices state={state} />
      <h3 style={{ margin: 0 }}>Personal</h3>
      <div className="grid-auto">
        <Field name="title" label="Title" value={d.title} />
        <Field name="firstName" label="First name" value={d.firstName} />
        <Field name="middleName" label="Middle name" value={d.middleName} />
        <Field name="surname" label="Surname" value={d.surname} />
        <Field name="gender" label="Gender" value={d.gender} />
        <Field name="dateOfBirth" label="Date of birth" type="date" value={data.employee.dateOfBirth} />
        <Field name="nationality" label="Nationality" value={d.nationality} />
        <Field name="stateOfOrigin" label="State of origin" value={d.stateOfOrigin} />
        <Field name="phone" label="Phone" value={d.phone} />
        <Field name="email" label="Email" type="email" value={d.email} />
      </div>
      <Field name="address" label="Address" value={d.address} />

      <h3 style={{ margin: 0 }}>Next of kin</h3>
      <div className="grid-auto">
        <Field name="nextOfKinName" label="Name" value={d.nextOfKinName} />
        <Field name="nextOfKinRelationship" label="Relationship" value={d.nextOfKinRelationship} />
        <Field name="nextOfKinPhone" label="Phone" value={d.nextOfKinPhone} />
        <Field name="nextOfKinAddress" label="Address" value={d.nextOfKinAddress} />
      </div>

      <h3 style={{ margin: 0 }}>Bank and statutory</h3>
      <p className="faint" style={{ margin: 0 }}>Changing a bank account, TIN, RSA or NHF number clears its verification until someone checks it again.</p>
      <div className="grid-auto">
        <Field name="bankName" label="Bank" value={d.bankName} />
        <Field name="accountNumber" label="Account number" value={d.accountNumber} />
        <Field name="accountName" label="Account name" value={d.accountName} />
        <Field name="taxState" label="Tax state" value={d.taxState} />
        <Field name="tin" label="TIN" value={d.tin} />
        <Field name="pensionRsaNumber" label="Pension RSA number" value={d.pensionRsaNumber} />
        <Field name="pensionAdministrator" label="Pension administrator (PFA)" value={d.pensionAdministrator} />
        <Field name="nhfNumber" label="NHF number" value={d.nhfNumber} />
      </div>
      <div className="row" style={{ gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" name="pensionEnrolled" defaultChecked={data.employee.pensionEnrolled} /> Enrolled in pension
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" name="nhfEnrolled" defaultChecked={data.employee.nhfEnrolled} /> Enrolled in NHF
        </label>
      </div>
      <Submit label="Save details" />
    </form>
  );
}

function Select({ name, label, options, value, blank }: { name: string; label: string; options: Option[]; value?: string; blank?: string }) {
  return (
    <label className="field">
      {label}
      <select name={name} defaultValue={value ?? ''}>
        {blank !== undefined ? <option value="">{blank}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmploymentStep({
  data,
  departments,
  costCentres,
  branches,
  farms,
  managers,
}: {
  data: Onboarding;
  departments: Option[];
  costCentres: Option[];
  branches: Option[];
  farms: Option[];
  managers: Option[];
}) {
  const [state, action] = useActionState(recordJobChange, EMPTY);
  const current = data.assignments.find((a) => a.current);
  const byCode = (options: Option[], code: string | null) => options.find((o) => o.label.startsWith(`${code} `))?.value;
  return (
    <div className="stack">
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="data wide">
            <thead>
              <tr>
                <th style={{ width: 110 }}>From</th>
                <th>Job</th>
                <th style={{ width: 120 }}>Status</th>
                <th>Where</th>
                <th>Reports to</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {data.assignments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="faint">No employment recorded yet.</td>
                </tr>
              ) : (
                data.assignments.map((a) => (
                  <tr key={a.id}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {a.effectiveFrom}
                      {a.current ? <span className="badge badge-success" style={{ marginLeft: 6 }}>now</span> : null}
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      {a.designation ?? '—'}
                      {a.grade ? <span className="faint"> · grade {a.grade}</span> : null}
                      <div className="faint">{words(a.employmentType)}{a.shift ? ` · ${a.shift}` : ''}</div>
                    </td>
                    <td>{words(a.employmentStatus)}</td>
                    <td className="faint" style={{ textAlign: 'left' }}>
                      {[a.branch, a.farm, a.department, a.costCentre].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="faint">{a.reportingManager ?? '—'}</td>
                    <td className="faint" style={{ textAlign: 'left' }}>
                      {a.reason}
                      {a.recordedBy ? ` · ${a.recordedBy}` : ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <form action={action} className="card stack" style={{ padding: 'var(--sp-5)', gap: 'var(--sp-4)' }}>
        <input type="hidden" name="employeeId" value={data.employee.id} />
        <h3 style={{ margin: 0 }}>Record a job change</h3>
        <p className="faint" style={{ margin: 0 }}>
          Promotion, transfer, confirmation, suspension or exit — from the day it takes effect. History is kept; nothing is overwritten.
        </p>
        <Notices state={state} />
        <div className="grid-auto">
          <Field name="effectiveFrom" label="Takes effect" type="date" value={data.on} />
          <Select name="employmentStatus" label="Status" options={STATUSES.map((s) => ({ value: s, label: words(s) }))} value={current?.employmentStatus ?? data.employee.employmentStatus} />
          <Select name="employmentType" label="Type" options={TYPES.map((t) => ({ value: t, label: words(t) }))} value={current?.employmentType ?? data.employee.employmentType} />
          <Field name="designation" label="Designation" value={current?.designation} />
          <Field name="grade" label="Grade" value={current?.grade} />
          <Field name="shift" label="Shift" value={current?.shift} />
          <Select name="branchId" label="Branch" options={branches} value={byCode(branches, current?.branch ?? null)} blank="—" />
          <Select name="farmId" label="Farm" options={farms} value={byCode(farms, current?.farm ?? null)} blank="—" />
          <Select name="departmentId" label="Department" options={departments} value={byCode(departments, current?.department ?? null)} blank="—" />
          <Select name="costCentreId" label="Cost centre" options={costCentres} value={byCode(costCentres, current?.costCentre ?? null)} blank="—" />
          <Select
            name="reportingManagerId"
            label="Reports to"
            options={managers.filter((m) => m.value !== data.employee.id)}
            value={byCode(managers, current?.reportingManager ?? null)}
            blank="—"
          />
        </div>
        <Field name="reason" label="Why" />
        <Submit label="Record change" />
      </form>
    </div>
  );
}

function CompensationStep({ data, payForm }: { data: Onboarding; payForm: React.ReactNode }) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<StepState>(EMPTY);
  const router = useRouter();
  const decide = (rowId: string, approve: boolean) => {
    const reason = approve ? undefined : window.prompt('Why is this pay change rejected?') ?? '';
    if (!approve && !reason?.trim()) return;
    startTransition(async () => {
      const result = await decidePay(data.employee.id, rowId, approve, reason);
      setOutcome(result);
      if (!result.error) router.refresh();
    });
  };
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <p className="faint" style={{ margin: 0 }}>
          A pay change is prepared by one person and approved by another; only approved pay reaches payroll.
        </p>
        {payForm}
      </div>
      <Notices state={outcome} />
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="data wide">
            <thead>
              <tr>
                <th>Component</th>
                <th className="right" style={{ width: 140 }}>A month</th>
                <th style={{ width: 200 }}>Period</th>
                <th>Prepared / approved</th>
                <th style={{ width: 200 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.pay.length === 0 ? (
                <tr>
                  <td colSpan={5} className="faint">No pay set yet.</td>
                </tr>
              ) : (
                data.pay.map((p) => (
                  <tr key={p.id}>
                    <td style={{ textAlign: 'left' }}>
                      {p.name}
                      {p.inForce ? <span className="badge badge-success" style={{ marginLeft: 6 }}>in force</span> : null}
                    </td>
                    <td className="num right">{p.amountKobo !== null ? formatNaira(p.amountKobo) : `${Number(p.rate ?? 0) * 100}%`}</td>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {p.effectiveFrom} → {p.effectiveTo ?? 'open'}
                    </td>
                    <td className="faint" style={{ textAlign: 'left' }}>
                      {p.preparedBy ?? '—'}
                      {p.approvedBy ? ` / ${p.approvedBy}` : ''}
                    </td>
                    <td>
                      {p.status === 'PENDING' ? (
                        <span className="row" style={{ gap: 'var(--sp-2)' }}>
                          <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => decide(p.id, true)}>
                            Approve
                          </button>
                          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => decide(p.id, false)}>
                            Reject
                          </button>
                        </span>
                      ) : (
                        <span className={`badge ${p.status === 'APPROVED' ? 'badge-success' : 'badge-danger'}`}>{words(p.status)}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DocumentsStep({ data }: { data: Onboarding }) {
  return (
    <div className="stack">
      <p className="faint" style={{ margin: 0 }}>
        {data.documentPack.answered} of {data.documentPack.total} checks answered. Required checks must be verified; the rest may be marked not
        applicable with a reason.
      </p>
      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="data wide">
            <thead>
              <tr>
                <th>Check</th>
                <th style={{ width: 150 }}>Status</th>
                <th>Evidence</th>
                <th style={{ width: 420 }}>Record</th>
              </tr>
            </thead>
            <tbody>
              {data.checks.map((check) => (
                <CheckRow key={check.code} employeeId={data.employee.id} check={check} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CheckRow({ employeeId, check }: { employeeId: string; check: Onboarding['checks'][number] }) {
  const [state, action] = useActionState(recordCheck, EMPTY);
  const tone = check.status === 'VERIFIED' ? 'badge-success' : check.status === 'NOT_APPLICABLE' ? '' : 'badge-warning';
  return (
    <tr>
      <td style={{ textAlign: 'left' }}>
        {check.label}
        {check.required ? <span className="faint"> · required</span> : null}
      </td>
      <td>
        <span className={`badge ${tone}`}>{words(check.status)}</span>
      </td>
      <td className="faint" style={{ textAlign: 'left' }}>
        {check.reference ?? check.note ?? '—'}
        {check.verifiedBy ? ` · ${check.verifiedBy}, ${check.verifiedAt}` : ''}
      </td>
      <td>
        <form action={action} className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <input type="hidden" name="employeeId" value={employeeId} />
          <input type="hidden" name="checkType" value={check.code} />
          <select name="status" defaultValue="VERIFIED" aria-label="Status">
            <option value="VERIFIED">Verified</option>
            {!check.required ? <option value="NOT_APPLICABLE">Not applicable</option> : null}
            <option value="OUTSTANDING">Outstanding</option>
          </select>
          <input name="reference" placeholder="What was seen" aria-label="Evidence" style={{ flex: '1 1 120px' }} />
          <input name="note" placeholder="Note" aria-label="Note" style={{ flex: '1 1 100px' }} />
          <Submit label="Save" small />
          {state.error ? <span style={{ color: 'var(--error-700)', fontSize: 12, width: '100%' }}>{state.error}</span> : null}
        </form>
      </td>
    </tr>
  );
}

function Submit({ label, small }: { label: string; small?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div>
      <button type="submit" className={`btn btn-primary ${small ? 'btn-sm' : ''}`} disabled={pending}>
        {pending ? 'Saving…' : label}
      </button>
    </div>
  );
}
