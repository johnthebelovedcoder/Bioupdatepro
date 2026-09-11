'use client';

import { useState } from 'react';
import { enqueue, flush } from '@/lib/sync-queue';
import { formatDate } from '@/lib/money';
import { Card, EmptyState, Stat } from './ui';
import { Sheet } from './sheet';
import { IconEgg } from './icons';
import type { EggBatch, IncubationBatch, LayingGroup } from '@/lib/poultry-eggs';

/**
 * PoultryPro egg production, incubation and hatching (P-EGG-01 through 08).
 *
 * Three real stages, each its own record: a COLLECTION grades the day's eggs
 * into hatching/table/reject; a hatching-quality batch can be SET into an
 * incubator, which draws down `hatchingRemaining` — the same running-balance
 * discipline the population count itself uses, so two incubators cannot
 * accidentally claim the same eggs; and a HATCH closes one incubation batch
 * exactly once, creating the day-old-chick group when anything survived.
 *
 * No GL posting happens at any of these steps — the client's own Decision
 * Register (DEC-002, egg recognition) is still open, so there is no fair
 * value policy yet to post against. The lifecycle is real and enforced
 * end to end regardless; the accounting consequence activates once DEC-002
 * is answered, the same precedent `recordHarvest()` already set.
 */

export function PoultryBreeding({
  eggBatches,
  incubationBatches,
  layingGroups,
  today,
}: {
  eggBatches: EggBatch[];
  incubationBatches: IncubationBatch[];
  layingGroups: LayingGroup[];
  today: string;
}) {
  const [queuedCollections, setQueuedCollections] = useState<string[]>([]);
  const [queuedIncubations, setQueuedIncubations] = useState<string[]>([]);
  const [queuedHatches, setQueuedHatches] = useState<string[]>([]);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [incubationTarget, setIncubationTarget] = useState<EggBatch | null>(null);
  const [hatchTarget, setHatchTarget] = useState<IncubationBatch | null>(null);

  const hatched = incubationBatches.filter((b) => b.hatchEvent);
  const rates = hatched.map((b) => (b.hatchEvent!.hatchedCount / b.setQuantity) * 100);
  const averageRate = rates.length
    ? Number((rates.reduce((sum, r) => sum + r, 0) / rates.length).toFixed(1))
    : null;
  const eggsLaid = eggBatches.reduce((sum, b) => sum + b.totalCount, 0);
  const hatchlings = hatched.reduce((sum, b) => sum + b.hatchEvent!.hatchedCount, 0);
  const incubating = incubationBatches.filter((b) => b.status === 'SET').length;

  const availableToIncubate = eggBatches.filter((b) => b.hatchingRemaining > 0);

  return (
    <div className="stack">
      <div className="stat-grid">
        <Stat
          label="Average hatch rate"
          value={averageRate !== null ? `${averageRate}%` : '—'}
          goodWhen="up"
          hint="completed batches"
        />
        <Stat label="Eggs collected" value={eggsLaid.toLocaleString('en-NG')} />
        <Stat label="Hatchlings" value={hatchlings.toLocaleString('en-NG')} />
        <Stat label="Incubating" value={String(incubating)} />
      </div>

      <Card
        title="Egg collections"
        subtitle="Graded into hatching, table and reject as they come in"
        padded={false}
        action={
          <button type="button" className="btn btn-primary" onClick={() => setCollectionOpen(true)}>
            Record a collection
          </button>
        }
      >
        {eggBatches.length === 0 && queuedCollections.length === 0 ? (
          <EmptyState
            icon={<IconEgg size={22} />}
            title="No collections recorded yet"
            body="Record one above when eggs are collected from a laying flock."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Date</th>
                  <th style={{ width: 120 }}>Batch</th>
                  <th style={{ width: 110 }}>Flock</th>
                  <th className="right" style={{ width: 100 }}>
                    Hatching
                  </th>
                  <th className="right" style={{ width: 90 }}>
                    Table
                  </th>
                  <th className="right" style={{ width: 90 }}>
                    Reject
                  </th>
                  <th className="right" style={{ width: 110 }}>
                    Available
                  </th>
                  <th style={{ width: 130 }}></th>
                </tr>
              </thead>
              <tbody>
                {queuedCollections.map((label, index) => (
                  <tr key={`queued-${index}`}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(today)}
                    </td>
                    <td colSpan={6} className="faint">
                      {label} — waiting to send
                    </td>
                    <td>
                      <span className="badge badge-warning">in outbox</span>
                    </td>
                  </tr>
                ))}
                {eggBatches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(batch.collectedOn)}
                    </td>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      {batch.code}
                    </td>
                    <td className="faint">{batch.sourceGroup.code}</td>
                    <td className="num">{batch.hatchingCount.toLocaleString('en-NG')}</td>
                    <td className="num">{batch.tableCount.toLocaleString('en-NG')}</td>
                    <td className="num">{batch.rejectCount.toLocaleString('en-NG')}</td>
                    <td className="num">{batch.hatchingRemaining.toLocaleString('en-NG')}</td>
                    <td>
                      {batch.hatchingRemaining > 0 ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setIncubationTarget(batch)}
                        >
                          Set to incubate
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Incubation & hatching" subtitle="One hatch closes each batch exactly once" padded={false}>
        {incubationBatches.length === 0 && queuedIncubations.length === 0 ? (
          <EmptyState
            icon={<IconEgg size={22} />}
            title="Nothing set to incubate yet"
            body="Set a hatching-quality batch to incubate from the collections above."
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Set on</th>
                  <th style={{ width: 120 }}>Batch</th>
                  <th style={{ width: 110 }}>From</th>
                  <th className="right" style={{ width: 90 }}>
                    Set
                  </th>
                  <th className="right" style={{ width: 90 }}>
                    Hatched
                  </th>
                  <th className="right" style={{ width: 100 }}>
                    Hatch rate
                  </th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 130 }}></th>
                </tr>
              </thead>
              <tbody>
                {queuedIncubations.map((label, index) => (
                  <tr key={`queued-${index}`}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(today)}
                    </td>
                    <td colSpan={5} className="faint">
                      {label} — waiting to send
                    </td>
                    <td colSpan={2}>
                      <span className="badge badge-warning">in outbox</span>
                    </td>
                  </tr>
                ))}
                {incubationBatches.map((batch) => {
                  const rate = batch.hatchEvent
                    ? Number(((batch.hatchEvent.hatchedCount / batch.setQuantity) * 100).toFixed(1))
                    : null;
                  return (
                    <tr key={batch.id}>
                      <td className="num" style={{ textAlign: 'left' }}>
                        {formatDate(batch.setOn)}
                      </td>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {batch.code}
                      </td>
                      <td className="faint">{batch.eggBatch.code}</td>
                      <td className="num">{batch.setQuantity.toLocaleString('en-NG')}</td>
                      <td className="num">
                        {batch.hatchEvent ? batch.hatchEvent.hatchedCount.toLocaleString('en-NG') : '—'}
                      </td>
                      <td className="num">{rate !== null ? `${rate}%` : '—'}</td>
                      <td>
                        <span className={`badge ${batch.status === 'HATCHED' ? 'badge-success' : 'badge-warning'}`}>
                          {batch.status === 'HATCHED' ? 'hatched' : 'incubating'}
                        </span>
                      </td>
                      <td>
                        {batch.status === 'SET' ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setHatchTarget(batch)}
                          >
                            Record hatch
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {queuedHatches.length > 0 ? (
          <div className="card-footer">
            <span className="faint">{queuedHatches.join(', ')} — waiting to send</span>
          </div>
        ) : null}
      </Card>

      {collectionOpen ? (
        <CollectionSheet
          groups={layingGroups}
          today={today}
          onClose={() => setCollectionOpen(false)}
          onRecorded={(label) => {
            setQueuedCollections((current) => [label, ...current]);
            setCollectionOpen(false);
          }}
        />
      ) : null}

      {incubationTarget ? (
        <IncubationSheet
          batch={incubationTarget}
          today={today}
          onClose={() => setIncubationTarget(null)}
          onRecorded={(label) => {
            setQueuedIncubations((current) => [label, ...current]);
            setIncubationTarget(null);
          }}
        />
      ) : null}

      {hatchTarget ? (
        <HatchSheet
          batch={hatchTarget}
          today={today}
          onClose={() => setHatchTarget(null)}
          onRecorded={(label) => {
            setQueuedHatches((current) => [label, ...current]);
            setHatchTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CollectionSheet({
  groups,
  today,
  onClose,
  onRecorded,
}: {
  groups: LayingGroup[];
  today: string;
  onClose: () => void;
  onRecorded: (label: string) => void;
}) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [date, setDate] = useState(today);
  const [hatching, setHatching] = useState('');
  const [table, setTable] = useState('');
  const [reject, setReject] = useState('');
  const [notes, setNotes] = useState('');

  const hatchingN = Number(hatching) || 0;
  const tableN = Number(table) || 0;
  const rejectN = Number(reject) || 0;
  const total = hatchingN + tableN + rejectN;

  const problems: string[] = [];
  if (!groupId) problems.push('Choose which flock laid these eggs');
  if (!code.trim()) problems.push('Give the batch a code');
  if (date > today) problems.push('The date cannot be in the future');
  if (total <= 0) problems.push('At least one egg must be recorded');
  if (hatchingN < 0 || tableN < 0 || rejectN < 0) problems.push('Egg counts cannot be negative');

  function submit() {
    enqueue({
      kind: 'egg-collection',
      label: `Collection ${code} · ${total} eggs`,
      payload: {
        sourceGroupId: groupId,
        code: code.trim(),
        collectedOn: date,
        hatchingCount: hatchingN,
        tableCount: tableN,
        rejectCount: rejectN,
        notes: notes.trim() || undefined,
      },
    });
    void flush();
    onRecorded(`${code.trim()} (${total} eggs)`);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Record a collection"
      footer={
        <div className="row" style={{ gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={problems.length > 0} onClick={submit}>
            Record it
          </button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 'var(--sp-4)' }}>
        <label className="field">
          Which flock?
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {groups.length === 0 ? <option value="">No active poultry flock</option> : null}
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} · {g.stage} · {g.population.toLocaleString('en-NG')} birds
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Batch code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="EGG-2026-001" />
        </label>

        <label className="field">
          When?
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label className="field">
          Hatching quality
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={hatching}
            onChange={(e) => setHatching(e.target.value)}
          />
          <span className="faint">Clean, well-shaped — these are the ones that can go into an incubator.</span>
        </label>

        <label className="field">
          Table quality
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={table}
            onChange={(e) => setTable(e.target.value)}
          />
        </label>

        <label className="field">
          Rejects
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={reject}
            onChange={(e) => setReject(e.target.value)}
          />
          <span className="faint">Cracked, dirty or misshapen — not sold, not set.</span>
        </label>

        <label className="field">
          Anything else?
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </label>

        {problems.length > 0 ? (
          <div className="notice notice-error">
            <span>{problems[0]}</span>
          </div>
        ) : (
          <div className="notice notice-info">
            <span>Total: {total} eggs. If there is no signal this waits in the outbox and goes by itself.</span>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */

function IncubationSheet({
  batch,
  today,
  onClose,
  onRecorded,
}: {
  batch: EggBatch;
  today: string;
  onClose: () => void;
  onRecorded: (label: string) => void;
}) {
  const [code, setCode] = useState('');
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState(String(batch.hatchingRemaining));
  const [incubator, setIncubator] = useState('');
  const [notes, setNotes] = useState('');

  const quantityN = Number(quantity) || 0;

  const problems: string[] = [];
  if (!code.trim()) problems.push('Give the incubation batch a code');
  if (date > today) problems.push('The date cannot be in the future');
  if (quantityN <= 0) problems.push('Enter how many eggs are being set');
  if (quantityN > batch.hatchingRemaining) {
    problems.push(`Only ${batch.hatchingRemaining} hatching egg(s) remain on ${batch.code}`);
  }

  function submit() {
    enqueue({
      kind: 'egg-incubation',
      label: `Incubation ${code} · ${quantityN} eggs`,
      payload: {
        eggBatchId: batch.id,
        code: code.trim(),
        setOn: date,
        setQuantity: quantityN,
        incubator: incubator.trim() || undefined,
        notes: notes.trim() || undefined,
      },
    });
    void flush();
    onRecorded(`${code.trim()} (${quantityN} eggs)`);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Set ${batch.code} to incubate`}
      footer={
        <div className="row" style={{ gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={problems.length > 0} onClick={submit}>
            Set to incubate
          </button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 'var(--sp-4)' }}>
        <p className="faint">
          {batch.hatchingRemaining} hatching egg(s) available from {batch.code} ({batch.sourceGroup.code}).
        </p>

        <label className="field">
          Incubation batch code
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="INC-2026-001" />
        </label>

        <label className="field">
          When?
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label className="field">
          How many eggs?
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={batch.hatchingRemaining}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>

        <label className="field">
          Incubator
          <input value={incubator} onChange={(e) => setIncubator(e.target.value)} placeholder="Optional" />
        </label>

        <label className="field">
          Anything else?
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </label>

        {problems.length > 0 ? (
          <div className="notice notice-error">
            <span>{problems[0]}</span>
          </div>
        ) : (
          <div className="notice notice-info">
            <span>If there is no signal this waits in the outbox and goes by itself.</span>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */

function HatchSheet({
  batch,
  today,
  onClose,
  onRecorded,
}: {
  batch: IncubationBatch;
  today: string;
  onClose: () => void;
  onRecorded: (label: string) => void;
}) {
  const [date, setDate] = useState(today);
  const [hatched, setHatched] = useState('');
  const [unhatched, setUnhatched] = useState('');
  const [damaged, setDamaged] = useState('');
  const [chickGroupCode, setChickGroupCode] = useState('');
  const [breed, setBreed] = useState('');
  const [purpose, setPurpose] = useState('');

  const hatchedN = Number(hatched) || 0;
  const unhatchedN = Number(unhatched) || 0;
  const damagedN = Number(damaged) || 0;
  const total = hatchedN + unhatchedN + damagedN;

  const problems: string[] = [];
  if (date > today) problems.push('The date cannot be in the future');
  if (hatchedN < 0 || unhatchedN < 0 || damagedN < 0) problems.push('Counts cannot be negative');
  if (total !== batch.setQuantity) {
    problems.push(
      `${batch.code} set ${batch.setQuantity} egg(s); hatched + unhatched + damaged must add up to that`,
    );
  }
  if (hatchedN > 0 && !chickGroupCode.trim()) {
    problems.push('A code is needed for the new day-old-chick group');
  }

  function submit() {
    enqueue({
      kind: 'egg-hatch',
      label: `Hatch ${batch.code} · ${hatchedN} chicks`,
      payload: {
        incubationBatchId: batch.id,
        hatchedOn: date,
        hatchedCount: hatchedN,
        unhatchedCount: unhatchedN,
        damagedCount: damagedN,
        chickGroupCode: hatchedN > 0 ? chickGroupCode.trim() : undefined,
        breed: breed.trim() || undefined,
        purpose: purpose.trim() || undefined,
      },
    });
    void flush();
    onRecorded(`${batch.code} (${hatchedN} chicks)`);
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Record the hatch for ${batch.code}`}
      footer={
        <div className="row" style={{ gap: 'var(--sp-3)', justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={problems.length > 0} onClick={submit}>
            Record hatch
          </button>
        </div>
      }
    >
      <div className="stack" style={{ gap: 'var(--sp-4)' }}>
        <p className="faint">{batch.setQuantity} egg(s) set on {formatDate(batch.setOn)}.</p>

        <label className="field">
          When?
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label className="field">
          Hatched
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={hatched}
            onChange={(e) => setHatched(e.target.value)}
          />
        </label>

        <label className="field">
          Unhatched
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={unhatched}
            onChange={(e) => setUnhatched(e.target.value)}
          />
        </label>

        <label className="field">
          Damaged
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={damaged}
            onChange={(e) => setDamaged(e.target.value)}
          />
        </label>

        {hatchedN > 0 ? (
          <>
            <label className="field">
              New chick group code
              <input
                value={chickGroupCode}
                onChange={(e) => setChickGroupCode(e.target.value)}
                placeholder="B-2026-006"
              />
            </label>
            <label className="field">
              Breed
              <input value={breed} onChange={(e) => setBreed(e.target.value)} placeholder="Optional — defaults to the parent flock's" />
            </label>
            <label className="field">
              Purpose
              <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Optional — defaults to Growers" />
            </label>
          </>
        ) : null}

        {problems.length > 0 ? (
          <div className="notice notice-error">
            <span>{problems[0]}</span>
          </div>
        ) : (
          <div className="notice notice-info">
            <span>If there is no signal this waits in the outbox and goes by itself.</span>
          </div>
        )}
      </div>
    </Sheet>
  );
}
