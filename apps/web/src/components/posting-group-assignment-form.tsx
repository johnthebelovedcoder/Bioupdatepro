'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  assignPostingGroup,
  endPostingGroupAssignment,
  type PostingGroupActionState,
} from '@/app/(app)/admin/posting-groups/actions';

interface GroupOption {
  application: string;
  postingGroup: string;
  masterType: string;
  description: string;
}

export function PostingGroupAssignmentForm({ groups }: { groups: GroupOption[] }) {
  const [state, action] = useActionState<PostingGroupActionState, FormData>(assignPostingGroup, { error: null, message: null });
  return (
    <form action={action} className="stack" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-3)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
      <label className="field">
        Approved workbook posting group
        <select name="group" required defaultValue="">
          <option value="" disabled>Select a group</option>
          {groups.map((group) => (
            <option key={`${group.application}|${group.postingGroup}`} value={`${group.application}|${group.postingGroup}|${group.masterType}`}>
              {group.application} · {group.postingGroup} · {group.masterType} — {group.description}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Master record ID or key
        <input name="masterId" required placeholder="Record ID, code, class, or category key" />
      </label>
      <p className="faint" style={{ margin: 0 }}>
        Use the existing master’s ID for item, customer, vendor, bank, employee, stage, or document records. Asset class and category groups use the exact class or category text.
      </p>
      <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <label className="field">
          Effective from
          <input name="effectiveFrom" type="date" required />
        </label>
        <label className="field">
          Effective to (optional)
          <input name="effectiveTo" type="date" />
        </label>
      </div>
      <Submit label="Assign group" pending="Saving…" />
    </form>
  );
}

export function EndPostingGroupAssignmentForm({ assignmentId, effectiveFrom }: { assignmentId: string; effectiveFrom: string }) {
  const [state, action] = useActionState<PostingGroupActionState, FormData>(endPostingGroupAssignment, { error: null, message: null });
  return (
    <form action={action} className="row" style={{ alignItems: 'end', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <label className="field">
        End on
        <input name="effectiveTo" type="date" min={effectiveFrom} required />
      </label>
      <Submit label="End assignment" pending="Saving…" />
      {state.error ? <span className="notice notice-error">{state.error}</span> : null}
      {state.message ? <span className="notice notice-success">{state.message}</span> : null}
    </form>
  );
}

function Submit({ label, pending }: { label: string; pending: string }) {
  const { pending: isPending } = useFormStatus();
  return <button className="btn btn-primary" type="submit" disabled={isPending}>{isPending ? pending : label}</button>;
}
