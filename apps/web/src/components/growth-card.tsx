'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Card } from './ui';
import { Sheet } from './sheet';
import {
  approveWeighing,
  recordWeighing,
  rejectWeighing,
  setHatchDate,
  type GrowthState,
} from '@/app/(app)/m/batch-profile-actions';

export interface WeighingRow {
  id: string;
  weighedOn: string;
  stage: string;
  ageDays: number;
  sampleSize: number;
  totalSampleWeightGrams: number;
  averageWeightGrams: number;
  unit: string;
  targetWeightGrams: number | null;
  varianceGrams: number | null;
  variancePercent: string | null;
  status: string;
  isCurrent: boolean;
  recordedBy: string;
  approvedBy: string | null;
  rejectionReason: string | null;
}

export interface BatchProfile {
  placedOn: string;
  hatchedOn: string | null;
  ageBasis: 'EXACT' | 'ESTIMATED' | 'PLACEMENT';
  ageDays: number;
  ageWeeks: string;
  ageMonths: string;
  configuredStage: string;
  suggestedStage: string | null;
  stageStatus: 'OK' | 'REVIEW' | 'NO_THRESHOLDS';
  population: number;
  current: WeighingRow | null;
  pending: WeighingRow[];
  biomassKg: string | null;
  averageDailyGainGrams: string | null;
  weighings: WeighingRow[];
  disposals: Array<{ occurredOn: string; quantity: number; method: string | null }>;
  deaths: { total: number; byCarcassDisposal: Record<string, number> };
  fcr: { value: string; feedKg: string; gainKg: string; from: string; to: string } | null;
  henDay: { percent: string; eggs: number; henDays: number; days: number } | null;
}

const CARCASS: Record<string, string> = {
  BURIED: 'Buried',
  BURNT: 'Burnt',
  RENDERED: 'Rendered',
  COLLECTED: 'Collected',
  OTHER: 'Other',
  NOT_RECORDED: 'Not recorded',
};

const BASIS: Record<BatchProfile['ageBasis'], string> = {
  EXACT: 'from hatch',
  ESTIMATED: 'from an estimated hatch date',
  PLACEMENT: 'since placement — hatch date not recorded',
};

/**
 * Age, stage, weight and live weight — the batch's biological master data.
 * Weighings are history: recorded, then approved or rejected by a supervisor,
 * never edited; the latest approved one is the current weight.
 */
