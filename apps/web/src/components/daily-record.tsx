'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  defaultFeedFor,
  getModule,
  title,
  type ModuleKey,
  type SpeciesModule,
} from '@/lib/modules';
import type { BatchSummary } from '@/lib/demo';
import { enqueue, flush } from '@/lib/sync-queue';
import { translator } from '@/lib/i18n';
import { compressPhoto, formatBytes, type CapturedPhoto } from '@/lib/photo';
import type { LanguageCode } from '@/lib/farm-config';
import { Card, PageHeader } from './ui';
import { Sheet } from './sheet';

/**
 * The daily round — what happened today, house by house.
 *
 * Modelled on the walk, not on the database. A worker does not open a list and
 * choose a batch; they go to the first house, record what they see, and move to
 * the next. So the screen is a sequence of stops, one per house, and the
 * position in that sequence is the primary state.
 *
 * Everything else follows from where it is filled in — standing in a pen,
 * one-handed, on a bad connection, by someone who is not an accountant:
 *
 *   · Steppers with 44px targets, because tapping beats typing in gloves — but
 *     the field stays typeable, because nobody reaches 1,600 eggs by tapping.
 *   · Numeric keypads on every count.
 *   · Causes as chips, not a dropdown: one tap, options visible without opening.
 *   · A sticky bar carrying the walk forward, so it is never scrolled away.
 *   · Every stop's entry is kept, so going back to correct one loses nothing.
 *   · Nothing is entered twice. Feed issued moves inventory; mortality moves the
 *     population. The review shows both, for the whole round at once.
 *
 * A stop can hold more than one population — two batches in the same house are
 * recorded while the worker is standing there, not on two separate visits.
 *
 * Which numbers exist comes from the module registry, so this same screen
 * collects cracked eggs for poultry and harvest weight for snails.
 */

interface Draft {
  feedType: string;
  feedKg: number;
  production: Record<string, number>;
  deaths: number;
  /** More than one when the farm allows it — a die-off is rarely one thing. */
  causes: string[];
  /** Set when the figures were carried over rather than observed. */
  carriedOver: boolean;
  /**
   * The photograph itself, downscaled, not just its name.
   *
   * It used to hold the filename alone, which meant the picture was discarded
   * the moment it was taken and the record carried a reference to a file that
   * existed nowhere. If the photograph is to be any use it has to travel with
   * the round.
   */
  photo: CapturedPhoto | null;
  notes: string;
}

/**
 * A blank entry for one population, with the feed that suits it already
 * chosen — a 31-day broiler opens on finisher, a laying hen on layer mash.
 * Picking it four times a morning is how the wrong one eventually gets picked.
 *
 * `feedNames`, when the company has configured any, are the ONLY names that
 * price and move inventory — see `getFeedItemNames`. The generic suggestion
 * from the species registry still picks which one sounds right for this
 * population; it just has to land on a name the farm actually stocks.
 */
function emptyDraft(module: SpeciesModule, feedNames: string[], group?: BatchSummary): Draft {
  const suggested = group ? defaultFeedFor(module, group) : (module.feedTypes[0]?.name ?? '');
  const feedType =
    feedNames.length === 0
      ? suggested
      : (feedNames.find((name) => name.toLowerCase() === suggested.toLowerCase()) ??
        feedNames.find(
          (name) =>
            name.toLowerCase().includes(suggested.toLowerCase()) ||
            suggested.toLowerCase().includes(name.toLowerCase()),
        ) ??
        feedNames[0] ??
        suggested);
  return {
    feedType,
    feedKg: 0,
    production: {},
    deaths: 0,
    causes: [],
    carriedOver: false,
    photo: null,
    notes: '',
  };
}

function hasContent(draft: Draft | undefined): boolean {
  if (!draft) return false;
  return (
    draft.feedKg > 0 ||
    draft.deaths > 0 ||
    Object.values(draft.production).some((value) => value > 0)
  );
}

