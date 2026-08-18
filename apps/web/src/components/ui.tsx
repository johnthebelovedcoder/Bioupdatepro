import Link from 'next/link';
import {
  IconAlert,
  IconArrowRight,
  IconConstruction,
  IconTrendDown,
  IconTrendUp,
} from './icons';

/* ------------------------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-title-group">
        <h1>{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

export function Card({
  title,
  subtitle,
  action,
  footer,
  padded = true,
  children,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  /** Off for tables and lists, which manage their own edge padding. */
  padded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      {title ? (
        <div className="card-header">
          <div className="card-title-group">
            <h2>{title}</h2>
            {subtitle ? (
              <p className="faint" style={{ marginTop: 2 }}>
                {subtitle}
              </p>
            ) : null}
          </div>
          {action}
        </div>
      ) : null}
      {padded ? <div className="card-body">{children}</div> : children}
      {footer ? <div className="card-footer">{footer}</div> : null}
    </section>
  );
}

/* ------------------------------------------------------------------------ */

export type Trend = { direction: 'up' | 'down' | 'flat'; label: string };

/**
 * A single headline figure.
 *
 * `money` switches to the monospace tabular face — naira amounts need to line
 * up with each other, plain counts do not and read better in the UI face.
 *
 * `goodWhen` exists because direction is not sentiment: mortality rising is
 * bad, egg production rising is good. Nothing here assumes up means good.
 */
export function Stat({
  label,
  value,
  money = false,
  trend,
  goodWhen = 'up',
  hint,
  icon,
  help,
}: {
  label: string;
  value: string;
  money?: boolean;
  trend?: Trend;
  goodWhen?: 'up' | 'down' | 'neutral';
  hint?: string;
  icon?: React.ReactNode;
  /** An explanation of the term, for figures whose name is jargon. */
  help?: React.ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        {icon}
        {label}
        {help}
      </div>
      <div className={`stat-value${money ? ' is-money' : ''}`}>{value}</div>
      {trend || hint ? (
        <div className="stat-meta">
          {trend ? <Delta trend={trend} goodWhen={goodWhen} /> : null}
          {hint ? <span>{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function Delta({ trend, goodWhen }: { trend: Trend; goodWhen: 'up' | 'down' | 'neutral' }) {
  if (trend.direction === 'flat') {
    return <span className="delta delta-flat">{trend.label}</span>;
  }
  const good =
    goodWhen === 'neutral' ? null : (trend.direction === 'up') === (goodWhen === 'up');
  const tone = good === null ? 'delta-flat' : good ? 'delta-up' : 'delta-down';
  return (
    <span className={`delta ${tone}`}>
      {trend.direction === 'up' ? <IconTrendUp size={13} /> : <IconTrendDown size={13} />}
      {trend.label}
    </span>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * Marks figures that are demonstration data.
 *
 * Required by the product specification: seed and demo numbers must never be
 * mistakable for a farm's real performance. Shown on every screen not yet
 * reading from the API.
 */
export function DemoFlag({ note }: { note?: string }) {
  return (
    <span className="demo-flag" title={note ?? 'Illustrative figures, not real farm data.'}>
      <IconAlert size={13} />
      Demo data
    </span>
  );
}

/* ------------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <div className="empty-icon">{icon}</div> : null}
      <div className="empty-title">{title}</div>
      {body ? <p className="empty-body">{body}</p> : null}
      {action ? <div className="empty-actions">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * The honest placeholder.
 *
 * Navigation shows the whole product so its shape is legible, but a section
 * with no implementation says exactly that rather than displaying invented
 * records. A screen of plausible fake data is worse than an empty one: it
 * cannot be distinguished from a broken feature.
 */
export function NotBuiltYet({
  title,
  summary,
  planned,
  dependsOn,
}: {
  title: string;
  summary: string;
  planned?: string[];
  dependsOn?: string;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={summary} />
      <Card>
        <EmptyState
          icon={<IconConstruction size={22} />}
          title="This section has not been built yet"
          body={
            dependsOn
              ? `Nothing here is implemented. ${dependsOn}`
              : 'Nothing here is implemented. It is shown in the navigation so the shape of the product is visible.'
          }
        />
        {planned && planned.length > 0 ? (
          <div
            style={{
              borderTop: '1px solid var(--border)',
              padding: 'var(--sp-5)',
              maxWidth: 560,
              margin: '0 auto',
            }}
          >
            <div className="faint" style={{ marginBottom: 'var(--sp-3)' }}>
              PLANNED FOR THIS SECTION
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                color: 'var(--text-muted)',
                display: 'grid',
                gap: 6,
                fontSize: 14,
              }}
            >
              {planned.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------------ */

export function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="row" style={{ gap: 6, fontWeight: 500, fontSize: 14 }}>
      {children}
      <IconArrowRight size={15} />
    </Link>
  );
}
