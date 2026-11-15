import { redirect } from 'next/navigation';
import { getApprovalLadder } from '@/lib/workflow';
import { formatNaira } from '@/lib/money';
import { listInvitations, listPeople } from './actions';
import { InviteWorker } from '@/components/invite-worker';
import { PeopleTable } from '@/components/people-table';
import { Card, PageHeader, Stat } from '@/components/ui';
import { IconUsers } from '@/components/icons';
import { Tabs } from '@/components/tabs';
import { api } from '@/lib/api';
import type { SessionUser } from '@/lib/session';
import type { RoleCatalogueResponse } from '@/lib/role-catalogue';

export const metadata = { title: 'Staff & roles — BioAssetPro' };

export default async function StaffPage() {
  const me = await api<SessionUser>('/auth/me');
  if (!me.roles.some((role) => ['ADMINISTRATOR', 'CFO', 'FARM_MANAGER', 'SYSTEM_ADMIN'].includes(role))) {
    redirect('/staff/employees');
  }

  const [staff, ladder, invitations, access] = await Promise.all([
    listPeople(),
    getApprovalLadder(),
    listInvitations(),
    api<RoleCatalogueResponse>('/auth/role-catalogue'),
  ]);

  const limitByRole = new Map(ladder.map((entry) => [entry.roleCode, entry.maxAmountKobo]));
  const roles = access.roles.map((role) => ({
    ...role,
    // Present in the ladder with a null amount means unlimited; absent
    // means this role has no approval step configured at all.
    approvalLimitKobo: limitByRole.get(role.code),
    hasApprovalStep: limitByRole.has(role.code),
  }));

  const active = staff.filter((person) => person.status === 'ACTIVE');
  const approvers = roles.filter((role) => role.hasApprovalStep);
  const assignableRoleCodes = new Set(access.assignableRoleCodes);

  return (
    <>
      <PageHeader
        title="Staff & roles"
        subtitle="Who can do what, and who did it"
      />

      <Tabs />

      <div className="stack">
        <InviteWorker
          invitations={invitations}
          assignableRoles={roles.filter((role) => assignableRoleCodes.has(role.code))}
        />
        <div className="notice notice-warning">
          User administration is limited to authorized administrators, CFOs, farm managers,
          and system administrators. Administrators may grant any listed role; CFOs may
          grant any role except Administrator; farm managers may grant farm-operation roles;
          system administrators may grant non-finance, non-approval roles. The sidebar
          access matrix controls navigation visibility only; each API action independently
          enforces its required role.
        </div>

        <div className="stat-grid">
          <Stat label="People" value={String(staff.length)} />
          <Stat label="Active" value={String(active.length)} />
          <Stat label="Roles" value={String(roles.length)} />
          <Stat label="Can approve" value={String(approvers.length)} hint="have a limit" />
        </div>

        <Card title="People" padded={false}>
          <PeopleTable
            people={staff}
            currentUserId={me.userId}
            roleOptions={roles}
            assignableRoleCodes={access.assignableRoleCodes}
          />
        </Card>

        <Card title="Roles" subtitle="The intended permission model" padded={false}>
          {roles.map((role) => (
            <div className="list-row" key={role.code}>
              <span className="list-icon">
                <IconUsers size={16} />
              </span>
              <div className="list-main">
                <div className="list-title">{role.name}</div>
                <div className="list-sub">{role.summary}</div>
                {!role.canSeeMoney ? (
                  <div className="faint">Cannot see prices, costs or financial screens</div>
                ) : null}
              </div>
              <div style={{ textAlign: 'right' }}>
                {role.hasApprovalStep ? (
                  <>
                    <div className="num" style={{ fontSize: 13 }}>
                      {role.approvalLimitKobo === null ? 'Unlimited' : formatNaira(role.approvalLimitKobo)}
                    </div>
                    <div className="list-time">provisional limit</div>
                  </>
                ) : (
                  <span className="faint">no approval</span>
                )}
              </div>
            </div>
          ))}
          <div className="card-footer">
            <span className="faint">
              Approval limits shown here are the current configured values, not yet
              confirmed against your organisation&apos;s approved policy. There is no screen
              to change them yet; treat them as provisional.
            </span>
          </div>
        </Card>

        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            Employee records, statutory payroll deductions and running a monthly payroll are
            all supported. Turn on your statutory rates under{' '}
            <a href="/finance/payroll">Money → Payroll setup</a>, add employees under{' '}
            <a href="/staff/employees">People → Employees</a>, then raise a run from{' '}
            <a href="/finance/payroll/runs">Money → Payroll runs</a>. You can change another
            person&apos;s roles or switch off their access from the table above — you cannot do
            this to your own account; ask another administrator instead.
          </p>
        </Card>
      </div>
    </>
  );
}
