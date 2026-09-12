import { api } from '@/lib/api';
import { getContext } from '@/lib/org';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { MasterForm } from '@/components/master-form';
import { ActivatePayrollButton } from '@/components/activate-payroll-button';
import { IconUsers } from '@/components/icons';
import { Tabs } from '@/components/tabs';
import { createEmployee } from './actions';

export const metadata = { title: 'Employees — BioAssetPro' };

const NIGERIA_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno',
  'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT — Abuja', 'Gombe',
  'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos',
  'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto',
  'Taraba', 'Yobe', 'Zamfara',
];

interface Employee {
  id: string;
  employeeNumber: string;
  name: string;
  employmentStatus: string;
  payrollActive: boolean;
  department: string | null;
  costCentre: string | null;
  taxState: string | null;
}

interface CostCentre {
  id: string;
  code: string;
  name: string;
}

interface PayrollReadiness {
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Employees, and whether payroll can actually run for each one.
 *
 * §7's validation checks — bank details, cost centre, tax state, at least one
 * salary component — are what stand between "the record exists" and "this
 * person can be paid". Showing exactly what is missing here, on the row, is
 * the difference between a blocker and a mystery the first payroll run would
 * otherwise surface with no context at all.
 */
export default async function EmployeesPage() {
  const [employees, costCentres, context] = await Promise.all([
    safe<Employee[]>('/masters/employees', []),
    safe<CostCentre[]>('/masters/cost-centres', []),
    getContext(),
  ]);

  const readiness = await Promise.all(
    employees.map((employee) =>
      safe<PayrollReadiness>(`/masters/employees/${employee.id}/payroll-readiness`, {
        ready: false,
        blockers: [],
        warnings: [],
      }),
    ),
  );

  const branchOptions = context.branches.map((branch) => ({
    value: branch.id,
    label: `${branch.code} — ${branch.name}`,
  }));
  const costCentreOptions = costCentres.map((centre) => ({
    value: centre.id,
    label: `${centre.code} — ${centre.name}`,
  }));
  const stateOptions = [
    { value: '', label: 'Choose a state' },
    ...NIGERIA_STATES.map((state) => ({ value: state, label: state })),
  ];

  return (
    <>
      <PageHeader title="Employees" subtitle="Who is on payroll, and what still blocks it" />

      <div className="stack">
        <Tabs />

        <MasterForm
          title="Add an employee"
          subtitle="Bank details, cost centre and tax state are all payroll needs before anyone can be paid"
          submitLabel="Add employee"
          action={createEmployee}
          fields={[
            { name: 'employeeNumber', label: 'Employee number', hint: 'EMP-001.', required: true, half: true },
            { name: 'employmentDate', label: 'Employment date', type: 'date', required: true, half: true },
            { name: 'firstName', label: 'First name', required: true, half: true },
            { name: 'surname', label: 'Surname', required: true, half: true },
            {
              name: 'branchId',
              label: 'Branch',
              options: branchOptions.length > 0 ? branchOptions : [{ value: '', label: 'No branches found' }],
              required: true,
              half: true,
            },
            {
              name: 'costCentreId',
              label: 'Cost centre',
              hint: 'Payroll will not post without one.',
              options:
                costCentreOptions.length > 0
                  ? costCentreOptions
                  : [{ value: '', label: 'No cost centres found' }],
              required: true,
              half: true,
            },
            { name: 'designation', label: 'Designation', hint: 'Farm attendant, supervisor.', half: true },
            { name: 'basicPay', label: 'Basic pay (₦/month)', type: 'number', half: true },
            { name: 'bankName', label: 'Bank', required: true, half: true },
            { name: 'accountNumber', label: 'Account number', required: true, half: true },
            { name: 'accountName', label: 'Account name', hint: 'Defaults to their own name if left blank.', half: true },
            { name: 'taxState', label: 'Tax state', hint: 'PAYE is remitted per state of residence.', options: stateOptions, required: true, half: true },
            { name: 'tin', label: 'TIN', half: true },
            { name: 'pensionEnrolled', label: 'Enrolled in pension', type: 'checkbox' },
            { name: 'pensionRsaNumber', label: 'Pension RSA number', half: true },
            { name: 'pensionAdministrator', label: 'Pension administrator (PFA)', half: true },
            { name: 'nhfEnrolled', label: 'Enrolled in NHF', type: 'checkbox' },
            { name: 'nhfNumber', label: 'NHF number' },
          ]}
        />

        <Card title={`${employees.length} ${employees.length === 1 ? 'employee' : 'employees'}`} padded={false}>
          {employees.length === 0 ? (
            <EmptyState
              icon={<IconUsers size={22} />}
              title="No employees yet"
              body="Add the first one above. Payroll cannot run for anyone until their record, bank details and a salary exist."
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Number</th>
                    <th>Name</th>
                    <th style={{ width: 110 }}>Cost centre</th>
                    <th style={{ width: 120 }}>Tax state</th>
                    <th style={{ width: 110 }}>Payroll</th>
                    <th>Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee, index) => {
                    const status = readiness[index]!;
                    return (
                      <tr key={employee.id}>
                        <td className="num strong" style={{ textAlign: 'left' }}>
                          {employee.employeeNumber}
                        </td>
                        <td>{employee.name}</td>
                        <td className="faint">{employee.costCentre ?? '—'}</td>
                        <td className="faint">{employee.taxState ?? '—'}</td>
                        <td>
                          <span className={`badge ${employee.payrollActive ? 'badge-success' : ''}`}>
                            {employee.payrollActive ? 'active' : 'not active'}
                          </span>
                        </td>
                        <td style={{ minWidth: 220 }}>
                          {employee.payrollActive ? (
                            <span className="faint">Ready to run.</span>
                          ) : status.ready ? (
                            <ActivatePayrollButton employeeId={employee.id} />
                          ) : (
                            <span className="faint" style={{ whiteSpace: 'normal' }}>
                              {status.blockers[0] ?? 'Not ready yet.'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

async function safe<T>(path: string, fallback: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch {
    return fallback;
  }
}
