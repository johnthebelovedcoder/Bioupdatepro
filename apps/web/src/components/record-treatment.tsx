'use client';

import { useState } from 'react';
import type { HealthEvent } from '@/lib/demo-ops';
import { formatDate, formatNaira, parseNairaToKobo } from '@/lib/money';
import { enqueue, flush } from '@/lib/sync-queue';
import { Card } from './ui';
import { Sheet } from './sheet';

/**
 * Recording that a treatment was actually given.
 *
 * Until now the health screen listed what was due and stopped there — and the
 * dashboard carried an alert whose button said "Mark done" and merely navigated
 * to that read-only list. Telling someone a vaccination is overdue and then
 * offering nowhere to say they did it is worse than saying nothing, because the
 * overdue count never falls and people stop believing it.
 *
 * Three things this captures that a tick-box would not:
 *
 *   1. WHO GAVE IT AND HOW MANY WERE TREATED. A vaccination that reached 3,000
 *      of 4,555 birds is not a completed vaccination, and the gap is where the
 *      next outbreak starts.
 *
 *   2. THE WITHDRAWAL PERIOD. After many treatments the eggs or meat cannot be
 *      sold for some days. That number comes off the product label — this asks
 *      for it rather than inventing it — and once recorded the app can say the
 *      one thing that matters: the date it is safe to sell again.
 *
 *   3. WHAT IT COST. A treatment is a cost of keeping that population alive and
 *      belongs against the batch like feed does, or cost per bird is understated
 *      and the batch looks more profitable than it was.
 *
 * Unscheduled treatments matter as much as scheduled ones: animals get sick
 * between vaccination dates, and a record that only accepts what was planned
 * will not match what happened.
 */

export interface TreatableGroup {
  code: string;
  house: string;
  population: number;
  /**
   * What this particular population is sold as. Carried per group rather than
   * taken from the module, because the withdrawal warning has to name the thing
   * that must not be sold — and telling someone not to sell eggs from a broiler
   * batch is advice they will rightly ignore.
   */
  output: string;
}

/** How a treatment was administered. The route changes dose and who may give it. */
const ROUTES = [
  'In drinking water',
  'Injection',
  'Spray',
  'In feed',
  'Eye or nose drop',
  'On the skin',
];

type Target = HealthEvent | 'unscheduled' | null;

