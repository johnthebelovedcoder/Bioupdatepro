import Link from 'next/link';
import type { Alert } from '@/lib/alerts';
import type { FeedRunway } from '@/lib/alerts';
import { getModule } from '@/lib/modules';
import { Card } from './ui';
import { IconAlert, IconCheckCircle, IconFeed } from './icons';

/**
 * What needs a decision today.
 *
 * Every row ends in a button. That is the difference between this and the
 * "low stock" card it replaces: that one told a farmer feed was low and left
 * them to work out what to do about it and where, which is how alerts get
 * ignored.
 *
 * Ordered by urgency rather than by kind, because a farmer wants the worst
 * thing first, not all the feed problems grouped together.
 */
export function NeedsAttention({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <Card title="Needs attention">
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <span className="list-icon tone-success">
            <IconCheckCircle size={16} />
          </span>
          <span className="muted">Nothing needs you right now.</span>
        </div>
      </Card>
    );
  }

  const critical = alerts.filter((alert) => alert.severity === 'critical').length;

  return (
    <Card
      title="Needs attention"
      subtitle={
        critical > 0
          ? `${critical} urgent, ${alerts.length} in total`
          : `${alerts.length} thing${alerts.length === 1 ? '' : 's'}`
      }
      padded={false}
    >
      {alerts.map((alert) => (
        <div className="attention-row" key={alert.id} data-severity={alert.severity}>
          <span className={`list-icon ${toneFor(alert.severity)}`}>
            {alert.kind === 'feedRunway' ? <IconFeed size={16} /> : <IconAlert size={16} />}
          </span>
          <div className="list-main">
            <div className="list-title">
              {alert.title}
              {/*
                Which module this belongs to.

                This screen is the owner's view across every module they run, so
                a poultry alert and a snail alert genuinely do sit side by side.
                Without the label that reads like the two farms have been mixed
                up — especially when the sidebar happens to be showing the other
                one.
              */}
              {alert.moduleKey ? (
                <span className="badge" style={{ marginLeft: 'var(--sp-2)' }}>
                  {getModule(alert.moduleKey)?.productName ?? alert.moduleKey}
                </span>
              ) : null}
            </div>
            <div className="list-sub">{alert.detail}</div>
          </div>
          {/*
            No button where the person cannot go. The warning is still worth
            reading — a supervisor should know the feed runs out today even
            though ordering it is somebody else's job.
          */}
          {alert.action ? (
            <Link className="btn btn-sm" href={alert.action.href}>
              {alert.action.label}
            </Link>
          ) : null}
        </div>
      ))}
    </Card>
  );
}

function toneFor(severity: Alert['severity']): string {
  if (severity === 'critical') return 'tone-danger';
  if (severity === 'warning') return 'tone-warning';
  return 'tone-info';
}

/* -------------------------------------------------------------------------- */

/**
 * How long the feed lasts, in days rather than kilograms.
 *
 * "240 kg left" is a fact. "Six days, and it takes three to arrive, so order by
 * Thursday" is a decision. Feed is most of a poultry farm's cost and running
 * out costs production immediately, so this is the number that belongs on the
 * dashboard.
 */
export function FeedRunwayCard({ runway }: { runway: FeedRunway[] }) {
  const tracked = runway.filter((feed) => feed.daysLeft !== null);

  return (
    <Card title="How long the feed lasts" padded={false}>
      {tracked.length === 0 ? (
        <div className="card-body muted">
          No feed has been issued yet, so there is nothing to work a rate from.
        </div>
      ) : (
        tracked.map((feed) => {
          const days = Math.floor(feed.daysLeft ?? 0);
          return (
            <div className="list-row" key={feed.item}>
              <div className="list-main">
                <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                  <span className="list-title">{feed.item}</span>
                  <span
                    className="num"
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color:
                        feed.severity === 'critical'
                          ? 'var(--error-700)'
                          : feed.severity === 'warning'
                            ? 'var(--warning-700)'
                            : 'var(--gray-900)',
                    }}
                  >
                    {days} day{days === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="list-sub">
                  {feed.onHand.toLocaleString('en-NG')} {feed.unit} left · using{' '}
                  {feed.dailyUse} {feed.unit} a day
                </div>
                {feed.orderBy && feed.severity ? (
                  <div className="faint">
                    Order by{' '}
                    {feed.orderBy.toLocaleDateString('en-NG', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
}
