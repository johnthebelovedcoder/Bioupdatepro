import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getModule, title } from '@/lib/modules';
import { getGroupDetail, getGroups } from '@/lib/operations';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, PageHeader, Stat } from '@/components/ui';
import { TERMS } from '@/components/help';
import { NewGroupForm } from '@/components/new-group-form';
import { StageChange } from '@/components/record-stage-change';
import { TrendChart } from '@/components/trend-chart';
import { formatAge } from '@/components/register';
import {
  IconAlert,
  IconArrowRight,
  IconBox,
  IconCheckCircle,
  IconEgg,
  IconFeed,
  IconClipboard,
} from '@/components/icons';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ module: string; section: string; id: string }>;
}) {
  const { module: key, id } = await params;
  const module = getModule(key);
  return { title: module ? `${id} — ${module.productName}` : 'BioAssetPro' };
}

/**
 * One managed population in detail — a poultry batch or a snail colony.
 *
 * Same page for both, same as the register. What a reader needs is identical:
 * how many are alive, how many have died, what it has cost, and what happened
 * to it. Only the words change.
 */
export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ module: string; section: string; id: string }>;
}) {
  const { module: key, section, id } = await params;
  const module = getModule(key);
  if (!module || !module.subscribed) notFound();
  if (section !== module.registerSlug) notFound();

  // Starting a new population. The form is real and goes through the outbox,
  // the same as the daily round — it just cannot reach a server yet, and says
  // so on submit rather than pretending.
  if (id === 'new') {
    const existing = await getGroups(module.key);
    const houses = [...new Set(existing.map((group) => group.house))].sort();
    return (
      <NewGroupForm
        moduleKey={module.key}
        houses={houses}
        today={new Date().toISOString().slice(0, 10)}
      />
    );
  }

  const [group, siblings] = await Promise.all([
    getGroupDetail(module.key, id),
    getGroups(module.key),
  ]);
  if (!group) notFound();

  const t = module.terms;
  const died = group.openingPopulation - group.population;
  const totalCost = group.costBreakdown.reduce(
    (sum, line) => sum + toKobo(line.kobo),
    0n,
  );
  const perHead =
    group.population > 0 ? totalCost / BigInt(group.population) : 0n;

  return (
    <>
      <PageHeader
        title={group.code}
        subtitle={`${group.breed} · ${group.purpose} · ${group.house}`}
        actions={
          <>
            <span className={`badge ${group.status === 'ACTIVE' ? 'badge-success' : ''}`}>
              {group.status.toLowerCase()}
            </span>
          </>
        }
      />

      <div className="stack">
        <div className="row" style={{ gap: 6 }}>
          <Link href={`/m/${module.key}/${module.registerSlug}`} className="faint">
            {title(t.group.many)}
          </Link>
          <span className="faint">/</span>
          <span className="faint">{group.code}</span>
        </div>

        {/* Three figures: how many are alive, how many were lost, what it cost
            to get here. Everything else is a detail below. */}
        <div className="stat-grid">
          <Stat
            label={`Live ${t.animal.many}`}
            value={group.population.toLocaleString('en-NG')}
            hint={`of ${group.openingPopulation.toLocaleString('en-NG')} placed`}
          />
          <Stat
            label="Mortality to date"
            help={TERMS.mortalityRate}
            value={`${group.mortalityRate.toFixed(2)}%`}
            goodWhen="down"
            hint={`${died.toLocaleString('en-NG')} ${t.animal.many} lost`}
          />
          <Stat
            label={`Cost per live ${t.animal.one}`}
            help={TERMS.costPerAnimal}
            value={formatNaira(perHead)}
            money
            hint="accumulated"
          />
          <Stat
            label="Total cost"
            value={formatNaira(totalCost)}
            money
            hint={`since ${t.intake.toLowerCase()}`}
          />
        </div>

        <div className="two-col">
          <div className="stack">
            <Card
              title="Population"
              subtitle="Last 14 days"
            >
              <TrendChart
                points={group.populationSeries}
                valueLabel={t.animal.many}
              />
            </Card>

            <Card title="Daily mortality" subtitle="Last 14 days">
              {/* Separate chart, not a second line. Population runs in the
                  thousands and deaths in the tens; one axis cannot serve both
                  honestly. */}
              <TrendChart
                points={group.mortalitySeries}
                kind="bar"
                tone="danger"
                valueLabel="deaths"
              />
            </Card>

            <Card title="History" subtitle="Most recent first" padded={false}>
              {group.events.map((event) => (
                <div className="list-row" key={event.id}>
                  <span className={`list-icon ${toneFor(event.type)}`}>
                    {iconFor(event.type)}
                  </span>
                  <div className="list-main">
                    <div className="list-title">{event.summary}</div>
                    <div className="list-sub">{event.detail}</div>
                    <div className="faint">Recorded by {event.recordedBy}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {event.quantity ? (
                      <div className="num" style={{ fontSize: 13 }}>
                        {event.quantity}
                      </div>
                    ) : null}
                    <div className="list-time">{formatDate(event.occurredOn)}</div>
                  </div>
                </div>
              ))}
            </Card>
          </div>

          <div className="stack">
            <Card title={`${title(t.group.one)} details`}>
              <div className="stack" style={{ gap: 'var(--sp-3)' }}>
                <KeyValue label="Stage" value={group.stage} />
                <KeyValue label={title(t.housing.one)} value={group.house} />
                <KeyValue label={t.intake} value={formatDate(group.startedOn)} />
                <KeyValue label="Age" value={formatAge(group.ageDays)} />
                <KeyValue label="Source" value={group.source} />
                {group.expectedEndOn ? (
                  <KeyValue label="Expected sale" value={formatDate(group.expectedEndOn)} />
                ) : null}
              </div>
            </Card>

            <Card
              title="Cost accumulated"
              subtitle={`Against this ${t.group.one}`}
              padded={false}
            >
              <div className="table-wrap">
                <table className="data">
                  <tbody>
                    {group.costBreakdown.map((line) => (
                      <tr key={line.label}>
                        <td>{line.label}</td>
                        <td className="num">{formatNaira(line.kobo)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="num">{formatNaira(totalCost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="card-footer">
                {/*
                  Stated plainly because it is the whole architectural argument:
                  once the batch is a cost object in the ledger, this table is
                  the WIP account and it reconciles to the income statement.
                  Until then it is an illustration.
                */}
                <span className="faint">
                  Will read from the {t.group.one}&apos;s work-in-progress account, so it
                  reconciles to the profit and loss.
                </span>
              </div>
            </Card>

            <Card title="Quick actions">
              <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                {/*
                  `at` carries the population, so the round opens on THIS one's
                  stop rather than at the start of the walk. Previously all
                  three landed on the first house and one pointed at the feeding
                  REPORT, which cannot record anything — three buttons that
                  looked like actions and were not.
                */}
                <ActionLink
                  href={`/m/${module.key}/records?at=${group.id}`}
                  label={`Record ${t.productionRecord.toLowerCase()}`}
                />
                <ActionLink
                  href={`/m/${module.key}/records?at=${group.id}`}
                  label={`Record ${t.animal.many} lost`}
                />
                <ActionLink
                  href={`/m/${module.key}/records?at=${group.id}`}
                  label="Record feeding"
                />

                {/*
                  Not a link, because a stage change is a decision taken about
                  THIS population and there is nowhere else it needs to happen.
                */}
                {group.status === 'ACTIVE' ? (
                  <div style={{ paddingTop: 'var(--sp-2)' }}>
                    <StageChange
                      groupId={group.id}
                      groups={[
                        {
                          id: group.id,
                          code: group.code,
                          house: group.house,
                          stage: group.stage,
                          population: group.population,
                        },
                      ]}
                      stages={t.stages}
                      houses={[...new Set(siblings.map((entry) => entry.house))].sort()}
                      today={new Date().toISOString().slice(0, 10)}
                      labels={{
                        group: title(t.group.one),
                        animal: t.animal.one,
                        housing: t.housing.one,
                      }}
                      trigger={`Move to another stage`}
                    />
                  </div>
                ) : null}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 'var(--sp-4)' }}>
      <span className="muted" style={{ fontSize: 14 }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="row"
      style={{ justifyContent: 'space-between', fontSize: 14, fontWeight: 500 }}
    >
      {label}
      <IconArrowRight size={15} />
    </Link>
  );
}

function toneFor(type: string): string {
  switch (type) {
    case 'MORTALITY':
      return 'tone-danger';
    case 'PRODUCTION':
    case 'HARVEST':
      return 'tone-success';
    case 'TREATMENT':
      return 'tone-info';
    case 'PLACEMENT':
      return 'tone-info';
    default:
      return '';
  }
}

function iconFor(type: string) {
  switch (type) {
    case 'MORTALITY':
      return <IconAlert size={16} />;
    case 'PRODUCTION':
      return <IconEgg size={16} />;
    case 'FEED':
      return <IconFeed size={16} />;
    case 'HARVEST':
      return <IconBox size={16} />;
    case 'TREATMENT':
      return <IconCheckCircle size={16} />;
    default:
      return <IconClipboard size={16} />;
  }
}
