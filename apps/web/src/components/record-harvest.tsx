'use client';

import { useState } from 'react';
import type { HarvestRow } from '@/lib/demo-ops';
import { formatDate, formatNaira } from '@/lib/money';
import { enqueue, flush } from '@/lib/sync-queue';
import { Card } from './ui';
import { Sheet } from './sheet';

/**
 * Recording a harvest.
 *
 * The snail module's main event, and until now the one screen that could only
 * be read. Feed going in was recordable; the thing the whole operation exists
 * to produce was not.
 *
 * Two points of substance:
 *
 *   1. A HARVEST IS NOT A SALE. It moves cost out of the colony's
 *      work-in-progress and into finished goods stock. No revenue, no customer,
 *      no price — those belong to the sale, which may happen days later and at a
 *      price nobody knows yet. Putting a price here would recognise profit at
 *      the moment of picking, which is both wrong and the single easiest way for
 *      a farm to convince itself it is doing better than it is.
 *
 *   2. IT TAKES SNAILS OUT OF THE COLONY. The count is what updates the
 *      register, which is why it is asked for rather than derived. A figure per
 *      kilo would be an invention — it varies with size, breed and season — and
 *      an invented count would quietly corrupt the population that every
 *      mortality rate on the farm is measured against.
 */

export interface HarvestableGroup {
  code: string;
  house: string;
  population: number;
}

