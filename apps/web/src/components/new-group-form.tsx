'use client';

import { useState } from 'react';
import { getModule, title, type ModuleKey } from '@/lib/modules';
import { parseNairaToKobo, formatNaira } from '@/lib/money';
import { enqueue, flush } from '@/lib/sync-queue';
import { Card, PageHeader } from './ui';

/**
 * Starting a new population — a placement of birds, a stocking of snails.
 *
 * One form for every module: the shape of the question is identical (what,
 * how many, where, when, from whom, at what cost) and only the words change.
 *
 * This is a manager's form rather than a worker's, so it is a normal form
 * rather than the daily round's stepper-heavy walk. It still goes through the
 * outbox, for the same reason everything else does — a farm office on a bad
 * connection should not lose a placement record.
 */
export function NewGroupForm({
  moduleKey,
  houses,
  today,
}: {
  moduleKey: ModuleKey;
  houses: string[];
  today: string;
}) {
  const module = getModule(moduleKey)!;
  const t = module.terms;

  const [code, setCode] = useState('');
  const [breed, setBreed] = useState(module.breeds[0] ?? '');
  const [purpose, setPurpose] = useState(module.purposes[0] ?? '');
  const [house, setHouse] = useState(houses[0] ?? '');
  const [count, setCount] = useState('');
  const [startedOn, setStartedOn] = useState(today);
  const [source, setSource] = useState('');
  const [cost, setCost] = useState('');
  const [queued, setQueued] = useState(false);

  const countValue = Number(count.replace(/\D/g, '')) || 0;
  const costKobo = parseNairaToKobo(cost);

  const problems: string[] = [];
  if (code.trim().length === 0) problems.push(`Give the ${t.group.one} a code`);
  if (countValue <= 0) problems.push(`Enter how many ${t.animal.many} arrived`);
  if (!house) problems.push(`Choose a ${t.housing.one}`);
  if (cost.trim() !== '' && costKobo === null) problems.push('Cost is not a valid amount');

  function submit() {
    enqueue({
      kind: 'new-group',
      label: `New ${t.group.one} ${code.trim()} · ${countValue.toLocaleString('en-NG')} ${t.animal.many}`,
      payload: {
        type: 'placement',
        module: moduleKey,
        code: code.trim(),
        breed,
        purpose,
        house,
        openingPopulation: countValue,
        startedOn,
        source: source.trim(),
        acquisitionCostKobo: costKobo !== null ? costKobo.toString() : null,
      },
    });
    void flush();
    setQueued(true);
  }

  if (queued) {
    return (
      <>
        <PageHeader
          title={`New ${t.group.one}`}
          subtitle={`${module.productName} · ${t.intake.toLowerCase()}`}
        />
        <Card>
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <div className="notice notice-warning">
              <span>
                <strong>Held in the outbox — not saved.</strong> There is no endpoint for
                this yet, so it cannot reach the server. Open the outbox in the header to
                see it.
              </span>
            </div>
            <div className="row" style={{ gap: 'var(--sp-3)' }}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setQueued(false);
                  setCode('');
                  setCount('');
                  setSource('');
                  setCost('');
                }}
              >
                Record another
              </button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`New ${t.group.one}`}
        subtitle={`${module.productName} · record a ${t.intake.toLowerCase()}`}
      />

      <div className="stack">
        <Card title={`About this ${t.group.one}`}>
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <label className="field">
              {title(t.group.one)} code
              <input
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder={module.key === 'snail' ? 'S-007' : 'L-2026-005'}
                autoCapitalize="characters"
              />
            </label>

            {/*
              A list of suggestions rather than a fixed dropdown. Farms keep
              breeds nobody put in a registry, and a select that cannot hold
              "local breed" is a select people work around.
            */}
            <label className="field">
              Breed
              <input
                value={breed}
                onChange={(event) => setBreed(event.target.value)}
                list="breed-options"
                placeholder="Type or choose"
              />
              <datalist id="breed-options">
                {module.breeds.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </label>

            <label className="field">
              Kept for
              <select value={purpose} onChange={(event) => setPurpose(event.target.value)}>
                {module.purposes.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              {title(t.housing.one)}
              <select value={house} onChange={(event) => setHouse(event.target.value)}>
                {houses.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>

        <Card title={t.intake}>
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <label className="field">
              How many {t.animal.many} arrived
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={count}
                onChange={(event) => setCount(event.target.value.replace(/\D/g, ''))}
                placeholder="0"
                className="num"
              />
            </label>

            <label className="field">
              Date
              <input
                type="date"
                value={startedOn}
                max={today}
                onChange={(event) => setStartedOn(event.target.value)}
              />
            </label>

            <label className="field">
              Bought from
              <input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="Supplier or your own stock"
              />
            </label>

            <label className="field">
              What it cost
              <input
                inputMode="decimal"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
                placeholder="0.00"
                className="num"
              />
              <span className="faint">
                {costKobo !== null && cost.trim() !== ''
                  ? `${formatNaira(costKobo)} — charged to this ${t.group.one}`
                  : `Charged to this ${t.group.one}, so its cost per ${t.animal.one} is right from day one`}
              </span>
            </label>
          </div>
        </Card>

        {problems.length > 0 ? (
          <div className="notice notice-warning">
            <span>{problems.join('. ')}.</span>
          </div>
        ) : null}

        <div className="entry-actions">
          <span className="faint">
            {countValue > 0
              ? `${countValue.toLocaleString('en-NG')} ${t.animal.many}`
              : 'Nothing entered'}
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={problems.length > 0}
            onClick={submit}
          >
            Save {t.group.one}
          </button>
        </div>
      </div>
    </>
  );
}
