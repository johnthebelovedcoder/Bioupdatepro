'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveControlException, type FlowState } from '@/app/(app)/ledger/controls/actions';
import type { ControlExceptionCase, ControlExceptionUser } from '@/lib/controls';

const EMPTY: FlowState = { error: null, message: null };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary" type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save follow-up'}
    </button>
  );
}

function ExceptionForm({
  item,
  users,
  today,
}: {
  item: ControlExceptionCase;
  users: ControlExceptionUser[];
  today: string;
}) {
  const [state, action] = useActionState(saveControlException, EMPTY);
  return (
    <details>
      <summary className="link" style={{ cursor: 'pointer' }}>
        {item.tracked ? 'Update follow-up' : 'Assign owner and due date'}
      </summary>
      <form action={action} className="stack" style={{ marginTop: 'var(--sp-3)', maxWidth: 520 }}>
        <input type="hidden" name="accountNumber" value={item.accountNumber} />
        <input type="hidden" name="source" value={item.source} />
        <label className="field">
          Owner
          <select name="assignedToId" defaultValue={item.assignedToId} required>
            <option value="" disabled>Select an active company user</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.fullName} · {user.email}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Due date
          <input name="dueDate" type="date" defaultValue={item.dueDate || today} required />
        </label>
        <label className="field">
          Status
          <select name="status" defaultValue={item.active ? (item.status === 'RESOLVED' ? 'IN_PROGRESS' : item.status) : 'RESOLVED'}>
            {item.active ? (
              <>
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="ACCEPTED">Accepted with rationale</option>
              </>
            ) : (
              <option value="RESOLVED">Resolved</option>
            )}
          </select>
        </label>
        <label className="field">
          Note
          <textarea
            name="comments"
            maxLength={2000}
            rows={3}
            defaultValue={item.lastNote}
            placeholder={item.active ? 'Progress update; required when accepting an exception' : 'Explain how the exception was resolved'}
          />
        </label>
        {state.error ? <div className="notice notice-error">{state.error}</div> : null}
        {state.message ? <div className="notice notice-success">{state.message}</div> : null}
        <SaveButton />
      </form>
    </details>
  );
}

export function ControlExceptionFollowups({
  cases,
  users,
  today,
}: {
  cases: ControlExceptionCase[];
  users: ControlExceptionUser[];
  today: string;
}) {
  if (cases.length === 0) {
    return <p className="faint">No control exceptions have been recorded.</p>;
  }

  return (
    <div className="stack">
      {cases.map((item) => {
        const overdue = item.active && Boolean(item.dueDate) && item.dueDate < today;
        const tone = !item.active ? 'badge-success' : overdue || item.status !== 'ACCEPTED' ? 'badge-danger' : 'badge-warning';
        return (
          <article key={item.key} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 'var(--sp-3)' }}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              <strong>{item.accountNumber} · {item.accountName}</strong>
              <span className={`badge ${tone}`}>
                {overdue ? 'overdue · ' : ''}
                {!item.active && item.status === 'RESOLVED' ? 'resolved' : item.status.toLowerCase().replace('_', ' ')}
                {!item.active && item.status !== 'RESOLVED' ? ' · cleared, close follow-up' : ''}
              </span>
            </div>
            <p className="faint" style={{ marginTop: 'var(--sp-1)' }}>{item.source}</p>
            {item.assignedToName ? (
              <p className="faint" style={{ marginTop: 'var(--sp-1)' }}>
                Owner: {item.assignedToName} · due {item.dueDate || 'not set'}
                {item.updatedBy ? ` · last updated by ${item.updatedBy}` : ''}
              </p>
            ) : null}
            {item.lastNote ? <p style={{ marginTop: 'var(--sp-1)' }}>{item.lastNote}</p> : null}
            <div style={{ marginTop: 'var(--sp-2)' }}>
              {users.length > 0 ? (
                <ExceptionForm item={item} users={users} today={today} />
              ) : (
                <p className="faint">Add an active user to this company before assigning an owner.</p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
