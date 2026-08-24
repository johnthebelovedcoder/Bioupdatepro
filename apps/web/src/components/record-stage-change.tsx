'use client';

import { useState } from 'react';
import { enqueue, flush } from '@/lib/sync-queue';
import { Sheet } from './sheet';

/**
 * Moving a population to the next stage of its life.
 *
 * The growth screen said this outright: stage changes are not capturable, the
 * daily round records feed, production and mortality only. So a pullet that
 * came into lay last week was still filed as a grower, and everything that
 * hangs off the stage was quietly wrong with it — which feed the round offers
 * first, which breed standard the performance figures are measured against,
 * which populations the production screen counts as producing at all.
 *
 * Two things this deliberately does NOT do:
 *
 *   1. IT DOES NOT CHANGE THE COUNT. A bird becoming a layer is the same bird.
 *      Anything that moves animals out of a population — a sale, a harvest, a
 *      death — is its own record with its own number, and letting a stage
 *      change adjust the population too would give the farm two ways to lose
 *      animals and only one of them auditable.
 *
 *   2. IT DOES NOT SPLIT A POPULATION. Moving part of a batch into a new one is
 *      a different event with different accounting — the accumulated cost has
 *      to be apportioned between them — and offering it as a number field here
 *      would produce a split whose cost nobody had divided.
 *
 * The house move is offered alongside because the two nearly always happen
 * together: birds come out of the brooder when they stop being chicks. Made
 * optional rather than automatic, because plenty of farms rear and lay in the
 * same house.
 */

export interface StageChangeGroup {
  id: string;
  code: string;
  house: string;
  stage: string;
  population: number;
}

export function StageChange({
  groups,
  stages,
  houses,
  today,
  labels,
  /** Pre-selected when opened from one population's own page. */
  groupId,
  trigger,
}: {
  groups: StageChangeGroup[];
  stages: string[];
  houses: string[];
  today: string;
  labels: { group: string; animal: string; housing: string };
  groupId?: string;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);
  const [moved, setMoved] = useState<{ code: string; stage: string } | null>(null);

  if (groups.length === 0) return null;

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {trigger ?? 'Move to another stage'}
      </button>

      {moved ? (
        <p className="faint" style={{ marginTop: 'var(--sp-2)' }}>
          {moved.code} moved to {moved.stage} — waiting in the outbox.
        </p>
      ) : null}

      {open ? (
        <StageSheet
          groups={groups}
          stages={stages}
          houses={houses}
          today={today}
          labels={labels}
          initialGroupId={groupId}
          onClose={() => setOpen(false)}
          onRecorded={(entry) => {
            setMoved(entry);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function StageSheet({
  groups,
  stages,
  houses,
  today,
  labels,
  initialGroupId,
  onClose,
  onRecorded,
}: {
  groups: StageChangeGroup[];
  stages: string[];
  houses: string[];
  today: string;
  labels: { group: string; animal: string; housing: string };
  initialGroupId?: string;
  onClose: () => void;
  onRecorded: (entry: { code: string; stage: string }) => void;
}) {
  const first = groups.find((entry) => entry.id === initialGroupId) ?? groups[0]!;

  const [groupId, setGroupId] = useState(first.id);
  const group = groups.find((entry) => entry.id === groupId) ?? first;

  const [stage, setStage] = useState(() => nextStage(stages, first.stage));
  const [date, setDate] = useState(today);
  const [alsoMove, setAlsoMove] = useState(false);
  const [house, setHouse] = useState(first.house);
  const [notes, setNotes] = useState('');

  const problems: string[] = [];
  if (!stage) problems.push('Choose the stage it is moving to');
  else if (stage === group.stage) problems.push(`${group.code} is already at ${stage}`);
  if (date > today) problems.push('The date cannot be in the future');
  if (alsoMove && house === group.house) {
    problems.push(`Choose a different ${labels.housing.toLowerCase()}, or leave it where it is`);
  }

  function submit() {
    enqueue({
      kind: 'stage-change',
      label: `${group.code} → ${stage}`,
      payload: {
        type: 'stage-change',
        groupId: group.id,
        groupCode: group.code,
        fromStage: group.stage,
        toStage: stage,
        date,
        // Recorded so the receiving end never has to infer that the count was
        // meant to be unchanged.
        population: group.population,
        fromHouse: group.house,
        toHouse: alsoMove ? house : group.house,
        notes: notes.trim() || null,
      },
    });
    void flush();
    onRecorded({ code: group.code, stage });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Move ${group.code} to another stage`}
      footer={
        <div className="row" style={{ gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={problems.length > 0}
            onClick={submit}
          >
            Record it
          </button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 'var(--sp-4)' }}>
        {groups.length > 1 ? (
          <label className="field">
            Which {labels.group.toLowerCase()}?
            <select
              value={groupId}
              onChange={(event) => {
                const next = groups.find((entry) => entry.id === event.target.value);
                if (!next) return;
                setGroupId(next.id);
                // Both follow the selection, or the previous population's stage
                // and house would be applied to a different one.
                setStage(nextStage(stages, next.stage));
                setHouse(next.house);
                setAlsoMove(false);
              }}
            >
              {groups.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.code} · {entry.stage} · {entry.population.toLocaleString('en-NG')}{' '}
                  {labels.animal}s
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="field">
          Moving to
          <select value={stage} onChange={(event) => setStage(event.target.value)}>
            {stages.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
          <span className="faint">
            Now at {group.stage}. This changes what the {labels.group.toLowerCase()} is, not how
            many are in it.
          </span>
        </label>

        <label className="field">
          When?
          <input
            type="date"
            value={date}
            max={today}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>

        <label className="field row" style={{ gap: 'var(--sp-3)', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={alsoMove}
            style={{ width: 'auto', minHeight: 0 }}
            onChange={(event) => setAlsoMove(event.target.checked)}
          />
          Moved to a different {labels.housing.toLowerCase()} too
        </label>

        {alsoMove ? (
          <label className="field">
            Which {labels.housing.toLowerCase()}?
            <select value={house} onChange={(event) => setHouse(event.target.value)}>
              {houses.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <span className="faint">Now in {group.house}.</span>
          </label>
        ) : null}

        <label className="field">
          Anything else?
          <textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Optional"
          />
        </label>

        <div className="notice notice-info">
          <span>
            The stage decides which feed the daily round offers first and which breed standard
            these figures are measured against, so recording it late makes both wrong in the
            meantime.
          </span>
        </div>

        {problems.length > 0 ? (
          <div className="notice notice-error">
            <span>{problems[0]}</span>
          </div>
        ) : (
          <div className="notice notice-info">
            <span>
              If there is no signal this waits in the outbox and goes by itself.
            </span>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** The one after the current stage, or the current one if it is already last. */
function nextStage(stages: string[], current: string): string {
  const index = stages.indexOf(current);
  if (index < 0) return stages[0] ?? current;
  return stages[index + 1] ?? current;
}