export function DailyRecordEntry({
  moduleKey,
  groups,
  feedItemNames,
  today,
  startAt,
  collectionLabels,
  mortalityPhoto = 'optional',
  multipleCauses = true,
  sameAsYesterday = false,
  explainOutliers = false,
  yesterday,
  language = 'en',
}: {
  /*
   * The KEY, not the module object. Module entries carry icon components, and
   * React cannot serialise a function across the server/client boundary — the
   * page fails outright with "Functions cannot be passed directly to Client
   * Components". The client imports the registry itself, same as the sidebar.
   */
  moduleKey: ModuleKey;
  groups: BatchSummary[];
  /**
   * The company's own feed items (§5, `isBiologicalFeed`). Empty for a farm
   * that has not set any up yet, in which case the picker falls back to the
   * generic species list rather than being empty outright.
   */
  feedItemNames: string[];
  today: string;
  /** Population to open on, when arriving from that population's own page. */
  startAt?: string;
  /**
   * The farm's own settings. What gets asked for on this screen is the farm's
   * decision, not the product's.
   */
  collectionLabels?: string[];
  mortalityPhoto?: 'off' | 'optional' | 'required';
  multipleCauses?: boolean;
  /** Offer yesterday's figures as a starting point. */
  sameAsYesterday?: boolean;
  /** Ask for a note when a figure is far from the norm. */
  explainOutliers?: boolean;
  /** What was recorded yesterday, keyed by population. */
  yesterday?: Record<string, { feedKg: number; production: Record<string, number> }>;
  /**
   * The language of the PEN, not the office. The person filling this in at 6am
   * may not be the person who reads the trial balance.
   */
  language?: LanguageCode;
}) {
  const module = getModule(moduleKey)!;
  const t = module.terms;
  const say = translator(language);

  /**
   * What the feed picker actually offers: one entry per THIS species'
   * generic feed type, each swapped for a real item when the farm has one
   * that matches — never a real item wholesale, and never company-wide.
   *
   * `feedItemNames` is every biological-feed item on the company, with no
   * species of its own to filter by (the item master carries none) — a
   * mixed poultry-and-snail farm's one real "Chick Mash" item is not a
   * snail's default anything. Replacing the whole generic list with it the
   * moment ANY real item existed made it worse two ways at once: a snail
   * round defaulted to a poultry item, and a poultry farm with only ONE
   * real item (say, Chick Mash) lost every other stage — Layer mash,
   * Broiler starter — from the picker entirely, with no way to record them
   * until an item existed for every single one. Matching per generic type
   * instead keeps every stage selectable, priced wherever a real item
   * exists for it and left as the old, honestly-unpriced placeholder
   * everywhere else — same fallback this already had, just scoped to the
   * one generic type it actually replaces instead of the whole list.
   */
  const feedNames = [
    ...new Set(
      module.feedTypes.map((generic) => {
        const lower = generic.name.toLowerCase();
        const match =
          feedItemNames.find((name) => name.toLowerCase() === lower) ??
          feedItemNames.find(
            (name) => name.toLowerCase().includes(lower) || lower.includes(name.toLowerCase()),
          );
        return match ?? generic.name;
      }),
    ),
  ];

  /**
   * The fields a worker fills in, expanded for how often this farm collects.
   *
   * A farm collecting three times a day gets three whole-egg entries, not one:
   * asking for a single daily figure makes the worker add up in their head, and
   * that is where egg counts go wrong. A farm collecting once sees one field
   * and is not made to answer a question it does not have.
   */
  const fields = useMemo(() => {
    const labels = collectionLabels ?? [];
    if (labels.length <= 1) return module.productionFields;

    return module.productionFields.flatMap((field) =>
      // Only the primary output splits by collection. Cracked and dirty are
      // counted once, when the eggs are graded.
      field.key === module.productionFields[0]?.key
        ? labels.map((label) => ({
            ...field,
            key: `${field.key}:${label.toLowerCase()}`,
            label: `${field.label} — ${label}`,
          }))
        : [field],
    );
  }, [module.productionFields, collectionLabels]);

  /**
   * The round: one stop per location, in a stable order so the walk is the same
   * every morning and muscle memory works.
   */
  const stops = useMemo(() => {
    const byHouse = new Map<string, BatchSummary[]>();
    for (const group of groups) {
      const existing = byHouse.get(group.house);
      if (existing) existing.push(group);
      else byHouse.set(group.house, [group]);
    }
    return [...byHouse.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([house, members]) => ({
        house,
        groups: [...members].sort((a, b) => a.code.localeCompare(b.code)),
      }));
  }, [groups]);

  const [date, setDate] = useState(today);
  const [stopIndex, setStopIndex] = useState(() => {
    if (!startAt) return 0;
    const index = stops.findIndex((candidate) =>
      candidate.groups.some((group) => group.id === startAt),
    );
    return index === -1 ? 0 : index;
  });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reviewing, setReviewing] = useState(false);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [submitted, setSubmitted] = useState<number | null>(null);

  const storageKey = `bap.round.${moduleKey}`;

  /*
   * Restore an unfinished round.
   *
   * A round is half an hour of walking. Losing it to a locked screen, a dropped
   * connection or a mis-tapped back button would mean walking it again, and a
   * worker who has been burned once starts keeping a paper notebook as
   * insurance — which is the failure this product exists to end.
   *
   * Read after mount rather than during render: the server has no localStorage,
   * and initialising state from it would hydrate to different markup.
   */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as {
          date?: string;
          stopIndex?: number;
          drafts?: Record<string, Draft>;
          savedAt?: string;
        };
        if (saved.drafts && Object.keys(saved.drafts).length > 0) {
          /*
           * A draft saved before photographs were kept holds a bare filename
           * where the picture now goes. Reading one of those back would put a
           * string where the code expects an object and take the screen down on
           * a phone that is mid-round, so anything of the wrong shape is
           * dropped — the numbers matter more than the picture.
           */
          setDrafts(
            Object.fromEntries(
              Object.entries(saved.drafts).map(([id, draft]) => [
                id,
                {
                  ...draft,
                  photo:
                    draft.photo && typeof draft.photo === 'object' && draft.photo.dataUrl
                      ? draft.photo
                      : null,
                },
              ]),
            ),
          );
          if (saved.date) setDate(saved.date);
          // An explicit `at` beats the saved position: the user just asked for
          // a specific house, and dropping them somewhere else would be wrong.
          if (!startAt && typeof saved.stopIndex === 'number') setStopIndex(saved.stopIndex);
          setRestoredAt(saved.savedAt ?? null);
        }
      }
    } catch {
      // A corrupt or unreadable draft must not take the page down with it.
    }
    setHydrated(true);
  }, [storageKey]);

  // Persist after every change. Guarded on `hydrated` so the empty initial
  // state cannot overwrite a stored round before it has been read back.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (Object.keys(drafts).length === 0) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ date, stopIndex, drafts, savedAt: new Date().toISOString() }),
      );
    } catch {
      /*
       * Nearly always the quota — and now that photographs are held in the
       * draft that is a real prospect rather than a theoretical one. Try again
       * without them. The numbers are what the worker walked the houses for,
       * and a backup missing its pictures is worth incomparably more than no
       * backup at all.
       */
      try {
        const withoutPhotos = Object.fromEntries(
          Object.entries(drafts).map(([id, draft]) => [id, { ...draft, photo: null }]),
        );
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            date,
            stopIndex,
            drafts: withoutPhotos,
            savedAt: new Date().toISOString(),
          }),
        );
      } catch {
        // Private browsing, or full even without them. Nothing further to try;
        // the round in progress is still intact in memory.
      }
    }
  }, [hydrated, storageKey, date, stopIndex, drafts]);

  /**
   * Is this figure well away from what the same population did yesterday?
   *
   * Thirty percent is wide on purpose. The point is to catch a slipped decimal
   * or a mis-typed digit, not to interrogate ordinary daily variation — a
   * prompt that fires constantly is a prompt people learn to dismiss.
   */
  function isOutlier(groupId: string, draft: Draft): boolean {
    const previous = yesterday?.[groupId];
    if (!previous) return false;

    const compare = (now: number, before: number) =>
      before > 0 && now > 0 && Math.abs(now - before) / before > 0.3;

    if (compare(draft.feedKg, previous.feedKg)) return true;
    return Object.entries(draft.production).some(([key, value]) =>
      compare(value, previous.production[key] ?? 0),
    );
  }

  const stop = stops[stopIndex];

  function groupById(groupId: string): BatchSummary | undefined {
    return groups.find((candidate) => candidate.id === groupId);
  }

  function draftFor(groupId: string): Draft {
    return drafts[groupId] ?? emptyDraft(module, feedNames, groupById(groupId));
  }

  function update(groupId: string, change: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [groupId]: {
        ...(current[groupId] ?? emptyDraft(module, feedNames, groupById(groupId))),
        ...change,
      },
    }));
  }

  /** Functional so rapid taps cannot compute from a stale value. */
  function adjust(groupId: string, field: 'feedKg' | 'deaths', delta: number) {
    setDrafts((current) => {
      const draft = current[groupId] ?? emptyDraft(module, feedNames, groupById(groupId));
      return {
        ...current,
        [groupId]: { ...draft, [field]: Math.max(0, draft[field] + delta) },
      };
    });
  }

  /**
   * Toggle a cause of death.
   *
   * Functional, for exactly the reason the steppers are: computing the next
   * array from the `draft` captured at render means two taps batched into one
   * render both start from the same value, and the second silently discards the
   * first. Selecting two causes then only recorded the last one.
   */
  function toggleCause(groupId: string, option: string, allowMultiple: boolean) {
    setDrafts((current) => {
      const draft = current[groupId] ?? emptyDraft(module, feedNames, groupById(groupId));
      const has = draft.causes.includes(option);
      const causes = has
        ? draft.causes.filter((entry) => entry !== option)
        : allowMultiple
          ? [...draft.causes, option]
          : [option];
      return { ...current, [groupId]: { ...draft, causes } };
    });
  }

  function adjustProduction(groupId: string, key: string, delta: number) {
    setDrafts((current) => {
      const draft = current[groupId] ?? emptyDraft(module, feedNames, groupById(groupId));
      return {
        ...current,
        [groupId]: {
          ...draft,
          production: {
            ...draft.production,
            [key]: Math.max(0, (draft.production[key] ?? 0) + delta),
          },
        },
      };
    });
  }

  function discardRound() {
    setDrafts({});
    setStopIndex(0);
    setRestoredAt(null);
    setReviewing(false);
  }

  /**
   * Hand the round to the outbox and clear the workspace.
   *
   * The round is NOT posted from here. It goes into a durable queue with an
   * idempotency key and is sent when there is a connection — which is the only
   * arrangement that works in a pen with no signal. The worker is told it is
   * queued, never that it is saved, and the outbox in the header stays visible
   * until the server has confirmed it.
   */
  function submitRound() {
    const recorded = groups
      .filter((group) => hasContent(drafts[group.id]))
      .map((group) => {
        const draft = draftFor(group.id);
        return {
          groupId: group.id,
          groupCode: group.code,
          house: group.house,
          feedType: draft.feedType,
          feedKg: draft.feedKg,
          production: draft.production,
          deaths: draft.deaths,
          causes: draft.causes,
          photo: draft.photo,
          carriedOver: draft.carriedOver,
          notes: draft.notes,
        };
      });

    enqueue({
      kind: 'daily-round',
      label: `${module.productName} round · ${date} · ${recorded.length} ${
        recorded.length === 1 ? t.group.one : t.group.many
      }`,
      payload: { module: module.key, date, entries: recorded },
    });

    setReviewing(false);
    discardRound();
    setSubmitted(recorded.length);
    void flush();
  }

  /** A death with no cause, or more deaths than animals, blocks the round. */
  function problemFor(group: BatchSummary): string | null {
    const draft = drafts[group.id];
    if (!draft) return null;
    if (draft.deaths > group.population) {
      return `${draft.deaths.toLocaleString('en-NG')} is more than the ${group.population.toLocaleString('en-NG')} ${t.animal.many} here.`;
    }
    if (draft.deaths > 0 && draft.causes.length === 0) {
      return say('problem.pickCause');
    }
    if (draft.deaths > 0 && mortalityPhoto === 'required' && !draft.photo) {
      return say('problem.photoRequired');
    }
    // An outlier note is asked for while the person is still standing there,
    // which is the only moment the answer is cheap to get.
    if (explainOutliers && isOutlier(group.id, draft) && draft.notes.trim().length === 0) {
      return say('problem.explain');
    }
    return null;
  }

  const stopProblems = (stop?.groups ?? []).some((group) => problemFor(group) !== null);
  const anyProblem = groups.some((group) => problemFor(group) !== null);
  const recordedCount = groups.filter((group) => hasContent(drafts[group.id])).length;
  const isLastStop = stopIndex === stops.length - 1;

  if (stops.length === 0) {
    return (
      <>
        <PageHeader
          title={say('round.title')}
          subtitle={`No open ${t.group.many} to record against`}
        />
        <Card>
          <p className="muted">
            Record a {t.intake.toLowerCase()} first — a daily record belongs to a{' '}
            {t.group.one}.
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={say('round.title')}
        subtitle={`${module.productName} · ${stops.length} ${
          stops.length === 1 ? t.housing.one : t.housing.many
        } to visit`}
      />

      <div className="stack">
        {submitted !== null ? (
          <div className='notice notice-success' style={{ justifyContent: 'space-between' }}>
            <span>
              Round queued — {submitted} {submitted === 1 ? t.group.one : t.group.many}. It
              will send when there is a connection; watch the outbox in the header.
            </span>
            <button
              type='button'
              className='btn btn-ghost btn-sm'
              onClick={() => setSubmitted(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {restoredAt ? (
          <div className="notice notice-info" style={{ justifyContent: 'space-between' }}>
            <span>
              Picked up where you left off, saved{' '}
              {new Date(restoredAt).toLocaleTimeString('en-NG', {
                hour: '2-digit',
                minute: '2-digit',
              })}
              .
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={discardRound}
            >
              Start over
            </button>
          </div>
        ) : null}

        <Card>
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <label className="field">
              {say('round.date')}
              <input
                type="date"
                value={date}
                max={today}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>

            {/*
              The whole walk at a glance, and a way back to any stop. A worker
              who realises at house four that they mis-counted at house two
              needs one tap to get there, not four Backs.
            */}
            <div>
              <div className="field" style={{ marginBottom: 'var(--sp-2)' }}>
                {say('round.progress')}
              </div>
              <div className="rounds-progress" role="tablist" aria-label="Round stops">
                {stops.map((candidate, index) => {
                  const done = candidate.groups.some((group) => hasContent(drafts[group.id]));
                  const invalid = candidate.groups.some(
                    (group) => problemFor(group) !== null,
                  );
                  const state = invalid
                    ? 'invalid'
                    : index === stopIndex
                      ? 'current'
                      : done
                        ? 'done'
                        : 'pending';
                  return (
                    <button
                      key={candidate.house}
                      type="button"
                      role="tab"
                      aria-selected={index === stopIndex}
                      className="rounds-step"
                      data-state={state}
                      onClick={() => setStopIndex(index)}
                      title={candidate.house}
                    >
                      <span className="rounds-step-index">{index + 1}</span>
                      <span className="rounds-step-name">{candidate.house}</span>
                    </button>
                  );
                })}
              </div>
              <p className="faint" style={{ marginTop: 8 }}>
                {recordedCount} of {groups.length}{' '}
                {groups.length === 1 ? t.group.one : t.group.many} recorded
              </p>
            </div>
          </div>
        </Card>

        {stop ? (
          <>
            <div className="stop-heading">
              <div>
                <div className="faint">
                  Stop {stopIndex + 1} of {stops.length}
                </div>
                <h2>{stop.house}</h2>
              </div>
            </div>

            {stop.groups.map((group) => (
              <GroupEntry
                key={group.id}
                module={module}
                say={say}
                fields={fields}
                feedNames={feedNames}
                group={group}
                draft={draftFor(group.id)}
                problem={problemFor(group)}
                showCode={stop.groups.length > 1}
                mortalityPhoto={mortalityPhoto}
                multipleCauses={multipleCauses}
                {...(sameAsYesterday && yesterday?.[group.id]
                  ? { previous: yesterday[group.id] }
                  : {})}
                onChange={(change) => update(group.id, change)}
                onToggleCause={(option) => toggleCause(group.id, option, multipleCauses)}
                onAdjust={(field, delta) => adjust(group.id, field, delta)}
                onAdjustProduction={(key, delta) => adjustProduction(group.id, key, delta)}
              />
            ))}
          </>
        ) : null}

        <div className="entry-actions">
          <button
            type="button"
            className="btn"
            disabled={stopIndex === 0}
            onClick={() => setStopIndex((index) => Math.max(0, index - 1))}
          >
            {say('round.back')}
          </button>
          {isLastStop ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={recordedCount === 0 || anyProblem}
              onClick={() => setReviewing(true)}
            >
              {say('round.review')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={stopProblems}
              onClick={() => setStopIndex((index) => Math.min(stops.length - 1, index + 1))}
            >
              {hasContent(drafts[stop?.groups[0]?.id ?? ''])
                ? say('round.next')
                : say('round.skip')}
            </button>
          )}
        </div>

        {isLastStop && recordedCount === 0 ? (
          <p className="faint" style={{ textAlign: 'center' }}>
            {say('round.nothingYet')}
          </p>
        ) : null}
      </div>

      <Sheet
        open={reviewing}
        onClose={() => setReviewing(false)}
        title="Review round"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setReviewing(false)}>
              {say('round.back')}
            </button>
            <button type="button" className="btn btn-primary" onClick={submitRound}>
              Submit round
            </button>
          </>
        }
      >
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <div className="notice notice-info">
            Submitting puts this round in the outbox on this device, where it is safe
            and keyed so it can never post twice. It will send when there is a
            connection.
          </div>

          <Line label="Date" value={date} />

          {stops.map((candidate) => {
            const recorded = candidate.groups.filter((group) => hasContent(drafts[group.id]));
            if (recorded.length === 0) return null;
            return (
              <div key={candidate.house}>
                <div className="faint" style={{ marginBottom: 6 }}>
                  {candidate.house.toUpperCase()}
                </div>
                {recorded.map((group) => {
                  const draft = draftFor(group.id);
                  return (
                    <div key={group.id} style={{ marginBottom: 'var(--sp-3)' }}>
                      {candidate.groups.length > 1 ? (
                        <div className="faint">{group.code}</div>
                      ) : null}
                      {draft.feedKg > 0 ? (
                        <Line label={draft.feedType} value={`${draft.feedKg} kg`} />
                      ) : null}
                      {fields.map((field) => {
                        const value = draft.production[field.key] ?? 0;
                        if (value === 0) return null;
                        return (
                          <Line
                            key={field.key}
                            label={field.label}
                            value={`${value.toLocaleString('en-NG')}${
                              field.unit ? ` ${field.unit}` : ''
                            }`}
                          />
                        );
                      })}
                      {draft.deaths > 0 ? (
                        <Line
                          label={`${title(t.animal.many)} lost`}
                          value={`${draft.deaths} · ${draft.causes.join(', ')} · ${group.population.toLocaleString(
                            'en-NG',
                          )} → ${(group.population - draft.deaths).toLocaleString('en-NG')}`}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            );
          })}

          <div>
            <div className="faint" style={{ marginBottom: 6 }}>
              ROUND TOTAL
            </div>
            <Line
              label="Feed issued"
              value={`${groups
                .reduce((sum, group) => sum + draftFor(group.id).feedKg, 0)
                .toLocaleString('en-NG')} kg`}
            />
            <Line
              label={`${title(t.animal.many)} lost`}
              value={groups
                .reduce((sum, group) => sum + draftFor(group.id).deaths, 0)
                .toLocaleString('en-NG')}
            />
            {fields.map((field) => {
              const total = groups.reduce(
                (sum, group) => sum + (draftFor(group.id).production[field.key] ?? 0),
                0,
              );
              if (total === 0) return null;
              return (
                <Line
                  key={field.key}
                  label={field.label}
                  value={`${total.toLocaleString('en-NG')}${field.unit ? ` ${field.unit}` : ''}`}
                />
              );
            })}
          </div>

          <div>
            <div className="faint" style={{ marginBottom: 6 }}>
              EFFECT ON THE LEDGER
            </div>
            {/*
              The point of the architecture, made concrete: one morning's walk
              is both an operational fact and an accounting one. Each stop posts
              against its own population, which is why cost lands on the right
              batch rather than in a pool. Amounts are omitted rather than
              invented — they come from the feed's issue price, which this
              screen does not know.
            */}
            {/* In walk order, matching the sections above — the same list read
                twice in two different orders invites a reconciliation error. */}
            {stops
              .flatMap((candidate) => candidate.groups)
              .filter((group) => draftFor(group.id).feedKg > 0)
              .map((group) => (
                <Line
                  key={group.id}
                  label={`Dr Work in progress · ${group.code}`}
                  value="Cr Feed inventory"
                />
              ))}
            <p className="faint" style={{ marginTop: 6 }}>
              Valued at the feed&apos;s issue price when this is wired up, so each{' '}
              {t.group.one}&apos;s cost stays in step with the general ledger.
            </p>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function GroupEntry({
  module,
  say,
  fields,
  feedNames,
  mortalityPhoto,
  multipleCauses,
  previous,
  group,
  draft,
  problem,
  showCode,
  onChange,
  onToggleCause,
  onAdjust,
  onAdjustProduction,
}: {
  module: SpeciesModule;
  say: ReturnType<typeof translator>;
  /** Expanded for this farm's collection times — see the caller. */
  fields: SpeciesModule['productionFields'];
  /** What the feed picker offers — see `DailyRecordEntry`'s own prop. */
  feedNames: string[];
  mortalityPhoto: 'off' | 'optional' | 'required';
  multipleCauses: boolean;
  /** Yesterday's figures, when the farm has that shortcut switched on. */
  previous?: { feedKg: number; production: Record<string, number> };
  group: BatchSummary;
  draft: Draft;
  problem: string | null;
  showCode: boolean;
  onChange: (change: Partial<Draft>) => void;
  onToggleCause: (option: string) => void;
  onAdjust: (field: 'feedKg' | 'deaths', delta: number) => void;
  onAdjustProduction: (key: string, delta: number) => void;
}) {
  const t = module.terms;

  return (
    <>
      <Card
        title={showCode ? group.code : 'Feed'}
        subtitle={
          showCode
            ? `${group.breed} · ${group.population.toLocaleString('en-NG')} ${t.animal.many}`
            : `${group.code} · ${group.population.toLocaleString('en-NG')} ${t.animal.many} · ${group.breed}`
        }
      >
        {showCode ? (
          <div className="field" style={{ marginBottom: 'var(--sp-4)', fontWeight: 600 }}>
            Feed
          </div>
        ) : null}
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <label className="field">
            {say('feed.type')}
            <select
              value={draft.feedType}
              onChange={(event) => onChange({ feedType: event.target.value })}
            >
              {feedNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <div className="entry-row" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <div className="entry-label">
              <div className="entry-label-text">{say('feed.quantity')}</div>
              <div className="faint">{say('feed.reducesStock')}</div>
            </div>
            <Stepper
              value={draft.feedKg}
              step={5}
              unit="kg"
              label={`Feed quantity ${group.code}`}
              onChange={(feedKg) => onChange({ feedKg })}
              onAdjust={(delta) => onAdjust('feedKg', delta)}
            />
          </div>
        </div>
      </Card>

      <Card
        title={module.terms.productionRecord}
        {...(previous
          ? {
              action: (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() =>
                    onChange({
                      feedKg: previous.feedKg,
                      production: { ...previous.production },
                      carriedOver: true,
                    })
                  }
                >
                  {say('round.sameAsYesterday')}
                </button>
              ),
            }
          : {})}
      >
        {/*
          Carried-over figures are marked, always. The shortcut saves a great
          deal of tapping and carries a real risk — someone accepting yesterday
          without looking produces plausible numbers that are wrong, which is
          worse than no numbers. Flagging them means the variance watch and
          anyone reading the record can tell the difference.
        */}
        {draft.carriedOver ? (
          <div className="notice notice-warning" style={{ marginBottom: 'var(--sp-4)' }}>
            <span>{say('round.carriedOver')}</span>
          </div>
        ) : null}
        {fields.map((field) => (
          <div className="entry-row" key={field.key}>
            <div className="entry-label">
              <div className="entry-label-text">{field.label}</div>
              {field.hint ? <div className="faint">{field.hint}</div> : null}
            </div>
            <Stepper
              value={draft.production[field.key] ?? 0}
              step={field.step}
              {...(field.unit ? { unit: field.unit } : {})}
              label={`${field.label} ${group.code}`}
              onChange={(value) =>
                onChange({ production: { ...draft.production, [field.key]: value } })
              }
              onAdjust={(delta) => onAdjustProduction(field.key, delta)}
            />
          </div>
        ))}
      </Card>

      <Card title={say('mortality.title')}>
        <div className="entry-row">
          <div className="entry-label">
            <div className="entry-label-text">{say('mortality.lost')}</div>
            <div className="faint">{say('mortality.reducesPopulation')}</div>
          </div>
          <Stepper
            value={draft.deaths}
            step={1}
            label={`Deaths ${group.code}`}
            onChange={(deaths) => onChange({ deaths })}
            onAdjust={(delta) => onAdjust('deaths', delta)}
          />
        </div>

        {draft.deaths > 0 ? (
          <div style={{ paddingTop: 'var(--sp-4)' }}>
            <div className="field" style={{ marginBottom: 'var(--sp-2)' }}>
              {say('mortality.cause')}
            </div>
            {mortalityPhoto !== 'off' ? (
              <label className="field" style={{ marginBottom: 'var(--sp-4)' }}>
                {say('mortality.photo')}
                {draft.photo ? ' — taken' : mortalityPhoto === 'required' ? ' — required' : ''}
                {/*
                  `capture` opens the camera straight away rather than a file
                  browser. A photograph settles an argument about what happened
                  and gives the vet something to look at, and it is only worth
                  anything if taking it is one tap.
                */}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) {
                      onChange({ photo: null });
                      return;
                    }
                    /*
                     * Shrunk before it is held. A phone photograph is several
                     * megabytes and the outbox has a few in total for
                     * everything — storing one whole would push the round the
                     * worker just recorded out of storage.
                     */
                    void compressPhoto(file).then((photo) => onChange({ photo }));
                  }}
                />
                {draft.photo ? (
                  <span className="row" style={{ gap: 'var(--sp-3)' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, not a served asset */}
                    <img
                      src={draft.photo.dataUrl}
                      alt=""
                      width={44}
                      height={44}
                      style={{ objectFit: 'cover', borderRadius: 'var(--radius-sm)' }}
                    />
                    <span className="faint">
                      {draft.photo.name} · {formatBytes(draft.photo.bytes)} · kept with this
                      record
                    </span>
                  </span>
                ) : null}
              </label>
            ) : null}

            <div className="chip-row" role="group" aria-label={`Cause of death ${group.code}`}>
              {module.mortalityCauses.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="chip"
                  aria-pressed={draft.causes.includes(option)}
                  onClick={() => onToggleCause(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {problem ? (
          <div className="notice notice-error" style={{ marginTop: 'var(--sp-4)' }}>
            {problem}
          </div>
        ) : null}
      </Card>

      <Card title={say('notes.title')} subtitle={say('notes.optional')}>
        <textarea
          rows={2}
          value={draft.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          placeholder={say('notes.placeholder')}
        />
      </Card>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="row"
      style={{ justifyContent: 'space-between', gap: 'var(--sp-4)', padding: '5px 0' }}
    >
      <span className="muted" style={{ fontSize: 14 }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function Stepper({
  value,
  step,
  unit,
  label,
  onChange,
  onAdjust,
}: {
  value: number;
  step: number;
  unit?: string;
  label: string;
  /** Typing sets an absolute value. */
  onChange: (value: number) => void;
  /**
   * Tapping adjusts relatively.
   *
   * Separate from onChange on purpose: `onChange(value + step)` reads the
   * `value` captured at render, so several taps batched into one render all
   * compute from the same stale number and increments are silently lost. A
   * delta lets the parent apply a functional update, which cannot drift.
   */
  onAdjust: (delta: number) => void;
}) {
  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper-btn"
        aria-label={`Decrease ${label}`}
        title={`Decrease ${label}`}
        disabled={value <= 0}
        onClick={() => onAdjust(-step)}
      >
        −
      </button>
      <input
        // `inputMode` rather than `type="number"`: it raises the numeric keypad
        // without the spinner, the scroll-wheel-changes-the-value trap, or
        // Safari's habit of accepting "e" as valid input.
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={label}
        value={value === 0 ? '' : String(value)}
        placeholder="0"
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '');
          onChange(digits === '' ? 0 : Number(digits));
        }}
      />
      <button
        type="button"
        className="stepper-btn"
        aria-label={`Increase ${label}`}
        title={`Increase ${label}`}
        onClick={() => onAdjust(step)}
      >
        +
      </button>
      <span className="stepper-unit">{unit ?? ''}</span>
    </div>
  );
}