export function GrowthCard({
  code,
  animals,
  profile,
  active,
  today,
  unit,
}: {
  code: string;
  animals: string;
  profile: BatchProfile;
  active: boolean;
  today: string;
  unit: 'g' | 'kg';
}) {
  const [open, setOpen] = useState<'weigh' | 'hatch' | null>(null);
  const [weighState, weighAction] = useActionState<GrowthState, FormData>(recordWeighing, { error: null, message: null });
  const [hatchState, hatchAction] = useActionState<GrowthState, FormData>(setHatchDate, { error: null, message: null });
  const [decision, setDecision] = useState<GrowthState>({ error: null, message: null });
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const weight = (grams: number) => (unit === 'kg' ? `${(grams / 1000).toFixed(3)} kg` : `${grams.toLocaleString('en-NG')} g`);
  const history = [...profile.weighings].reverse().slice(0, 10);

  const decide = (run: () => Promise<GrowthState>) =>
    startTransition(async () => {
      const outcome = await run();
      setDecision(outcome);
      if (!outcome.error) router.refresh();
    });

  return (
    <Card
      title="Growth"
      subtitle={`${profile.ageDays} days old (${profile.ageWeeks} weeks, ${profile.ageMonths} months) ${BASIS[profile.ageBasis]}`}
      action={
        active ? (
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            <button type="button" className="btn btn-sm" onClick={() => setOpen('hatch')}>
              Hatch date
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen('weigh')}>
              Weigh
            </button>
          </div>
        ) : null
      }
    >
      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        {profile.stageStatus === 'REVIEW' ? (
          <div className="notice notice-warning">
            Recorded as <strong>{profile.configuredStage}</strong>, but at {profile.ageDays} days the breed standard says{' '}
            <strong>{profile.suggestedStage ?? 'no stage yet'}</strong>. Check the age or move the {animals} to the right stage.
          </div>
        ) : null}

        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
          <Figure
            label="Current weight"
            value={profile.current ? weight(profile.current.averageWeightGrams) : '—'}
            hint={
              profile.current
                ? profile.current.targetWeightGrams
                  ? `target ${weight(profile.current.targetWeightGrams)} (${Number(profile.current.variancePercent) > 0 ? '+' : ''}${profile.current.variancePercent}%)`
                  : `approved ${profile.current.weighedOn}`
                : 'no approved weighing yet'
            }
          />
          <Figure
            label="Live weight on the farm"
            value={profile.biomassKg ? `${Number(profile.biomassKg).toLocaleString('en-NG', { maximumFractionDigits: 1 })} kg` : '—'}
            hint={`${profile.population.toLocaleString('en-NG')} ${animals} × current weight`}
          />
          <Figure
            label="Daily gain"
            value={profile.averageDailyGainGrams ? `${profile.averageDailyGainGrams} g` : '—'}
            hint="per animal, first to current weighing"
          />
          {profile.fcr ? (
            <Figure
              label="Feed conversion (FCR)"
              value={profile.fcr.value}
              hint={`${profile.fcr.feedKg} kg feed for ${profile.fcr.gainKg} kg gained, ${profile.fcr.from} to ${profile.fcr.to}`}
            />
          ) : null}
          {profile.henDay ? (
            <Figure
              label="Hen-day"
              value={`${profile.henDay.percent}%`}
              hint={`${profile.henDay.eggs.toLocaleString('en-NG')} eggs over ${profile.henDay.days} days`}
            />
          ) : null}
          <Figure
            label="Stage"
            value={profile.configuredStage}
            hint={profile.stageStatus === 'NO_THRESHOLDS' ? 'no breed thresholds set up' : profile.stageStatus === 'OK' ? 'matches its age' : `age suggests ${profile.suggestedStage}`}
          />
        </div>

        {decision.error ? <div className="notice notice-error">{decision.error}</div> : null}
        {decision.message ? <div className="notice notice-success">{decision.message}</div> : null}

        {profile.pending.length > 0 ? (
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            <div className="faint" style={{ fontSize: 13 }}>Waiting for a supervisor</div>
            {profile.pending.map((w) => (
              <div key={w.id} className="row" style={{ gap: 'var(--sp-3)', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14 }}>
                  {w.weighedOn}: {w.sampleSize} weighed, average {weight(w.averageWeightGrams)}
                  {w.targetWeightGrams ? ` (target ${weight(w.targetWeightGrams)})` : ''} · by {w.recordedBy}
                </span>
                <span className="row" style={{ gap: 'var(--sp-2)' }}>
                  <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={() => decide(() => approveWeighing(w.id))}>
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={pending}
                    onClick={() => {
                      const reason = window.prompt('Why is this weighing rejected?') ?? '';
                      if (reason.trim()) decide(() => rejectWeighing(w.id, reason));
                    }}
                  >
                    Reject
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {history.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Weighed</th>
                  <th className="right">Age</th>
                  <th>Stage</th>
                  <th className="right">Sample</th>
                  <th className="right">Average</th>
                  <th className="right">vs target</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map((w) => (
                  <tr key={w.id}>
                    <td>{w.weighedOn}</td>
                    <td className="num right">{w.ageDays} d</td>
                    <td>{w.stage}</td>
                    <td className="num right">{w.sampleSize}</td>
                    <td className="num right">{weight(w.averageWeightGrams)}</td>
                    <td className="num right">{w.variancePercent === null ? '—' : `${Number(w.variancePercent) > 0 ? '+' : ''}${w.variancePercent}%`}</td>
                    <td>
                      <span
                        className={`badge ${w.isCurrent ? 'badge-success' : w.status === 'REJECTED' ? 'badge-danger' : w.status === 'PENDING' ? 'badge-warning' : ''}`}
                        title={w.rejectionReason ?? (w.approvedBy ? `by ${w.approvedBy}` : undefined)}
                      >
                        {w.isCurrent ? 'current' : w.status.toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {profile.deaths.total > 0 || profile.disposals.length > 0 ? (
          <div className="faint" style={{ fontSize: 13 }}>
            {profile.deaths.total > 0 ? (
              <div>
                Dead {animals}:{' '}
                {Object.entries(profile.deaths.byCarcassDisposal)
                  .map(([key, count]) => `${CARCASS[key] ?? key} ${count.toLocaleString('en-NG')}`)
                  .join(' · ')}
              </div>
            ) : null}
            {profile.disposals.length > 0 ? (
              <div>
                Left:{' '}
                {profile.disposals
                  .map((d) => `${d.quantity.toLocaleString('en-NG')} ${(d.method ?? 'not recorded').toLowerCase()} ${d.occurredOn}`)
                  .join(' · ')}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <Sheet open={open === 'weigh'} onClose={() => setOpen(null)} title={`Weigh ${code}`}>
        <form action={weighAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="code" value={code} />
          <p className="faint">
            Pick a handful at random from across the {animals === 'snails' ? 'pen' : 'house'}, weigh them together, and enter how
            many and what the scale said. A supervisor approves it before it becomes the current weight.
          </p>
          {weighState.error ? <div className="notice notice-error">{weighState.error}</div> : null}
          {weighState.message ? <div className="notice notice-success">{weighState.message}</div> : null}
          <label className="field">
            Weighed on
            <input name="weighedOn" type="date" defaultValue={today} min={profile.placedOn} max={today} required />
          </label>
          <label className="field">
            How many weighed
            <input name="sampleSize" type="number" min={1} max={profile.population} step={1} placeholder="e.g. 20" required />
          </label>
          <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1 }}>
              What they weighed together
              <input name="totalSampleWeight" type="number" min={0} step="any" placeholder={unit === 'kg' ? 'e.g. 44' : 'e.g. 1700'} required />
            </label>
            <label className="field" style={{ width: 90 }}>
              Unit
              <select name="unit" defaultValue={unit}>
                <option value="kg">kg</option>
                <option value="g">g</option>
              </select>
            </label>
          </div>
          <label className="field">
            Notes
            <input name="notes" type="text" placeholder="Optional" />
          </label>
          <Submit label="Record weighing" />
        </form>
      </Sheet>

      <Sheet open={open === 'hatch'} onClose={() => setOpen(null)} title={`Hatch date for ${code}`}>
        <form action={hatchAction} className="stack" style={{ gap: 'var(--sp-4)' }}>
          <input type="hidden" name="code" value={code} />
          <p className="faint">
            Age counts from the hatch date when it is known — a point-of-lay pullet bought at 16 weeks is not a day old on
            arrival. Leave it blank to count from placement.
          </p>
          {hatchState.error ? <div className="notice notice-error">{hatchState.error}</div> : null}
          {hatchState.message ? <div className="notice notice-success">{hatchState.message}</div> : null}
          <label className="field">
            Hatched on
            <input name="hatchedOn" type="date" defaultValue={profile.hatchedOn ?? ''} max={profile.placedOn} />
          </label>
          <label className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
            <input type="checkbox" name="estimated" defaultChecked={profile.ageBasis === 'ESTIMATED'} />
            This date is an estimate (the vendor&rsquo;s word, or worked back from size)
          </label>
          <Submit label="Save hatch date" />
        </form>
      </Sheet>
    </Card>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 12 }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
      <div className="faint" style={{ fontSize: 12 }}>{hint}</div>
    </div>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : label}
    </button>
  );
}
