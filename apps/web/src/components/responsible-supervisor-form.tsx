'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { assignResponsibleSupervisor, type GrowthState } from '@/app/(app)/m/batch-profile-actions';

const INITIAL: GrowthState = { error: null, message: null };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn btn-primary" type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save supervisor'}
    </button>
  );
}

export function ResponsibleSupervisorForm({
  code,
  currentSupervisorId,
  supervisors,
}: {
  code: string;
  currentSupervisorId: string;
  supervisors: Array<{ id: string; fullName: string }>;
}) {
  const [state, action] = useActionState(assignResponsibleSupervisor, INITIAL);
  if (supervisors.length === 0) {
    return <p className="notice notice-warning">No active supervisor is assigned to this species. Add one before assigning a population.</p>;
  }
  return (
    <form action={action} className="stack">
      <input type="hidden" name="code" value={code} />
      {state.error ? <p className="notice notice-error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="notice notice-success" role="status">{state.message}</p> : null}
      <label className="field">
        Responsible supervisor
        <select name="supervisorId" defaultValue={currentSupervisorId} required>
          <option value="" disabled>Choose a supervisor</option>
          {supervisors.map((supervisor) => (
            <option key={supervisor.id} value={supervisor.id}>{supervisor.fullName}</option>
          ))}
        </select>
      </label>
      <SaveButton />
    </form>
  );
}
