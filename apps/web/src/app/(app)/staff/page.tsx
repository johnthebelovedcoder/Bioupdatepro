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
          This used to say the ladder below was not enforced at all. It now is,
          for both layers — but not evenly, and saying so here, where
          permissions are administered, is where someone would actually look
          for the honest boundary rather than the confident-sounding one.
        */}
        <div className="notice notice-warning">
          Company scoping IS enforced — a signed-in user can only reach their own farm&apos;s
          data, and a record belonging to another farm returns nothing. Screen access IS now
          enforced too, for every role listed below: signing in as a role the sidebar has no
          entry for redirects to an explanation rather than a blank page, and the API refuses
          the write actions that role&apos;s own boundary excludes. What is NOT yet enforced
          is finer than that — a handful of actions (approving a workflow document, running
          payroll, closing a period) are still gated by the original six roles only, because
          extending them safely needs the approval engine to check document type, not just
          role, and that is a deeper change than adding a role to a list.
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
              The approval ladder is enforced by the workflow engine, which is built and
              tested — a maker cannot approve their own document. The guard that decides
              which screens a role may open now exists too, for these six roles and the
              fourteen more the client&apos;s own RACI sheet names — see the notice above
              for what it still does not reach.
              {/*
                The amounts themselves are a separate fact from the enforcement working —
                and the one most likely to be read as settled just because it is written in
                Naira on a screen. It is not: it is the implementing consultant's own
                illustrative table, not a figure taken from the client's specification. The
                engine enforces whatever this table says correctly; what it says has not been
                confirmed.
              */}{' '}
              The amounts themselves — ₦250,000 / ₦2,000,000 / ₦10,000,000 — are the
              consultant&apos;s own illustrative ladder, not figures taken from the client&apos;s
              specification, which does not state one. They will change once the client
              confirms real limits.
            </span>
          </div>
        </Card>

        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            Employee records and payroll — including PAYE and statutory deductions — exist in
            the backend and are tested. Turning on a company&apos;s statutory rates now has a
            screen (<a href="/finance/payroll">Money → Payroll setup</a> — gated to Finance
            Manager, Finance Controller and CFO, the same roles the API already restricts it
            to); raising and approving an actual monthly run still does not. Server-side
            permission checks now exist for
            most of what each role is meant to do. What is still missing is a screen to change
            an existing person&apos;s role after they have joined — today that is only set
            once, at the invitation.
          </p>
        </Card>
      </div>
    </>
  );
}