export function HealthSchedule({
  events,
  groups,
  staff,
  today,
  labels,
}: {
  events: HealthEvent[];
  groups: TreatableGroup[];
  staff: string[];
  today: string;
  labels: { group: string; animal: string; output: string };
}) {
  const [target, setTarget] = useState<Target>(null);
  /** Recorded in this session and sitting in the outbox, keyed by event id. */
  const [recorded, setRecorded] = useState<Record<string, string>>({});

  return (
    <>
      <Card
        title="Schedule"
        subtitle="What is due, and what has been given"
        padded={false}
        action={
          <button type="button" className="btn" onClick={() => setTarget('unscheduled')}>
            Record a treatment
          </button>
        }
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Due</th>
                <th style={{ width: 120 }}>{labels.group}</th>
                <th>Treatment</th>
                <th style={{ width: 140 }}>Given</th>
                <th style={{ width: 130 }} className="right">
                  {/* The column is the action, so it carries no visible heading. */}
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const justRecorded = recorded[event.id];
                const done = event.status === 'DONE' || Boolean(justRecorded);
                return (
                  <tr key={event.id}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(event.dueOn)}
                    </td>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      {event.groupCode}
                      <div className="faint">{event.house}</div>
                    </td>
                    <td>
                      {event.name}
                      <div className="faint">{event.detail}</div>
                    </td>
                    <td className="faint">
                      {justRecorded ? (
                        <>
                          {formatDate(justRecorded)}
                          <div>waiting to send</div>
                        </>
                      ) : event.administeredOn ? (
                        <>
                          {formatDate(event.administeredOn)}
                          <div>{event.administeredBy}</div>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="right">
                      {done ? (
                        <span
                          className={`badge ${justRecorded ? 'badge-warning' : 'badge-success'}`}
                        >
                          {justRecorded ? 'in outbox' : 'done'}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={`btn ${event.status === 'OVERDUE' ? 'btn-primary' : ''}`}
                          onClick={() => setTarget(event)}
                        >
                          Record it
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {target ? (
        <TreatmentSheet
          target={target}
          groups={groups}
          staff={staff}
          today={today}
          labels={labels}
          onClose={() => setTarget(null)}
          onRecorded={(eventId, date) => {
            if (eventId) setRecorded((current) => ({ ...current, [eventId]: date }));
            setTarget(null);
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function TreatmentSheet({
  target,
  groups,
  staff,
  today,
  labels,
  onClose,
  onRecorded,
}: {
  target: Exclude<Target, null>;
  groups: TreatableGroup[];
  staff: string[];
  today: string;
  labels: { group: string; animal: string; output: string };
  onClose: () => void;
  onRecorded: (eventId: string | null, date: string) => void;
}) {
  const scheduled = target === 'unscheduled' ? null : target;

  const [groupCode, setGroupCode] = useState(scheduled?.groupCode ?? groups[0]?.code ?? '');
  const [name, setName] = useState(scheduled?.name ?? '');
  const [date, setDate] = useState(today);
  const [givenBy, setGivenBy] = useState(staff[0] ?? '');
  const [route, setRoute] = useState(ROUTES[0]!);
  const [treated, setTreated] = useState(
    String(groups.find((entry) => entry.code === (scheduled?.groupCode ?? groups[0]?.code))
      ?.population ?? 0),
  );
  const [productBatch, setProductBatch] = useState('');
  const [withdrawalDays, setWithdrawalDays] = useState('0');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');

  const group = groups.find((entry) => entry.code === groupCode);
  const population = group?.population ?? 0;
  const treatedCount = Number(treated) || 0;
  const withdrawal = Number(withdrawalDays) || 0;
  /*
   * An unreadable cost is refused rather than quietly treated as nothing. A
   * treatment silently recorded at ₦0 understates the batch, and the person who
   * typed the figure would have no way of knowing it had been dropped.
   */
  const costEntered = cost.trim().length > 0;
  const parsedCost = costEntered ? parseNairaToKobo(cost) : 0n;
  const costKobo = parsedCost ?? 0n;
  const safeFrom = withdrawal > 0 ? addDays(date, withdrawal) : null;

  const animals = `${labels.animal}s`;

  const problems: string[] = [];
  if (!name.trim()) problems.push('Say what was given');
  if (!groupCode) problems.push(`Choose which ${labels.group.toLowerCase()} was treated`);
  if (!givenBy.trim()) problems.push('Say who gave it');
  if (date > today) problems.push('The date cannot be in the future');
  if (treatedCount <= 0) problems.push(`Enter how many ${animals} were treated`);
  if (costEntered && parsedCost === null) problems.push('That cost is not a number I can read');
  if (population > 0 && treatedCount > population) {
    problems.push(
      `${groupCode} has ${population.toLocaleString('en-NG')} ${animals} — cannot treat ${treatedCount.toLocaleString('en-NG')}`,
    );
  }

  /*
   * Not a blocker. Partial coverage is a legitimate thing to record — a
   * vaccination interrupted by a storm is still worth having on file — but the
   * person recording it should see that it is partial before they commit.
   */
  const partial = population > 0 && treatedCount > 0 && treatedCount < population;

  function submit() {
    enqueue({
      kind: 'treatment',
      label: `${name.trim()} · ${groupCode}`,
      payload: {
        type: 'treatment',
        eventId: scheduled?.id ?? null,
        groupCode,
        name: name.trim(),
        date,
        givenBy,
        route,
        treated: treatedCount,
        populationAtTime: population,
        productBatch: productBatch.trim() || null,
        withdrawalDays: withdrawal,
        // Kept beside the days so the figure that produced it stays visible even
        // if the days are later corrected.
        safeToSellFrom: safeFrom,
        costKobo: costKobo.toString(),
        notes: notes.trim() || null,
      },
    });
    void flush();
    onRecorded(scheduled?.id ?? null, date);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={scheduled ? scheduled.name : 'Record a treatment'}
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
        {scheduled ? (
          <p className="muted" style={{ fontSize: 14 }}>
            {scheduled.detail} · due {formatDate(scheduled.dueOn)}
          </p>
        ) : (
          <label className="field">
            What did you give?
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name of the vaccine or medicine"
            />
          </label>
        )}

        <label className="field">
          Which {labels.group.toLowerCase()}?
          <select
            value={groupCode}
            onChange={(event) => {
              const next = event.target.value;
              setGroupCode(next);
              // The count follows the population, or the previous selection's
              // number would silently be attributed to a different population.
              setTreated(
                String(groups.find((entry) => entry.code === next)?.population ?? 0),
              );
            }}
          >
            {groups.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.code} · {entry.house} · {entry.population.toLocaleString('en-NG')}{' '}
                {animals}
              </option>
            ))}
          </select>
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

        <label className="field">
          Who gave it?
          {staff.length > 0 ? (
            <select value={givenBy} onChange={(event) => setGivenBy(event.target.value)}>
              {staff.map((person) => (
                <option key={person} value={person}>
                  {person}
                </option>
              ))}
            </select>
          ) : (
            <input value={givenBy} onChange={(event) => setGivenBy(event.target.value)} />
          )}
        </label>

        <label className="field">
          How was it given?
          <select value={route} onChange={(event) => setRoute(event.target.value)}>
            {ROUTES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          How many {animals}?
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={treated}
            onChange={(event) => setTreated(event.target.value)}
          />
          {population > 0 ? (
            <span className="faint">
              {population.toLocaleString('en-NG')} in this {labels.group.toLowerCase()}
            </span>
          ) : null}
        </label>

        {partial ? (
          <div className="notice notice-warning">
            <span>
              This covers {treatedCount.toLocaleString('en-NG')} of{' '}
              {population.toLocaleString('en-NG')} — {(population - treatedCount).toLocaleString('en-NG')}{' '}
              will not have had it.
            </span>
          </div>
        ) : null}

        <label className="field">
          Withdrawal days
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={withdrawalDays}
            onChange={(event) => setWithdrawalDays(event.target.value)}
          />
          <span className="faint">
            Read this off the product label — we do not know it for you.
          </span>
        </label>

        {safeFrom ? (
          <div className="notice notice-error">
            <span>
              <strong>
                Do not sell {group?.output ?? labels.output} from {groupCode} before{' '}
                {formatDate(safeFrom)}.
              </strong>{' '}
              That is {withdrawal} day{withdrawal === 1 ? '' : 's'} after the date above, from
              the number you entered.
            </span>
          </div>
        ) : null}

        <label className="field">
          Batch number on the bottle
          <input
            value={productBatch}
            onChange={(event) => setProductBatch(event.target.value)}
          />
          <span className="faint">Optional — for tracing a bad batch later.</span>
        </label>

        <label className="field">
          What did it cost?
          <input
            inputMode="decimal"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            placeholder="₦0.00"
          />
          <span className="faint">
            {costKobo > 0n
              ? `${formatNaira(costKobo)} goes against ${groupCode}, raising its cost per ${labels.animal}.`
              : 'Optional — goes against this population like feed does.'}
          </span>
        </label>

        <label className="field">
          Anything else?
          <textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="How they looked, anything that went wrong"
          />
        </label>

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

/**
 * Date arithmetic in UTC, so a plain calendar day does not shift because the
 * browser applied a timezone offset to it.
 */
function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
