'use client';

import Link from 'next/link';
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
  governedBreeds = [],
  supervisors,
}: {
  moduleKey: ModuleKey;
  houses: string[];
  today: string;
  /** Real breed names from the species/breed master (US-897-004/005), shown
 *  Only approved master values are selectable. */
  governedBreeds?: string[];
  supervisors: Array<{ id: string; fullName: string }>;
}) {
  const module = getModule(moduleKey)!;
  const t = module.terms;
  const breedOptions = [...new Set(governedBreeds)];

  const [code, setCode] = useState('');
  const [breed, setBreed] = useState('');
  const [purpose, setPurpose] = useState(module.purposes[0] ?? '');
  const [house, setHouse] = useState(houses[0] ?? '');
  const [count, setCount] = useState('');
  const [startedOn, setStartedOn] = useState(today);
  const [source, setSource] = useState('');
  const [originType, setOriginType] = useState<'OPENING_BALANCE' | 'MIGRATION'>('OPENING_BALANCE');
  const [originEvidence, setOriginEvidence] = useState('');
  const [responsibleSupervisorId, setResponsibleSupervisorId] = useState(supervisors[0]?.id ?? '');
  const [cost, setCost] = useState('');
  const [queued, setQueued] = useState(false);

  const countValue = Number(count.replace(/\D/g, '')) || 0;
  const costKobo = parseNairaToKobo(cost);

  const problems: string[] = [];
  if (code.trim().length === 0) problems.push(`Give the ${t.group.one} a code`);
  if (countValue <= 0) problems.push(`Enter how many ${t.animal.many} arrived`);
  if (!house) problems.push(`Choose a ${t.housing.one}`);
  if (!supervisors.length) problems.push('Add an active supervisor for this species before creating a population');
  if (!responsibleSupervisorId) problems.push('Choose a responsible supervisor');
  if (!breed) problems.push('Choose a breed from the approved species master');
  if (!originEvidence.trim()) problems.push('Add an opening balance or migration source reference');
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
        // The population's true lifecycle stage, not what it is kept for — the
        // API stores these separately and has no species vocabulary of its own
        // to derive one from the other. `stageByPurpose` is the one place this
        // module registry DOES know the two are the same thing for a given
        // purpose (a snail "Breeder cohort" starts at the Breeder stage, not Egg).
        stage: t.stageByPurpose?.[purpose] ?? t.stages[0] ?? purpose,
        house,
        openingPopulation: countValue,
        startedOn,
        source: source.trim(),
        originType,
        originEvidence: originEvidence.trim(),
        responsibleSupervisorId,
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
            <div className="notice notice-info">
              <span>
                <strong>Saved.</strong> If there was no signal it waits in the outbox and
                goes by itself — open the outbox in the header to check.
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

            <label className="field">
              Breed
              <select
                value={breed}
                onChange={(event) => setBreed(event.target.value)}
                disabled={!breedOptions.length}
              >
                <option value="">{breedOptions.length ? 'Choose an approved breed' : 'No active approved breeds configured'}</option>
                {breedOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
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
              <select
                value={house}
                disabled={houses.length === 0}
                onChange={(event) => setHouse(event.target.value)}
              >
                {houses.length === 0 ? (
                  <option value="">No active {t.housing.many} available</option>
                ) : (
                  houses.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="field">
              Responsible supervisor
              <select
                value={responsibleSupervisorId}
                onChange={(event) => setResponsibleSupervisorId(event.target.value)}
                disabled={!supervisors.length}
                required
              >
                {supervisors.length === 0 ? (
                  <option value="">No active supervisor for this species</option>
                ) : null}
                {supervisors.map((supervisor) => (
                  <option key={supervisor.id} value={supervisor.id}>
                    {supervisor.fullName}
                  </option>
                ))}
              </select>
            </label>
            {houses.length === 0 ? (
              <p className="faint">
                Add an active {t.housing.one} in <Link href="/pens">Houses &amp; pens</Link> before
                recording this {t.group.one}.
              </p>
            ) : null}
          </div>
        </Card>

        <Card title={t.intake}>
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <label className="field">
              Population source
              <select value={originType} onChange={(event) => setOriginType(event.target.value as 'OPENING_BALANCE' | 'MIGRATION')}>
                <option value="OPENING_BALANCE">Opening balance</option>
                <option value="MIGRATION">Migration</option>
              </select>
            </label>
            <label className="field">
              Source document or migration reference
              <input value={originEvidence} onChange={(event) => setOriginEvidence(event.target.value)} maxLength={500} required />
            </label>
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
