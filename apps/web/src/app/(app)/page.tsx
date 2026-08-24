import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatNaira, toKobo } from '@/lib/money';
import { defaultYear, getContext, type OrgContext } from '@/lib/org';
import { subscribedModules, title } from '@/lib/modules';
import {
  getModuleOverview,
  getMoneySummary,
  getRecentActivity,
  getUpcomingTasks,
  type ActivityEntry,
} from '@/lib/demo';
import { Card, CardLink, PageHeader, Stat } from '@/components/ui';
import { NeedsAttention, FeedRunwayCard } from '@/components/attention';
import { CoreOperations } from '@/components/core-operations';
import { ShareSummary } from '@/components/share-summary';
import { getLedgerMoney } from '@/lib/trade';
import { canSee } from '@/lib/permissions';
import { getAlerts, getFeedRunway } from '@/lib/alerts';
import { getFarmConfig } from '@/lib/farm-config.server';
import {
  IconAlert,
  IconArrowRight,
  IconBox,
  IconCart,
  IconCheckCircle,
  IconClipboard,
  IconEgg,
  IconFeed,
  IconTag,
} from '@/components/icons';

export const metadata = { title: 'Dashboard — BioAssetPro' };

interface TrialBalance {
  balanced: boolean;
  totalDebitKobo: string;
  totalCreditKobo: string;
  rows: unknown[];
}

/**
 * The business dashboard — the whole operation, across every subscribed module.
 *
 * Deliberately NOT species-specific: this is the owner's view, and an owner
 * running both PoultryPro and SnailPro wants one picture. The per-species
 * detail lives behind the module switcher.
 */
