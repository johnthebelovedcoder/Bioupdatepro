import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { getContext } from '@/lib/org';
import { getFarms } from '@/lib/masters';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { ActivatePayrollButton } from '@/components/activate-payroll-button';
import { EmployeeOnboarding, type Onboarding } from '@/components/employee-onboarding';
import { EmployeePayForm, type PayComponentOption, type PaySnapshot } from '@/components/employee-pay-form';

export const metadata = { title: 'Employee onboarding — BioAssetPro' };

interface Readiness {
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * One employee's onboarding — Personal, Employment, Compensation, Documents —
 * and, once every step passes, the switch that puts them on payroll.
 */
export default async function EmployeeOnboardingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data: Onboarding & { readiness: Readiness };
  try {
    data = await api<Onboarding & { readiness: Readiness }>(`/masters/employees/${id}/onboarding`);
  } catch (caught) {
    if (caught instanceof ApiError && (caught.status === 404 || caught.status === 403)) notFound();
    throw caught;
  }

  const [context, farms, departments, costCentres, employees, payOptions, snapshot] = await Promise.all([
    getContext(),
    safe(getFarms(), []),
    safe(api<Array<{ id: string; code: string; name: string }>>('/masters/departments'), []),
    safe(api<Array<{ id: string; code: string; name: string }>>('/masters/cost-centres'), []),
    safe(api<Array<{ id: string; employeeNumber: string; name: string }>>('/masters/employees'), []),
    safe(api<PayComponentOption[]>('/masters/salary-components'), []),
    safe(api<PaySnapshot | null>(`/masters/employees/${id}/salary`), null),
  ]);
  const option = (rows: Array<{ id: string; code: string; name: string }>) => rows.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }));

  const realBlockers = data.readiness.blockers.filter((b) => !b.includes('not been activated for payroll'));

  return (
    <>
      <PageHeader
        title={`${data.employee.employeeNumber} — ${data.employee.name}`}
        subtitle={`Joined ${data.employee.employmentDate} · ${data.employee.employmentStatus.toLowerCase()}`}
        actions={<Link href="/staff/employees" className="btn">All employees</Link>}
      />
      <Tabs />
      <div className="stack">
        <Card title="Payroll" subtitle={data.employee.payrollActive ? 'On payroll' : 'Not yet on payroll'}>
          {data.employee.payrollActive ? (
            <p className="faint" style={{ margin: 0 }}>
              Active for payroll.
              {data.readiness.warnings.length > 0 ? ` To clear: ${data.readiness.warnings.join(' ')}` : ''}
            </p>
          ) : realBlockers.length === 0 ? (
            <ActivatePayrollButton employeeId={data.employee.id} />
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {realBlockers.map((b) => (
                <li key={b} className="faint">
                  {b}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <EmployeeOnboarding
          data={data}
          departments={option(departments)}
          costCentres={option(costCentres)}
          branches={option(context.branches)}
          farms={option(farms)}
          managers={employees.map((e) => ({ value: e.id, label: `${e.employeeNumber} — ${e.name}` }))}
          payForm={
            <EmployeePayForm
              employeeId={data.employee.id}
              employeeName={data.employee.name}
              snapshot={snapshot}
              options={payOptions}
              today={data.on}
            />
          }
        />
      </div>
    </>
  );
}

async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}
