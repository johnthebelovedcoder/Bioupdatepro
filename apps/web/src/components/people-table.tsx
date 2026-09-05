'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  deactivatePerson,
  reactivatePerson,
  resetPersonPassword,
  updatePersonRoles,
  type PasswordResetResult,
  type Person,
  type RoleEditResult,
} from '@/app/(app)/staff/actions';
import { ROLES, humanRole } from './invite-worker';
import { Sheet } from './sheet';

/**
 * The people actually on this farm, with the two things an admin needs to do
 * about an existing person: change what they may do, or turn their access
 * off. Both refuse on the server for your own row (see `invitation.service
 * .ts`'s `updateRoles`/`setActive`) — hidden here too, so the button is not
 * offered only to fail.
 */
export function PeopleTable({
  people,
  currentUserId,
}: {
  people: Person[];
  currentUserId: string;
}) {
  const [editing, setEditing] = useState<Person | null>(null);
  const [resetting, setResetting] = useState<Person | null>(null);

  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: 250 }}>Email</th>
              <th style={{ width: 220 }}>Roles</th>
              <th style={{ width: 100 }}>Status</th>
              <th style={{ width: 160 }} className="right">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => {
              const isSelf = person.id === currentUserId;
              return (
                <tr key={person.id}>
                  <td className="strong">
                    {person.name}
                    {isSelf ? <span className="faint"> (you)</span> : null}
                  </td>
                  <td className="num faint" style={{ textAlign: 'left' }}>
                    {person.email}
                  </td>
                  <td className="faint">{person.roles.map(humanRole).join(', ')}</td>
                  <td>
                    <span
                      className={`badge ${
                        person.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'
                      }`}
                    >
                      {person.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="right">
                    {isSelf ? null : (
                      <div className="row" style={{ gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
                        <button type="button" className="btn" onClick={() => setEditing(person)}>
                          Edit roles
                        </button>
                        <button type="button" className="btn" onClick={() => setResetting(person)}>
                          Reset password
                        </button>
                        {person.status === 'ACTIVE' ? (
                          <form action={deactivatePerson.bind(null, person.id)}>
                            <button type="submit" className="btn">
                              Deactivate
                            </button>
                          </form>
                        ) : (
                          <form action={reactivatePerson.bind(null, person.id)}>
                            <button type="submit" className="btn">
                              Reactivate
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing ? (
        <EditRolesSheet person={editing} onClose={() => setEditing(null)} />
      ) : null}
      {resetting ? (
        <ResetPasswordSheet person={resetting} onClose={() => setResetting(null)} />
      ) : null}
    </>
  );
}

function EditRolesSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const updateForPerson = updatePersonRoles.bind(null, person.id);
  const [state, action] = useActionState<RoleEditResult, FormData>(updateForPerson, {
    error: null,
  });

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <Sheet open onClose={onClose} title={`Change what ${person.name} may do`}>
      <form action={action} className="stack" style={{ gap: 'var(--sp-4)' }}>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}

        <div className="field">
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
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
                  defaultChecked={person.roles.includes(role.code)}
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
    </Sheet>
  );
}

/**
 * Generating a reset link for somebody who forgot their password.
 *
 * Same one-time-link pattern as `InviteWorker` — the server keeps only a
 * hash of the token, so this really is the only moment it can be read. No
 * confirmation step before generating: doing so immediately invalidates any
 * link generated earlier for this person, which is exactly what you want
 * when they are asking because the last one did not reach them.
 */
function ResetPasswordSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const [state, setState] = useState<PasswordResetResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    resetPersonPassword(person.id).then((result) => {
      if (!cancelled) {
        setState(result);
        setBusy(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [person.id]);

  return (
    <Sheet open onClose={onClose} title={`Reset password for ${person.name}`}>
      {busy ? (
        <p className="muted">Generating a link…</p>
      ) : state?.error ? (
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <div className="notice notice-error">{state.error}</div>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      ) : state?.link ? (
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <div className="notice notice-warning">
            <span>
              <strong>Copy this link now.</strong> It is shown once and cannot be read again.
              Anyone holding an earlier link for {state.email} will find it has stopped
              working — this one replaces it. It expires in one hour.
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
            <a
              className="btn btn-primary"
              href={`https://wa.me/?text=${encodeURIComponent(
                `Reset your BioAssetPro password: ${state.link}`,
              )}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Send on WhatsApp
            </a>
            <button type="button" className="btn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}