export default async function DashboardPage() {
  let context: OrgContext | null = null;
  let trialBalance: TrialBalance | null = null;
  let ledgerError: string | null = null;
  let firstName = '';
  let roles: string[] = [];

  try {
    const me = await api<{ fullName: string; roles: string[] }>('/auth/me');
    firstName = me.fullName.trim().split(/\s+/)[0] ?? '';
    // The roles decide what this page is allowed to show. Taken from the API,
    // not from a cookie the browser could edit.
    roles = me.roles ?? [];
  } catch {
    // The layout already guarantees a session; a failure here should cost the
    // greeting, not the page.
  }

  try {
    context = await getContext();
    const year = context ? defaultYear(context) : null;
    if (context?.company && year) {
      trialBalance = await api<TrialBalance>(
        // No companyId: the API takes it from the signed-in user, so the client
        // cannot ask for a company it is not entitled to.
        `/reporting/trial-balance?financialYearId=${year.id}`,
      );
    }
  } catch (caught) {
    ledgerError = caught instanceof ApiError ? caught.message : 'Could not reach the ledger.';
  }

  const config = await getFarmConfig();
  const [alerts, runway, ledger] = await Promise.all([
    getAlerts(roles),
    getFeedRunway(config),
    canSee(roles, 'money') ? getLedgerMoney() : null,
  ]);

  const modules = subscribedModules(config.modules);
  /*
   * Whether this farm keeps anything alive.
   *
   * AgriPro Core is sold without a species module, and this page was written
   * as though that could not happen: an empty "Livestock" heading, a feed
   * runway with nothing to measure, a task list of vaccinations, and the
   * work-in-progress account labelled "tied up in livestock". Everything below
   * that belongs to the animals is now gated on this, and what remains is the
   * platform — money, approvals, what is in flight.
   */
  const hasSpecies = modules.length > 0;
  const [money, tasks, activity, ...overviews] = await Promise.all([
    getMoneySummary(),
    getUpcomingTasks(),
    getRecentActivity(),
    ...modules.map((module) => getModuleOverview(module.key)),
  ]);

  // From the ledger, like the screen. The summary somebody sends to the owner
  // and the summary on the screen have to be the same figures, or the two
  // disagree in a WhatsApp message nobody can reconcile afterwards.
  const grossProfit = ledger
    ? toKobo(ledger.revenueKobo) - toKobo(ledger.expenseKobo)
    : 0n;

  /*
   * The same figures the page shows, as text somebody can send.
   *
   * Built from the values already computed above rather than fetched again, so
   * the message and the screen cannot disagree — a summary that quietly differs
   * from what the sender is looking at is worse than no summary.
   */
  const summary = {
    farmName: context?.company?.name ?? config.organisation.name,
    dateLabel: new Intl.DateTimeFormat('en-NG', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Africa/Lagos',
    }).format(new Date()),
    // Empty for somebody who cannot see the money. A shared summary must not
    // become the way a figure reaches a person the screen withheld it from.
    money: ledger
      ? [
          { label: 'Revenue', value: formatNaira(ledger.revenueKobo) },
          { label: 'Expenses', value: formatNaira(ledger.expenseKobo) },
          { label: 'Gross profit', value: formatNaira(grossProfit) },
          {
            // Same label as the screen. A summary that renames a figure on its
            // way into a WhatsApp message is a figure two people cannot discuss.
            label: hasSpecies ? 'Tied up in livestock' : 'Work in progress',
            value: formatNaira(ledger.workInProgressKobo),
          },
          { label: 'Owed to us', value: formatNaira(ledger.receivableKobo) },
        ]
      : [],
    livestock: modules.map((module, index) => ({
      label: module.productName,
      value: `${overviews[index]?.groupCount ?? 0} ${
        (overviews[index]?.groupCount ?? 0) === 1
          ? module.terms.group.one
          : module.terms.group.many
      }`,
    })),
    attention: alerts.map((alert) =>
      alert.detail ? `${alert.title} (${alert.detail})` : alert.title,
    ),
  };

  return (
    <>
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : greeting()}
        subtitle={
          context?.company
            ? `${context.company.name} · ${defaultYear(context)?.code ?? ''}`
            : 'No company configured'
        }
        actions={
          /*
           * Only for somebody who can see the figures it is built from.
           *
           * The summary already omitted the money for a role without access, so
           * nothing leaked — but that left a supervisor holding a button that
           * produced a report with its most substantial half missing. Offering a
           * broken version of a feature is its own kind of dishonesty.
           */
          ledger ? (
            <div className="row" style={{ gap: 'var(--sp-3)' }}>
              <ShareSummary summary={summary} />
            </div>
          ) : null
        }
      />

      <div className="stack">
        <NeedsAttention alerts={alerts} />

        {/*
          Absent, not blanked out.

          A supervisor sees no money section at all rather than a row of dashes
          — showing the shape of a figure they may not have tells them there is
          something to ask about, which is the opposite of the point.
        */}
        {ledger ? (
        <section>
          <SectionLabel>From the ledger</SectionLabel>
          <div className="stat-grid">
            <Stat
              label="Revenue"
              value={formatNaira(ledger.revenueKobo)}
              money
              goodWhen="up"
              hint="posted and approved"
            />
            <Stat label="Expenses" value={formatNaira(ledger.expenseKobo)} money goodWhen="down" />
            {/*
              The figure a livestock farm actually lives on: what the animals
              currently alive have cost so far. It is neither an expense nor
              revenue yet, so a normal profit summary hides it entirely — and on
              this farm it is the largest number on the page.

              The label follows the modules. On AgriPro Core with no species
              module the same account is simply work in progress, and calling it
              "tied up in livestock" told a customer who keeps no animals that
              twenty-six million naira of theirs was in animals.
            */}
            <Stat
              label={hasSpecies ? 'Tied up in livestock' : 'Work in progress'}
              value={formatNaira(ledger.workInProgressKobo)}
              money
              hint={hasSpecies ? 'feed and treatment so far' : 'not yet expensed or sold'}
            />
            <Stat
              label="Owed to us"
              value={formatNaira(ledger.receivableKobo)}
              money
              hint="outstanding"
            />
          </div>
          {toKobo(ledger.revenueKobo) === 0n ? (
            <p className="faint" style={{ marginTop: 'var(--sp-3)' }}>
              No revenue is posted yet. Sales recorded on the phone are raised as orders and
              reach the accounts once they are approved.
            </p>
          ) : null}
        </section>
        ) : null}

        {/* One card per subscribed species module, in that module's own
            vocabulary. Adding FishPro adds a card here and nothing else.

            Absent entirely with no module, rather than an empty heading. A bare
            "LIVESTOCK" label with nothing beneath it is how this page looked to
            an AgriPro Core customer, and it reads as something broken rather
            than something they did not buy. */}
        {hasSpecies ? (
        <section>
          <SectionLabel>Livestock</SectionLabel>
          <div className={modules.length >= 3 ? 'stat-grid' : 'stat-grid stat-grid-2'}>
            {modules.map((module, index) => {
              const overview = overviews[index];
              if (!overview) return null;
              const Icon = module.icon;
              return (
                <Link
                  key={module.key}
                  href={`/m/${module.key}`}
                  className="module-card"
                  aria-label={`Open ${module.productName}`}
                >
                  <div className="module-card-head">
                    <span className="module-trigger-icon">
                      <Icon size={17} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="module-card-name">{module.productName}</span>
                      <span className="module-card-sub">
                        {overview.groupCount}{' '}
                        {overview.groupCount === 1
                          ? module.terms.group.one
                          : module.terms.group.many}
                      </span>
                    </span>
                    <IconArrowRight size={16} />
                  </div>
                  <div className="module-card-figures">
                    {module.metrics.slice(0, 3).map((metric) => {
                      const figure = overview.metrics[metric.key];
                      if (!figure) return null;
                      return (
                        <span key={metric.key} className="module-card-figure">
                          <span className="module-card-figure-value">{figure.value}</span>
                          <span className="module-card-figure-label">{metric.label}</span>
                        </span>
                      );
                    })}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
        ) : null}

        <div className="two-col">
          <div className="stack">
            {/*
              The platform's own work, above the farm's.

              Approvals, orders and receipts are AgriPro Core, so they are what
              a Core-only customer sees — and they belong near the top for
              everybody else too, because a document waiting on somebody is more
              urgent than a list of what happened this morning.
            */}
            {canSee(roles, 'trade') ? <CoreOperations /> : null}

            {/* The farm's day. Nothing to show without a species module — the
                entries are feeding, mortality, egg collection and harvest. */}
            {hasSpecies ? (
              <Card title="Recent activity" subtitle="Today on the farm" padded={false}>
                {activity.map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} />
                ))}
              </Card>
            ) : null}
          </div>

          <div className="stack">
            {/* The one card on this page reading live data. */}
            <Card
              title="General ledger"
              subtitle="Live from the accounting core"
              action={
                trialBalance ? (
                  <span
                    className={`badge ${trialBalance.balanced ? 'badge-success' : 'badge-danger'}`}
                  >
                    {trialBalance.balanced ? 'In balance' : 'Out of balance'}
                  </span>
                ) : null
              }
            >
              {ledgerError ? (
                <div className="notice notice-error">{ledgerError}</div>
              ) : trialBalance ? (
                <div className="stack" style={{ gap: 'var(--sp-3)' }}>
                  <KeyValue label="Total debits" value={formatNaira(trialBalance.totalDebitKobo)} />
                  <KeyValue
                    label="Total credits"
                    value={formatNaira(trialBalance.totalCreditKobo)}
                  />
                  <KeyValue
                    label="Accounts with movement"
                    value={String(trialBalance.rows.length)}
                  />
                  <div style={{ marginTop: 'var(--sp-2)' }}>
                    <CardLink href="/ledger/trial-balance">View trial balance</CardLink>
                  </div>
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 14 }}>
                  No ledger data yet.
                </p>
              )}
            </Card>

            {/* Feed and the farm's task list are both livestock work. */}
            {hasSpecies ? <FeedRunwayCard runway={runway} /> : null}

            {hasSpecies ? (
            <Card title="Upcoming tasks" padded={false}>
              {tasks.map((task) => (
                <div className="list-row" key={task.id}>
                  <span
                    className={`list-icon ${
                      task.urgency === 'overdue'
                        ? 'tone-danger'
                        : task.urgency === 'today'
                          ? 'tone-warning'
                          : ''
                    }`}
                  >
                    <IconClipboard size={16} />
                  </span>
                  <div className="list-main">
                    <div className="list-title">{task.title}</div>
                    <div className="list-sub">{task.detail}</div>
                  </div>
                  <span className="list-time">{task.due}</span>
                </div>
              ))}
            </Card>
            ) : null}
          </div>
        </div>

        {context?.company ? null : (
          <div className="notice notice-warning">
            No company has been set up. Run <code>npm run db:seed</code> to load the chart of
            accounts and configuration.
          </div>
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Time of day in Lagos, not the server's timezone — a manager opening this at
 * 7am should not be told good evening because the host runs on UTC.
 */
function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-NG', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Africa/Lagos',
    }).format(new Date()),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="faint"
      style={{
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        fontWeight: 600,
        marginBottom: 'var(--sp-3)',
      }}
    >
      {children}
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="muted" style={{ fontSize: 14 }}>
        {label}
      </span>
      <span className="num" style={{ fontSize: 14, color: 'var(--gray-900)' }}>
        {value}
      </span>
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const Icon =
    entry.kind === 'production'
      ? IconEgg
      : entry.kind === 'feed'
        ? IconFeed
        : entry.kind === 'mortality'
          ? IconAlert
          : entry.kind === 'sale'
            ? IconTag
            : entry.kind === 'purchase'
              ? IconCart
              : IconCheckCircle;

  const tone = entry.tone === 'neutral' ? '' : `tone-${entry.tone}`;

  return (
    <div className="list-row">
      <span className={`list-icon ${tone}`}>
        <Icon size={16} />
      </span>
      <div className="list-main">
        <div className="list-title">{entry.title}</div>
        <div className="list-sub">{entry.detail}</div>
      </div>
      <span className="list-time">{entry.time}</span>
    </div>
  );
}

function percentChange(current: number, previous: number) {
  if (!previous) return undefined;
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.05) return { direction: 'flat' as const, label: 'no change' };
  return {
    direction: change > 0 ? ('up' as const) : ('down' as const),
    label: `${Math.abs(change).toFixed(1)}%`,
  };
}
