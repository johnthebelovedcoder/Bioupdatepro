import { getRoles, getStaff } from '@/lib/demo-trade';
import { listInvitations } from './actions';
import { InviteWorker } from '@/components/invite-worker';
import { formatDate } from '@/lib/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { IconUsers } from '@/components/icons';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Staff & roles — BioAssetPro' };

export default async function StaffPage() {
  const [staff, roles, invitations] = await Promise.all([
    getStaff(),
    getRoles(),
    listInvitations(),
  ]);

  const active = staff.filter((person) => person.status === 'ACTIVE');
  const approvers = roles.filter((role) => role.approvalLimit !== null);

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
          The most important thing on this page is not a figure — it is that
          authorisation does not exist yet. Saying so here, where permissions are
          administered, is where someone would actually look.
        */}
        <div className="notice notice-error">
          Company scoping IS enforced — a signed-in user can only reach their own farm&apos;s
          data, and a record belonging to another farm returns nothing. What is NOT yet
          enforced is the ladder below: any signed-in user can still reach any screen within
          their own farm, whatever their role.
        </div>

        <div className="stat-grid">
          <Stat label="People" value={String(staff.length)} />
          <Stat label="Active" value={String(active.length)} />
          <Stat label="Roles" value={String(roles.length)} />
          <Stat label="Can approve" value={String(approvers.length)} hint="have a limit" />
        </div>

        <Card title="People" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: 250 }}>Email</th>
                  <th style={{ width: 180 }}>Role</th>
                  <th style={{ width: 130 }}>Farm</th>
                  <th style={{ width: 110 }}>Last seen</th>
                  <th style={{ width: 100 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((person) => (
                  <tr key={person.id}>
                    <td className="strong">{person.name}</td>
                    <td className="num faint" style={{ textAlign: 'left' }}>
                      {person.email}
                    </td>
                    <td>{person.role}</td>
                    <td className="faint">{person.farm}</td>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(person.lastSeen)}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          person.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'
                        }`}
                      >
                        {person.status.toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                {role.approvalLimit ? (
                  <>
                    <div className="num" style={{ fontSize: 13 }}>
                      {role.approvalLimit}
                    </div>
                    <div className="list-time">approval limit</div>
                  </>
                ) : (
                  <span className="faint">no approval</span>
                )}
              </div>
            </div>
          ))}
          <div className="card-footer">
            <span className="faint">
              The approval ladder is enforced by the workflow engine, which is built and
              tested — a maker cannot approve their own document. What is missing is the
              guard that decides which screens a role may open at all.
            </span>
          </div>
        </Card>

        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            Employee records and payroll — including PAYE and statutory deductions — already
            exist in the backend and are tested. User management, roles and server-side
            permission checks do not.
          </p>
        </Card>
      </div>
    </>
  );
}
