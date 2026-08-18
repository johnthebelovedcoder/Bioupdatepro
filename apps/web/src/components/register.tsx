import Link from 'next/link';
import type { SpeciesModule } from '@/lib/modules';
import { title } from '@/lib/modules';
import type { BatchSummary } from '@/lib/demo';
import { formatDate, formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from './ui';
import { RegisterFilters } from './register-filters';
import { IconClipboard, IconPlus } from './icons';

/**
 * The register — every managed population in the active module.
 *
 * One component serves poultry batches and snail colonies, and will serve fish
 * stocks. Every noun on the page comes from the module's terminology; nothing
 * here knows what a bird is.
 *
 * Rendered twice at different breakpoints: a table on desktop, cards on a
 * phone. The duplication is deliberate — a nine-column register squeezed to
 * 375px is unreadable, and a card carrying the same fields is not. Only one is
 * ever displayed, so only one is in the accessibility tree.
 */
export function Register({
  module,
  groups,
  filters,
  options,
}: {
  module: SpeciesModule;
  groups: BatchSummary[];
  filters: {
    status: string;
    house: string;
    purpose: string;
    stage: string;
    search: string;
  };
  options: { houses: string[]; purposes: string[]; stages: string[] };
}) {
  const t = module.terms;
  const totalPopulation = groups.reduce((sum, group) => sum + group.population, 0);

  return (
    <>
      <PageHeader
        title={title(t.group.many)}
        subtitle={
          groups.length === 0
            ? `No ${t.group.many} match this selection`
            : `${groups.length} ${groups.length === 1 ? t.group.one : t.group.many} · ${totalPopulation.toLocaleString('en-NG')} ${t.animal.many}`
        }
        actions={
          <>
            <Link className="btn btn-primary" href={`/m/${module.key}/${module.registerSlug}/new`}>
              <IconPlus size={16} />
              New {t.group.one}
            </Link>
          </>
        }
      />

      <div className="stack">
        <RegisterFilters
          groupNoun={title(t.group.one)}
          houses={options.houses}
          purposes={options.purposes}
          stages={options.stages}
          selected={filters}
        />

        {groups.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconClipboard size={22} />}
              title={`No ${t.group.many} to show`}
              body={`Nothing matches the current filters. Clear them, or record a ${t.intake.toLowerCase()} to start a new ${t.group.one}.`}
            />
          </Card>
        ) : (
          <Card padded={false}>
            {/* Desktop */}
            <div className="table-wrap hide-on-phone">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 130 }}>{title(t.group.one)}</th>
                    <th>Breed &amp; purpose</th>
                    <th style={{ width: 140 }}>{title(t.housing.one)}</th>
                    <th style={{ width: 110 }}>Stage</th>
                    <th className="right" style={{ width: 110 }}>
                      {title(t.animal.many)}
                    </th>
                    <th className="right" style={{ width: 100 }}>
                      Mortality
                    </th>
                    <th className="right" style={{ width: 90 }}>
                      Age
                    </th>
                    <th className="right" style={{ width: 130 }}>
                      Cost to date
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.id}>
                      <td className="strong">
                        <Link href={`/m/${module.key}/${module.registerSlug}/${group.id}`}>
                          <span className="num" style={{ textAlign: 'left' }}>
                            {group.code}
                          </span>
                        </Link>
                        {group.status === 'CLOSED' ? (
                          <div>
                            <span className="badge">closed</span>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {group.breed}
                        <div className="faint">{group.purpose}</div>
                      </td>
                      <td>{group.house}</td>
                      <td>
                        <span className="badge badge-plain">{group.stage}</span>
                      </td>
                      <td className="num">
                        {group.population.toLocaleString('en-NG')}
                        <div className="faint num" style={{ fontSize: 11 }}>
                          of {group.openingPopulation.toLocaleString('en-NG')}
                        </div>
                      </td>
                      <td className="num">
                        <Mortality rate={group.mortalityRate} />
                      </td>
                      <td className="num">{formatAge(group.ageDays)}</td>
                      <td className="num">{formatNaira(group.costToDateKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Phone */}
            <div className="show-on-phone record-list">
              {groups.map((group) => (
                <Link
                  key={group.id}
                  href={`/m/${module.key}/${module.registerSlug}/${group.id}`}
                  className="record-card"
                >
                  <div className="record-card-head">
                    <span className="num record-card-code">{group.code}</span>
                    {group.status === 'CLOSED' ? (
                      <span className="badge">closed</span>
                    ) : (
                      <span className="badge badge-plain">{group.stage}</span>
                    )}
                  </div>
                  <div className="record-card-sub">
                    {group.breed} · {group.purpose}
                  </div>
                  <div className="record-card-sub faint">{group.house}</div>
                  <div className="record-card-figures">
                    <span>
                      <span className="record-card-value">
                        {group.population.toLocaleString('en-NG')}
                      </span>
                      <span className="record-card-label">{t.animal.many}</span>
                    </span>
                    <span>
                      <span className="record-card-value">
                        <Mortality rate={group.mortalityRate} />
                      </span>
                      <span className="record-card-label">mortality</span>
                    </span>
                    <span>
                      <span className="record-card-value">{formatAge(group.ageDays)}</span>
                      <span className="record-card-label">age</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

/**
 * Mortality shown against a threshold.
 *
 * Five percent is a PLACEHOLDER, not a standard. Real normal-mortality varies
 * by species, breed and age, and belongs in effective-dated configuration —
 * see the open question on the normal-mortality curve. It is flagged visually
 * so the intent is clear, but nothing decides anything on it.
 */
function Mortality({ rate }: { rate: number }) {
  const high = rate > 5;
  return (
    <span
      title={high ? 'Above the placeholder 5% threshold — not a breed standard' : undefined}
      style={high ? { color: 'var(--error-700)', fontWeight: 600 } : undefined}
    >
      {rate.toFixed(2)}%
    </span>
  );
}

export function formatAge(days: number): string {
  if (days < 70) return `${days} d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 60) return `${weeks} wk`;
  return `${Math.floor(days / 30)} mo`;
}

export { formatDate };
