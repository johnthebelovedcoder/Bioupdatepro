'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { acknowledgeReading, recordReading, saveIncubator, saveStandard, type LogState } from '@/app/(app)/farm/incubation/actions';

const EMPTY: LogState = { error: null, message: null };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : label}
    </button>
  );
}

function Notices({ state }: { state: LogState }) {
  return (
    <>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      {state.message ? <div className="notice notice-success">{state.message}</div> : null}
    </>
  );
}

export function StandardForm({
  current,
}: {
  current: { minTemperatureC: string; maxTemperatureC: string; minHumidityPercent: string; maxHumidityPercent: string; readingIntervalHours: number } | null;
}) {
  const [state, action] = useActionState(saveStandard, EMPTY);
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-3)' }}>
      <Notices state={state} />
      <div className="grid-auto">
        <label className="field">
          Temperature from (°C)
          <input name="minTemperatureC" type="number" step="0.01" defaultValue={current?.minTemperatureC ?? ''} required />
        </label>
        <label className="field">
          to (°C)
          <input name="maxTemperatureC" type="number" step="0.01" defaultValue={current?.maxTemperatureC ?? ''} required />
        </label>
        <label className="field">
          Humidity from (%)
          <input name="minHumidityPercent" type="number" step="0.01" min="0" max="100" defaultValue={current?.minHumidityPercent ?? ''} required />
        </label>
        <label className="field">
          to (%)
          <input name="maxHumidityPercent" type="number" step="0.01" min="0" max="100" defaultValue={current?.maxHumidityPercent ?? ''} required />
        </label>
        <label className="field">
          A reading every (hours)
          <input name="readingIntervalHours" type="number" min="1" max="48" step="1" defaultValue={current?.readingIntervalHours ?? ''} required />
        </label>
      </div>
      <div>
        <Submit label="Save standard" />
      </div>
    </form>
  );
}

/** A setter reading or a candling, against one batch. */
export function ReadingForm({ batchId }: { batchId: string }) {
  const [state, action] = useActionState(recordReading, EMPTY);
  const [kind, setKind] = useState<'ENVIRONMENT' | 'CANDLING'>('ENVIRONMENT');
  // The time as this device's clock shows it, sent as an exact instant.
  const [instant, setInstant] = useState('');
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-2)' }}>
      <input type="hidden" name="incubationBatchId" value={batchId} />
      <input type="hidden" name="readAt" value={instant} />
      <Notices state={state} />
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field" style={{ margin: 0 }}>
          Reading
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as 'ENVIRONMENT' | 'CANDLING')}>
            <option value="ENVIRONMENT">Temperature and humidity</option>
            <option value="CANDLING">Candling</option>
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}>
          Taken at
          <input
            type="datetime-local"
            onChange={(e) => {
              const local = e.target.value;
              setInstant(local ? new Date(local).toISOString() : '');
            }}
          />
        </label>
        {kind === 'ENVIRONMENT' ? (
          <>
            <label className="field" style={{ margin: 0 }}>
              °C
              <input name="temperatureC" type="number" step="0.01" style={{ width: 90 }} />
            </label>
            <label className="field" style={{ margin: 0 }}>
              Humidity %
              <input name="humidityPercent" type="number" step="0.01" style={{ width: 90 }} />
            </label>
            <label className="row" style={{ gap: 4, alignItems: 'center' }}>
              <input type="checkbox" name="turned" defaultChecked />
              Turned
            </label>
          </>
        ) : (
          <>
            <label className="field" style={{ margin: 0 }}>
              Fertile
              <input name="fertileCount" type="number" min="0" step="1" style={{ width: 90 }} />
            </label>
            <label className="field" style={{ margin: 0 }}>
              Clear
              <input name="clearCount" type="number" min="0" step="1" style={{ width: 90 }} />
            </label>
            <label className="field" style={{ margin: 0 }}>
              Dead in shell
              <input name="deadInShellCount" type="number" min="0" step="1" style={{ width: 90 }} />
            </label>
          </>
        )}
        <label className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
          Note
          <input name="note" />
        </label>
        <Submit label="Record" />
      </div>
      <span className="faint" style={{ fontSize: 12 }}>
        Leave “taken at” blank for now.
      </span>
    </form>
  );
}

export function AcknowledgeException({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<LogState>(EMPTY);
  const [action, setAction] = useState('');
  if (state.message) return <span className="faint">{state.message}</span>;
  return (
    <div className="stack" style={{ gap: 'var(--sp-1)' }}>
      {state.error ? <div className="notice notice-error">{state.error}</div> : null}
      <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="What was done" aria-label="Action taken" />
      <div>
        <button type="button" className="btn btn-sm" disabled={pending || !action.trim()} onClick={() => start(async () => setState(await acknowledgeReading(id, action)))}>
          Acknowledge
        </button>
      </div>
    </div>
  );
}

export function IncubatorForm() {
  const [state, action] = useActionState(saveIncubator, EMPTY);
  return (
    <form action={action} className="stack" style={{ gap: 'var(--sp-2)' }}>
      <Notices state={state} />
      <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field" style={{ margin: 0 }}>
          Code
          <input name="code" placeholder="INC-01" required style={{ width: 110 }} />
        </label>
        <label className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
          Name
          <input name="name" placeholder="Setter 1, hatchery block" required />
        </label>
        <label className="field" style={{ margin: 0 }}>
          Holds (eggs)
          <input name="capacityEggs" type="number" min="1" step="1" required style={{ width: 110 }} />
        </label>
        <label className="row" style={{ gap: 4, alignItems: 'center' }}>
          <input type="checkbox" name="inactive" />
          Out of use
        </label>
        <Submit label="Save" />
      </div>
      <span className="faint" style={{ fontSize: 12 }}>
        Same code again changes it. Once any incubator is registered, every set must name one with room for the eggs.
      </span>
    </form>
  );
}
