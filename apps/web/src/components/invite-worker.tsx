'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createInvitation, revokeInvitation, type InviteResult, type PendingInvitation } from '@/app/(app)/staff/actions';
import { Card } from './ui';
import { Sheet } from './sheet';

/** The rungs of the approval ladder, in the order authority increases. */
const ROLES: Array<{ code: string; label: string; what: string }> = [
  {
    code: 'PRODUCTION_SUPERVISOR',
    label: 'Production supervisor',
    what: 'Walks the daily round, records feed, production, deaths and treatments.',
  },
  {
    code: 'FARM_MANAGER',
    label: 'Farm manager',
    what: 'Everything a supervisor can do, plus starting new populations and ordering feed.',
  },
  {
    code: 'FINANCE_MANAGER',
    label: 'Finance manager',
    what: 'Sales, purchases, customers and suppliers.',
  },
  {
    code: 'FINANCE_CONTROLLER',
    label: 'Finance controller',
    what: 'Approves postings and closes periods.',
  },
  {
    code: 'CFO',
    label: 'CFO',
    what: 'Sees everything and approves at the top of the ladder.',
  },
  {
    code: 'ADMINISTRATOR',
    label: 'Administrator',
    what: 'Full control, including inviting and removing people.',
  },
];

function humanRole(code: string): string {
  return ROLES.find((role) => role.code === code)?.label ?? code;
}

/**
 * Inviting somebody onto the farm.
 *
 * The link is shown once and then gone — the server keeps only a hash of the
 * token, so this is genuinely the only moment it can be read. The interface
 * says so rather than letting somebody close the sheet and go looking for it.
 */
export function InviteWorker({ invitations }: { invitations: PendingInvitation[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<InviteResult, FormData>(createInvitation, {
    error: null,
  });

  const pending = invitations.filter((entry) => entry.status === 'PENDING');

  return (
    <>
      <Card
        title="Invitations"
        subtitle={
          pending.length === 0
            ? 'Nobody is waiting to join'
            : `${pending.length} waiting to join`
        }
        padded={false}
        action={
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            Invite someone
          </button>
        }
      >
        {invitations.length === 0 ? (
          <div className="card-body">
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>
              Invite the people who work on the farm. They join this farm — they do not
              create one of their own.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Can do</th>
                  <th style={{ width: 140 }}>Invited by</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 110 }} className="right">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.email}</td>
                    <td className="faint">{entry.roles.map(humanRole).join(', ')}</td>
                    <td className="faint">{entry.invitedBy}</td>
                    <td>
                      <span
                        className={`badge ${
                          entry.status === 'ACCEPTED'
                            ? 'badge-success'
                            : entry.status === 'PENDING'
                              ? 'badge-warning'
                              : ''
                        }`}
                      >
                        {entry.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="right">
                      {entry.status === 'PENDING' ? <Revoke id={entry.id} /> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Sheet open={open} onClose={() => setOpen(false)} title="Invite someone">
        {state.link ? (
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <div className="notice notice-warning">
              <span>
                <strong>Copy this link now.</strong> It is shown once and cannot be read
                again — the server keeps only a scrambled copy. If you lose it, withdraw the
                invitation and send a new one.
              </span>
            </div>

            <label className="field">
              Link for {state.email}
              <textarea readOnly rows={3} value={state.link} onFocus={(e) => e.target.select()} />
            </label>

            <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn"
                onClick={() => void navigator.clipboard?.writeText(state.link!)}
              >
                Copy
              </button>
              {/* WhatsApp, because that is how it will actually be sent. */}
              <a
                className="btn btn-primary"
                href={`https://wa.me/?text=${encodeURIComponent(
                  `Join our farm on BioAssetPro: ${state.link}`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Send on WhatsApp
              </a>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
            {state.error ? <div className="notice notice-error">{state.error}</div> : null}

            <label className="field">
              Their email address
              <input name="email" type="email" required autoComplete="off" />
              <span className="faint">
                They will sign in with this. It cannot be changed by whoever opens the link.
              </span>
            </label>

            <div className="field">
              What will they be allowed to do?
              <div className="stack" style={{ gap: 'var(--sp-3)', marginTop: 6 }}>
                {ROLES.map((role) => (
                  <label
                    key={role.code}
                    className="row"
                    style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}
                  >
                    <input
                      type="checkbox"
                      name="roles"
                      value={role.code}
                      style={{ width: 'auto', minHeight: 0, marginTop: 3 }}
                    />
                    <span>
                      <span style={{ fontWeight: 500 }}>{role.label}</span>
                      <span className="faint" style={{ display: 'block' }}>
                        {role.what}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <span className="faint" style={{ marginTop: 6 }}>
                You cannot give somebody a role you do not have yourself.
              </span>
            </div>

            <Submit />
          </form>
        )}
      </Sheet>
    </>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Creating the link…' : 'Create invitation'}
    </button>
  );
}

function Revoke({ id }: { id: string }) {
  return (
    <form action={revokeInvitation.bind(null, id)}>
      <button type="submit" className="btn">
        Withdraw
      </button>
    </form>
  );
}