export function HarvestLog({
  rows,
  groups,
  grades,
  today,
  labels,
}: {
  rows: HarvestRow[];
  groups: HarvestableGroup[];
  grades: string[];
  today: string;
  labels: { group: string; animal: string };
}) {
  const [open, setOpen] = useState(false);
  const [queued, setQueued] = useState<Array<{ code: string; kg: number; date: string }>>([]);

  return (
    <>
      <Card
        title="Harvests"
        padded={false}
        action={
          <div className="row" style={{ gap: 'var(--sp-3)' }}>
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              Record a harvest
            </button>
          </div>
        }
      >
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Date</th>
                <th style={{ width: 110 }}>{labels.group}</th>
                <th>Grade</th>
                <th className="right" style={{ width: 100 }}>
                  Weight
                </th>
                <th className="right" style={{ width: 110 }}>
                  Count
                </th>
                <th>Destination</th>
                <th className="right" style={{ width: 130 }}>
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {queued.map((entry, index) => (
                <tr key={`queued-${index}`}>
                  <td className="num" style={{ textAlign: 'left' }}>
                    {formatDate(entry.date)}
                  </td>
                  <td className="num strong" style={{ textAlign: 'left' }}>
                    {entry.code}
                  </td>
                  <td colSpan={4} className="faint">
                    Waiting to send
                  </td>
                  <td className="right">
                    <span className="badge badge-warning">in outbox</span>
                  </td>
                </tr>
              ))}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="num" style={{ textAlign: 'left' }}>
                    {formatDate(row.date)}
                  </td>
                  <td className="num strong" style={{ textAlign: 'left' }}>
                    {row.colonyCode}
                  </td>
                  <td>{row.grade}</td>
                  <td className="num">{row.kg} kg</td>
                  <td className="num">{row.count.toLocaleString('en-NG')}</td>
                  <td className="faint">{row.destination}</td>
                  <td className="num">{formatNaira(row.valueKobo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-footer">
          <span className="faint">
            A harvest moves cost out of the {labels.group.toLowerCase()}&apos;s work-in-progress
            account and into finished goods — which is where the{' '}
            {labels.group.toLowerCase()}&apos;s profit becomes measurable.
          </span>
        </div>
      </Card>

      {open ? (
        <HarvestSheet
          groups={groups}
          grades={grades}
          today={today}
          labels={labels}
          onClose={() => setOpen(false)}
          onRecorded={(entry) => {
            setQueued((current) => [entry, ...current]);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function HarvestSheet({
  groups,
  grades,
  today,
  labels,
  onClose,
  onRecorded,
}: {
  groups: HarvestableGroup[];
  grades: string[];
  today: string;
  labels: { group: string; animal: string };
  onClose: () => void;
  onRecorded: (entry: { code: string; kg: number; date: string }) => void;
}) {
  const [groupCode, setGroupCode] = useState(groups[0]?.code ?? '');
  const [date, setDate] = useState(today);
  const [grade, setGrade] = useState(grades[0] ?? '');
  const [kg, setKg] = useState('');
  const [count, setCount] = useState('');
  const [destination, setDestination] = useState<'store' | 'colony'>('store');
  const [targetCode, setTargetCode] = useState('');
  const [notes, setNotes] = useState('');

  const group = groups.find((entry) => entry.code === groupCode);
  const population = group?.population ?? 0;
  const weight = Number(kg) || 0;
  const taken = Number(count) || 0;
  const animals = `${labels.animal}s`;

  const problems: string[] = [];
  if (!groupCode) problems.push(`Choose which ${labels.group.toLowerCase()} was harvested`);
  if (date > today) problems.push('The date cannot be in the future');
  if (weight <= 0) problems.push('Enter the weight harvested');
  if (taken <= 0) problems.push(`Enter how many ${animals} were taken`);
  if (population > 0 && taken > population) {
    problems.push(
      `${groupCode} has ${population.toLocaleString('en-NG')} ${animals} — cannot harvest ${taken.toLocaleString('en-NG')}`,
    );
  }
  if (destination === 'colony') {
    if (!targetCode) problems.push('Choose where they were moved to');
    else if (targetCode === groupCode) {
      problems.push('They cannot move to the same ' + labels.group.toLowerCase());
    }
  }

  /*
   * A sanity check rather than a rule. Nothing here knows how many snails make
   * a kilo — it varies with size, breed and season — but a worker who has typed
   * a weight in grams or a count of crates will see it immediately.
   */
  const perKg = weight > 0 && taken > 0 ? Math.round(taken / weight) : null;

  function submit() {
    enqueue({
      kind: 'harvest',
      label: `Harvest ${weight} kg · ${groupCode}`,
      payload: {
        type: 'harvest',
        groupCode,
        date,
        grade,
        kg: weight,
        count: taken,
        populationAtTime: population,
        destination: destination === 'store' ? 'Finished goods' : targetCode,
        movedToGroup: destination === 'colony' ? targetCode : null,
        notes: notes.trim() || null,
      },
    });
    void flush();
    onRecorded({ code: groupCode, kg: weight, date });
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Record a harvest"
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
        <label className="field">
          Which {labels.group.toLowerCase()}?
          <select
            value={groupCode}
            onChange={(event) => setGroupCode(event.target.value)}
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
          Grade
          <select value={grade} onChange={(event) => setGrade(event.target.value)}>
            {grades.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Weight harvested
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            value={kg}
            onChange={(event) => setKg(event.target.value)}
            placeholder="kg"
          />
        </label>

        <label className="field">
          How many {animals}?
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={count}
            onChange={(event) => setCount(event.target.value)}
          />
          <span className="faint">
            {perKg
              ? `About ${perKg} per kg. This is what comes off the ${labels.group.toLowerCase()}'s population.`
              : `This is what comes off the ${labels.group.toLowerCase()}'s population, so it has to be counted.`}
          </span>
        </label>

        <label className="field">
          Where did they go?
          <select
            value={destination}
            onChange={(event) => setDestination(event.target.value as 'store' | 'colony')}
          >
            <option value="store">Into the store, to be sold</option>
            <option value="colony">
              Kept back as breeding stock, into another {labels.group.toLowerCase()}
            </option>
          </select>
        </label>

        {destination === 'colony' ? (
          <label className="field">
            Which {labels.group.toLowerCase()}?
            <select
              value={targetCode}
              onChange={(event) => setTargetCode(event.target.value)}
            >
              <option value="">Choose one</option>
              {groups
                .filter((entry) => entry.code !== groupCode)
                .map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.code} · {entry.house}
                  </option>
                ))}
            </select>
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
            This is not a sale. It moves the cost of these {animals} out of {groupCode || 'the ' + labels.group.toLowerCase()}{' '}
            and into stock — record the sale when they are actually sold, at the price you
            actually get.
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
