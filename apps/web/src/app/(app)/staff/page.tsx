import { ROLE_CATALOGUE } from '@/lib/role-catalogue';
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

export const metadata = { title: 'Staff & roles — BioAssetPro' };

export default async function StaffPage() {
  const [staff, ladder, invitations, me] = await Promise.all([
    listPeople(),
    getApprovalLadder(),
    listInvitations(),
    api<SessionUser>('/auth/me'),
  ]);

  const limitByRole = new Map(ladder.map((entry) => [entry.roleCode, entry.maxAmountKobo]));
  const roles = ROLE_CATALOGUE.map((role) => ({
    ...role,
    // Present in the ladder with a null amount means unlimited; absent
    // means this role has no approval step configured at all.
    approvalLimitKobo: limitByRole.get(role.code),
    hasApprovalStep: limitByRole.has(role.code),
  }));

  const active = staff.filter((person) => person.status === 'ACTIVE');
  const approvers = roles.filter((role) => role.hasApprovalStep);

  return (
    <>
      <PageHeader
        title="Staff & roles"
        subtitle="Who can do what, and who did it"
      />

      <Tabs />

      <div className="stack">
        <InviteWorker invitations={invitations} />
        {/*
          Kept honest rather than confident-sounding: says plainly what is
          and is not yet enforced, where someone administering permissions
          would actually look for it.
        */}
        <div className="notice notice-warning">
          Each person can only see and change records that belong to their own farm. What
          they can open and do is controlled by their role, shown below. A few actions —
          approving certain documents, running payroll, closing a period — are still
          limited to the senior roles only; finer control for those is coming.
        </div>

        <div className="stat-grid">
          <Stat label="People" value={String(staff.length)} />
          <Stat label="Active" value={String(active.length)} />
          <Stat label="Roles" value={String(roles.length)} />
          <Stat label="Can approve" value={String(approvers.length)} hint="have a limit" />
        </div>

        <Card title="People" padded={false}>
          <PeopleTable people={staff} currentUserId={me.userId} />
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
              Nobody can approve their own document — that is enforced everywhere. Screen
              access is enforced for these six roles; the other fourteen roles in your
              organisation&apos;s structure are not fully wired up to screen permissions yet.
              {/*
                Worth keeping honest rather than letting a Naira figure on screen read as
                settled: this is what is actually configured today, not a number taken
                from a confirmed policy. See how far to go with that disclosure without
                lapsing back into build-status language a farm user has no reason to parse.
              */}{' '}
              The amounts shown are what is configured today — starting figures, not yet
              confirmed against your organisation&apos;s real approval policy. There is no
              screen to change them yet; for now, treat them as provisional.
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
