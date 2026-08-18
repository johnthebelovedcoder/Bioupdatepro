'use client';

import { useState, useTransition } from 'react';
import { resetSettings, saveSettings } from '@/app/(app)/settings/actions';
import { NEEDS_REVIEW } from '@/lib/i18n';
import {
  LANGUAGES,
  type AlertChannel,
  type FarmConfig,
  type Provenance,
} from '@/lib/farm-config';
import { formatNaira, parseNairaToKobo } from '@/lib/money';
import { Card, PageHeader } from './ui';
import { Tabs, SETUP_TABS } from './tabs';

/**
 * Everything about how this farm works.
 *
 * Grouped by the question each answers rather than by the shape of the data,
 * and worded for the person who runs the farm: "Watching for losses" rather
 * than "Variance thresholds".
 *
 * The provenance badge beside a default is the important detail. A farm needs
 * to know whether a number came from a breeder's guide, from ordinary practice,
 * or is a placeholder that means nothing until they set it — those are three
 * very different levels of trust, and showing them identically would be the
 * dishonest choice.
 */
const SECTIONS = [
  { key: 'farm', label: 'The farm' },
  { key: 'daily', label: 'Daily work' },
  { key: 'feed', label: 'Feed & stock' },
  { key: 'losses', label: 'Watching for losses' },
  { key: 'standards', label: 'Breed standards' },
  { key: 'alerts', label: 'Who gets told' },
  { key: 'selling', label: 'Selling' },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

export function SettingsForm({ config }: { config: FarmConfig }) {
  const [section, setSection] = useState<SectionKey>('farm');
  const [draft, setDraft] = useState<FarmConfig>(config);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  function set<K extends keyof FarmConfig>(key: K, value: FarmConfig[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        // Only the sections a farm can actually change are sent. Breed standards
        // are large and read-only here, so they never enter the payload.
        await saveSettings({
          organisation: draft.organisation,
          operations: draft.operations,
          feed: draft.feed,
          variance: draft.variance,
          sales: draft.sales,
          alerts: draft.alerts,
        });
        setSaved(true);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not save.');
      }
    });
  }

  return (
    <>
      <PageHeader
        title="Farm setup"
        subtitle="How this farm works. Everything the system decides for you is set here."
      />

      <Tabs tabs={SETUP_TABS} />

      <div className="stack">
        <div className="segmented" role="group" aria-label="Settings section">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className="segmented-option"
              aria-pressed={section === item.key}
              onClick={() => setSection(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {saved ? (
          <div className="notice notice-success">
            Saved. Every screen now uses these settings.
          </div>
        ) : null}
        {error ? <div className="notice notice-error">{error}</div> : null}

        {section === 'farm' ? <FarmSection draft={draft} set={set} /> : null}
        {section === 'daily' ? <DailySection draft={draft} set={set} /> : null}
        {section === 'feed' ? <FeedSection draft={draft} set={set} /> : null}
        {section === 'losses' ? <LossesSection draft={draft} set={set} /> : null}
        {section === 'standards' ? <StandardsSection draft={draft} /> : null}
        {section === 'alerts' ? <AlertsSection draft={draft} set={set} /> : null}
        {section === 'selling' ? <SellingSection draft={draft} set={set} /> : null}

        <Card>
          <p className="faint" style={{ margin: 0 }}>
            Settings are stored on this device until the organisation record exists in the
            backend. They apply to every screen you open here, but a colleague on another
            phone will still see the defaults.
          </p>
        </Card>

        <div className="entry-actions">
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => startTransition(async () => { await resetSettings(); setDraft(config); })}
          >
            Reset to defaults
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || pending}
            onClick={save}
          >
            {pending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

type Setter = <K extends keyof FarmConfig>(key: K, value: FarmConfig[K]) => void;

function FarmSection({ draft, set }: { draft: FarmConfig; set: Setter }) {
  const org = draft.organisation;
  return (
    <Card title="The farm" subtitle="Name, money and language">
      <div className="stack" style={{ gap: 'var(--sp-4)' }}>
        <label className="field">
          Farm or company name
          <input
            value={org.name}
            onChange={(event) => set('organisation', { ...org, name: event.target.value })}
          />
        </label>

        <div className="grid-auto">
          {/*
            One option, on purpose.

            This offered cedi, shilling and dollar, and picking one changed
            nothing anywhere — every figure stayed in naira. Trading in another
            currency is not a formatting setting: amounts are held as integer
            kobo, VAT is a Nigerian rate, and a second currency needs a
            functional-versus-presentation currency and a translation rate on
            every posting. Offering the choice before that exists promises a
            farm something the ledger cannot honour.
          */}
          <label className="field">
            Currency
            <select value="NGN" disabled>
              <option value="NGN">Naira (₦)</option>
            </select>
            <span className="faint">
              Naira only for now. Other currencies need multi-currency accounting, which is
              not built.
            </span>
          </label>

          <label className="field">
            Financial year starts
            <select
              value={org.financialYearStartMonth}
              onChange={(event) =>
                set('organisation', {
                  ...org,
                  financialYearStartMonth: Number(event.target.value),
                })
              }
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid-auto">
          <label className="field">
            Office language
            <select
              value={org.language}
              onChange={(event) =>
                set('organisation', { ...org, language: event.target.value as never })
              }
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Language in the pens
            <select
              value={org.workerLanguage}
              onChange={(event) =>
                set('organisation', { ...org, workerLanguage: event.target.value as never })
              }
            >
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
            <span className="faint">
              The daily round can be in a different language from the office. The person
              standing in the house at 6am is who this setting is for.
            </span>
          </label>
        </div>
        {NEEDS_REVIEW.includes(org.language) || NEEDS_REVIEW.includes(org.workerLanguage) ? (
          <div className="notice notice-warning">
            <span>
              <strong>These words need checking by a native speaker.</strong> The Hausa,
              Yorùbá and Igbo wording was not written by one. Yorùbá and Igbo are tonal and
              the accents change meaning, and farm vocabulary varies by region. A wrong word
              on a deaths form produces wrong records, so have someone read it before your
              workers rely on it.
            </span>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function DailySection({ draft, set }: { draft: FarmConfig; set: Setter }) {
  const ops = draft.operations;
  return (
    <Card title="Daily work" subtitle="How the round is recorded">
      <div className="stack" style={{ gap: 'var(--sp-5)' }}>
        <label className="field">
          Egg collections per day
          <select
            value={ops.collectionsPerDay}
            onChange={(event) => {
              const count = Number(event.target.value);
              set('operations', {
                ...ops,
                collectionsPerDay: count,
                collectionLabels: COLLECTION_LABELS[count] ?? ['Collection'],
              });
            }}
          >
            <option value={1}>Once a day</option>
            <option value={2}>Twice — morning and evening</option>
            <option value={3}>Three times — morning, afternoon, evening</option>
          </select>
          <span className="faint">
            One entry per collection, added up by the system. Asking a worker for a single
            daily figure means they add it up in their head, and that is where egg counts
            go wrong.
          </span>
        </label>

        <label className="field">
          Photograph of deaths
          <select
            value={ops.mortalityPhoto}
            onChange={(event) =>
              set('operations', { ...ops, mortalityPhoto: event.target.value as never })
            }
          >
            <option value="off">Not asked for</option>
            <option value="optional">Optional</option>
            <option value="required">Required before the entry is accepted</option>
          </select>
          <span className="faint">
            A photograph settles a dispute about what happened and gives the vet something
            to look at.
          </span>
        </label>

        <Toggle
          label="Offer yesterday's figures"
          hint="Saves a great deal of tapping. Carries a risk: someone can accept them without looking. Carried-over values are always marked."
          checked={ops.sameAsYesterday}
          onChange={(value) => set('operations', { ...ops, sameAsYesterday: value })}
        />

        <Toggle
          label="Allow more than one cause of death"
          hint="A die-off is rarely one thing."
          checked={ops.multipleMortalityCauses}
          onChange={(value) => set('operations', { ...ops, multipleMortalityCauses: value })}
        />

        <Toggle
          label="Ask for a note when a figure looks unusual"
          hint="Catches the mis-typed number while the person is still standing there."
          checked={ops.explainOutliers}
          onChange={(value) => set('operations', { ...ops, explainOutliers: value })}
        />
      </div>
    </Card>
  );
}

function FeedSection({ draft, set }: { draft: FarmConfig; set: Setter }) {
  const feed = draft.feed;
  return (
    <Card title="Feed & stock" subtitle="When to warn you that feed is running out">
      <div className="stack" style={{ gap: 'var(--sp-4)' }}>
        <NumberField
          label="Days for feed to arrive after ordering"
          hint="This is what turns “240 kg left” into “order by Thursday”."
          value={feed.supplierLeadDays}
          onChange={(value) => set('feed', { ...feed, supplierLeadDays: value })}
          suffix="days"
        />
        <NumberField
          label="Warn me this many days before that"
          hint="Room to place the order without a rush."
          value={feed.runwayBufferDays}
          onChange={(value) => set('feed', { ...feed, runwayBufferDays: value })}
          suffix="days"
        />
        <NumberField
          label="Treat as an emergency below"
          value={feed.runwayCriticalDays}
          onChange={(value) => set('feed', { ...feed, runwayCriticalDays: value })}
          suffix="days of feed"
        />
        <NumberField
          label="Work out daily use from the last"
          hint="A longer window is steadier; a shorter one reacts faster when the flock grows."
          value={feed.consumptionWindowDays}
          onChange={(value) => set('feed', { ...feed, consumptionWindowDays: value })}
          suffix="days"
        />
      </div>
    </Card>
  );
}

function LossesSection({ draft, set }: { draft: FarmConfig; set: Setter }) {
  const variance = draft.variance;
  return (
    <Card
      title="Watching for losses"
      subtitle="Feed, eggs and animals that do not add up"
    >
      <div className="stack" style={{ gap: 'var(--sp-5)' }}>
        <div className="notice notice-info">
          <span>
            Compared against <strong>your own recent averages</strong>, not a book figure, so
            it learns how this farm actually runs. Set these too tight and it will cry wolf
            until you stop reading it; too loose and it will never fire. Only you can judge
            that.
          </span>
        </div>

        <Toggle
          label="Watch for figures that do not add up"
          checked={variance.enabled}
          onChange={(value) => set('variance', { ...variance, enabled: value })}
        />

        <NumberField
          label="Feed used per animal may differ by"
          hint="Above this, something is being over-fed, spilled, or is leaving the farm."
          value={variance.feedPerHeadTolerancePct}
          onChange={(value) => set('variance', { ...variance, feedPerHeadTolerancePct: value })}
          suffix="%"
        />
        <NumberField
          label="Production may fall short by"
          hint="Eggs that the flock size and age say should exist."
          value={variance.productionTolerancePct}
          onChange={(value) => set('variance', { ...variance, productionTolerancePct: value })}
          suffix="%"
        />
        <NumberField
          label="A stock count may differ from the books by"
          value={variance.stockCountTolerancePct}
          onChange={(value) => set('variance', { ...variance, stockCountTolerancePct: value })}
          suffix="%"
        />
        <NumberField
          label="Flag deaths above the recent average by"
          value={variance.mortalitySpikeMultiple}
          step={0.5}
          onChange={(value) => set('variance', { ...variance, mortalitySpikeMultiple: value })}
          suffix="×"
        />
        <NumberField
          label="Ignore groups smaller than"
          hint="Below this, ordinary variation swamps the signal."
          value={variance.minimumPopulation}
          onChange={(value) => set('variance', { ...variance, minimumPopulation: value })}
          suffix="animals"
        />
      </div>
    </Card>
  );
}

function StandardsSection({ draft }: { draft: FarmConfig }) {
  return (
    <Card
      title="Breed standards"
      subtitle="What your birds should be doing, so the system can tell you when they are not"
      padded={false}
    >
      <div className="card-body">
        <div className="notice notice-warning">
          <span>
            These come from breeders&apos; published guides and are a starting point, not
            your farm&apos;s truth. Nigerian conditions differ from the temperate ones most
            guides assume. Replace them with the guide for the stock you actually buy.
          </span>
        </div>
      </div>
      {draft.standards.map((standard) => (
        <div className="list-row" key={standard.id}>
          <div className="list-main">
            <div className="list-title">
              {standard.breed}{' '}
              <span className="faint">· {standard.purpose}</span>
            </div>
            <div className="list-sub">{standard.source}</div>
            <div className="faint">
              {standard.mortality.length > 0
                ? `Mortality curve · ${standard.mortality.length} points`
                : 'No curve set'}
              {standard.layRate ? ` · lay rate · ${standard.layRate.length} points` : ''}
              {standard.fcr ? ` · FCR · ${standard.fcr.length} points` : ''}
            </div>
          </div>
          <ProvenanceBadge provenance={standard.provenance} />
        </div>
      ))}
      <div className="card-footer">
        <span className="faint">
          Editing the curves themselves needs the settings endpoint — they are too large to
          keep on the device. Until then these are read-only.
        </span>
      </div>
    </Card>
  );
}

function AlertsSection({ draft, set }: { draft: FarmConfig; set: Setter }) {
  return (
    <Card
      title="Who gets told"
      subtitle="And how they hear about it"
      padded={false}
    >
      <div className="card-body">
        <div className="notice notice-info">
          <span>
            WhatsApp is how most farm business actually happens here, so it is a first-class
            channel rather than an afterthought. <strong>Nothing is sent automatically yet</strong>{' '}
            — the messaging integration is not built, so these choices are recorded and not
            acted on. What does work today is <strong>Send today&apos;s summary</strong> on the
            dashboard: it writes the message for you and hands it to WhatsApp, and you choose
            who it goes to.
          </span>
        </div>
      </div>

      {draft.alerts.map((rule, index) => (
        <div className="list-row" key={rule.kind} style={{ alignItems: 'flex-start' }}>
          <div className="list-main">
            <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
              <span className="list-title">{rule.label}</span>
              <Toggle
                compact
                label=""
                checked={rule.enabled}
                onChange={(value) => {
                  const next = [...draft.alerts];
                  next[index] = { ...rule, enabled: value };
                  set('alerts', next);
                }}
              />
            </div>
            <div className="list-sub">{rule.description}</div>
            <div className="chip-row" style={{ marginTop: 8 }}>
              {(['inApp', 'whatsapp', 'sms', 'email'] as AlertChannel[]).map((channel) => (
                <button
                  key={channel}
                  type="button"
                  className="chip"
                  aria-pressed={rule.channels.includes(channel)}
                  disabled={!rule.enabled}
                  onClick={() => {
                    const channels = rule.channels.includes(channel)
                      ? rule.channels.filter((item) => item !== channel)
                      : [...rule.channels, channel];
                    const next = [...draft.alerts];
                    next[index] = { ...rule, channels };
                    set('alerts', next);
                  }}
                >
                  {CHANNEL_LABELS[channel]}
                </button>
              ))}
            </div>
            <div className="faint" style={{ marginTop: 6 }}>
              Goes to: {rule.recipients.map(humanRole).join(', ') || 'nobody'}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}

function SellingSection({ draft, set }: { draft: FarmConfig; set: Setter }) {
  const sales = draft.sales;
  return (
    <Card title="Selling" subtitle="Terms, credit and when to sell">
      <div className="stack" style={{ gap: 'var(--sp-5)' }}>
        <NumberField
          label="Customers normally pay within"
          value={sales.defaultPaymentTermsDays}
          onChange={(value) => set('sales', { ...sales, defaultPaymentTermsDays: value })}
          suffix="days"
        />

        <MoneyField
          label="Warn before selling on credit above"
          hint="A customer already owing more than this needs a decision, not a default."
          valueKobo={sales.creditLimitKobo}
          onChange={(kobo) => set('sales', { ...sales, creditLimitKobo: kobo })}
        />

        <Toggle
          label="Allow gate sales without a customer record"
          hint="Cash at the gate is real. Refusing to record it means it goes unrecorded."
          checked={sales.allowWalkIn}
          onChange={(value) => set('sales', { ...sales, allowWalkIn: value })}
        />

        <Toggle
          label="Tell me when it is time to sell meat birds"
          hint="Once another day of feed costs more than the weight it adds, every further day loses money."
          checked={sales.sellAdviceEnabled}
          onChange={(value) => set('sales', { ...sales, sellAdviceEnabled: value })}
        />

        <MoneyField
          label="Market price per kg"
          hint="Update this as the market moves — the sell advice is only as good as this figure."
          valueKobo={sales.marketPricePerKgKobo}
          onChange={(kobo) => set('sales', { ...sales, marketPricePerKgKobo: kobo })}
        />
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const map: Record<Provenance, { label: string; tone: string; title: string }> = {
    published: {
      label: "breeder's guide",
      tone: 'badge-accent',
      title: 'From the breeder’s published management guide. Verify against your supplier.',
    },
    judgement: {
      label: 'common practice',
      tone: '',
      title: 'Ordinary commercial practice. Your farm may reasonably differ.',
    },
    placeholder: {
      label: 'not set',
      tone: 'badge-warning',
      title: 'A placeholder. It means nothing until you set it from your own records.',
    },
  };
  const item = map[provenance];
  return (
    <span className={`badge ${item.tone}`} title={item.title}>
      {item.label}
    </span>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  compact,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  compact?: boolean;
}) {
  return (
    <label className={compact ? 'row' : 'field'} style={{ cursor: 'pointer' }}>
      <span className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          style={{ width: 20, height: 20, minHeight: 20, flexShrink: 0, marginTop: 1 }}
        />
        {label ? (
          <span>
            <span style={{ fontWeight: 500 }}>{label}</span>
            {hint ? <span className="faint" style={{ display: 'block' }}>{hint}</span> : null}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  suffix,
  step = 1,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  step?: number;
}) {
  return (
    <label className="field">
      {label}
      <span className="row" style={{ gap: 'var(--sp-3)' }}>
        <input
          inputMode="decimal"
          value={String(value)}
          onChange={(event) => {
            const parsed = Number(event.target.value.replace(/[^0-9.]/g, ''));
            onChange(Number.isFinite(parsed) ? parsed : 0);
          }}
          className="num"
          style={{ maxWidth: 120 }}
          step={step}
        />
        {suffix ? <span className="muted">{suffix}</span> : null}
      </span>
      {hint ? <span className="faint">{hint}</span> : null}
    </label>
  );
}

function MoneyField({
  label,
  hint,
  valueKobo,
  onChange,
}: {
  label: string;
  hint?: string;
  valueKobo: string;
  onChange: (kobo: string) => void;
}) {
  const [text, setText] = useState(() => (Number(valueKobo) / 100).toFixed(2));
  const parsed = parseNairaToKobo(text);

  return (
    <label className="field">
      {label}
      <span className="row" style={{ gap: 'var(--sp-3)' }}>
        <span className="muted">₦</span>
        <input
          inputMode="decimal"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            const kobo = parseNairaToKobo(event.target.value);
            if (kobo !== null) onChange(kobo.toString());
          }}
          className="num"
          style={{ maxWidth: 160 }}
        />
        <span className="faint">{parsed !== null ? formatNaira(parsed) : 'not a valid amount'}</span>
      </span>
      {hint ? <span className="faint">{hint}</span> : null}
    </label>
  );
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const COLLECTION_LABELS: Record<number, string[]> = {
  1: ['Collection'],
  2: ['Morning', 'Evening'],
  3: ['Morning', 'Afternoon', 'Evening'],
};

const CHANNEL_LABELS: Record<AlertChannel, string> = {
  inApp: 'In the app',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
};

function humanRole(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
