import Link from 'next/link';
import type { SpeciesModule } from '@/lib/modules';
import { title } from '@/lib/modules';
// Snail breeding has no model behind it yet, so it stays on the fixture and
// keeps its Demo data badge. Poultry breeding (egg collection, incubation,
// hatch) is real — see getEggBatches/getIncubationBatches below.
import { getBreedingCycles } from '@/lib/demo-ops';
import { getEggBatches, getIncubationBatches, getLayingGroups } from '@/lib/poultry-eggs';
import {
  getFeeding,
  getGroups,
  getHarvests,
  getHealth,
  getPerformance,
  getProduction,
  getStageBreakdown,
} from '@/lib/operations';
import { getActiveNames } from '@/app/(app)/staff/actions';
import { getFarmConfig } from '@/lib/farm-config.server';
import { formatDate, formatNaira, toKobo } from '@/lib/money';
import { Card, DemoFlag, EmptyState, PageHeader, Stat } from './ui';
import { HelpTerm } from './help';
import { HealthSchedule } from './record-treatment';
import { HarvestLog } from './record-harvest';
import { StageChange } from './record-stage-change';
import { TrendChart } from './trend-chart';
import { PeriodFilter } from './period-filter';
import { PoultryBreeding } from './poultry-breeding';
import { resolvePeriod, type PeriodKey } from '@/lib/period';
import { IconAlert, IconBox, IconClipboard, IconEgg } from './icons';

/**
 * The module sections.
 *
 * Each is a server component taking the module, so every noun on every screen
 * comes from the registry. One implementation serves poultry and snails, and
 * will serve fish.
 */

/* ========================================================================== */
/* Production                                                                  */
/* ========================================================================== */

export async function ProductionSection({
  module,
  period: periodKey,
}: {
  module: SpeciesModule;
  period?: string;
}) {
  const config = await getFarmConfig();
  const period = resolvePeriod(periodKey, config.organisation.financialYearStartMonth);
  const rows = await getProduction(module.key, period.days);
  const t = module.terms;
  const snail = module.key === 'snail';

  if (rows.length === 0) {
    return (
      <>
        <PageHeader title={module.nav.find((n) => n.slug === 'production')?.label ?? 'Production'} />
        <Card>
          <EmptyState
            icon={<IconEgg size={22} />}
            title={`Nothing in production yet`}
            body={`No ${t.group.one} is at a producing stage.`}
          />
        </Card>
      </>
    );
  }

  const primary = module.productionFields[0]!;
  const byDate = new Map<string, number>();
  for (const row of rows) {
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + (row.values[primary.key] ?? 0));
  }
  const series = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));

  const total = series.reduce((sum, point) => sum + point.value, 0);
  const best = rows.reduce((top, row) =>
    (row.values[primary.key] ?? 0) > (top.values[primary.key] ?? 0) ? row : top,
  );
  const rates = rows.map((row) => row.rate).filter((rate): rate is number => rate !== null);
  const averageRate = rates.length
    ? Number((rates.reduce((sum, rate) => sum + rate, 0) / rates.length).toFixed(1))
    : null;

  return (
    <>
      <PageHeader
        title={module.nav.find((n) => n.slug === 'production')?.label ?? 'Production'}
        subtitle={`${module.productName} · ${period.caption}`}
      />

      <div className="stack">
        <PeriodFilter active={period.key as PeriodKey} />
        <div className="stat-grid">
          <Stat
            label={`Total ${primary.label.toLowerCase()}`}
            value={`${total.toLocaleString('en-NG')}${primary.unit ? ` ${primary.unit}` : ''}`}
            hint={period.caption}
          />
          <Stat
            label={snail ? 'Best harvest' : 'Best day'}
            value={`${(best.values[primary.key] ?? 0).toLocaleString('en-NG')}`}
            hint={`${best.groupCode} · ${formatDate(best.date)}`}
          />
          <Stat
            label={snail ? 'Harvests' : 'Average lay rate'}
            value={averageRate !== null ? `${averageRate}%` : String(rows.length)}
            goodWhen="up"
            hint={averageRate !== null ? 'hen-day' : 'in the period'}
            {...(averageRate !== null ? { help: <HelpTerm k="henDay" /> } : {})}
          />
          <Stat
            label={`Producing ${t.group.many}`}
            value={String(new Set(rows.map((row) => row.groupCode)).size)}
          />
        </div>

        <Card title={primary.label} subtitle="All producing populations">
          <TrendChart points={series} valueLabel={primary.unit ?? primary.label.toLowerCase()} />
        </Card>

        <Card title="By day" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Date</th>
                  <th style={{ width: 120 }}>{title(t.group.one)}</th>
                  <th>{title(t.housing.one)}</th>
                  {module.productionFields.map((field) => (
                    <th key={field.key} className="right" style={{ width: 110 }}>
                      {field.label}
                    </th>
                  ))}
                  {!snail ? (
                    <th className="right" style={{ width: 100 }}>
                      Lay rate
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((row, index) => (
                  <tr key={`${row.groupCode}-${row.date}-${index}`}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(row.date)}
                    </td>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      {row.groupCode}
                    </td>
                    <td className="faint">{row.house}</td>
                    {module.productionFields.map((field) => (
                      <td key={field.key} className="num">
                        {(row.values[field.key] ?? 0).toLocaleString('en-NG')}
                      </td>
                    ))}
                    {!snail ? (
                      <td className="num">{row.rate !== null ? `${row.rate}%` : '—'}</td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ========================================================================== */
/* Feeding                                                                     */
/* ========================================================================== */

export async function FeedingSection({
  module,
  period: periodKey,
}: {
  module: SpeciesModule;
  period?: string;
}) {
  const config = await getFarmConfig();
  const period = resolvePeriod(periodKey, config.organisation.financialYearStartMonth);
  const rows = await getFeeding(module.key, period.days);
  const t = module.terms;

  const totalKg = rows.reduce((sum, row) => sum + row.kg, 0);
  const totalCost = rows.reduce((sum, row) => sum + toKobo(row.costKobo), 0n);
  const byDate = new Map<string, number>();
  for (const row of rows) byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.kg);
  const series = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, value }));

  const averagePerHead =
    rows.length > 0
      ? Number((rows.reduce((sum, row) => sum + row.gramsPerHead, 0) / rows.length).toFixed(1))
      : 0;

  return (
    <>
      <PageHeader
        title="Feeding"
        subtitle={`${module.productName} · feed issued, ${period.caption}`}
      />

      <div className="stack">
        <PeriodFilter active={period.key as PeriodKey} />
        <div className="stat-grid">
          <Stat label="Feed issued" value={`${(totalKg / 1000).toFixed(2)} t`} hint={period.caption} />
          <Stat label="Feed cost" value={formatNaira(totalCost)} money hint="at issue price" />
          <Stat
            label={`Per ${t.animal.one} per day`}
            value={`${averagePerHead} g`}
            goodWhen="neutral"
          />
          <Stat
            label={`${title(t.group.many)} fed`}
            value={String(new Set(rows.map((row) => row.groupCode)).size)}
          />
        </div>

        <Card title="Feed issued" subtitle="All populations">
          <TrendChart points={series} valueLabel="kg" />
        </Card>

        <Card title="Issues" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Date</th>
                  <th style={{ width: 120 }}>{title(t.group.one)}</th>
                  <th>Feed</th>
                  <th className="right" style={{ width: 90 }}>
                    Quantity
                  </th>
                  <th className="right" style={{ width: 110 }}>
                    Per {t.animal.one}
                  </th>
                  <th className="right" style={{ width: 130 }}>
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((row, index) => (
                  <tr key={`${row.groupCode}-${row.date}-${index}`}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(row.date)}
                    </td>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      {row.groupCode}
                    </td>
                    <td>
                      {row.feedType}
                      <div className="faint">{row.house}</div>
                    </td>
                    <td className="num">{row.kg.toLocaleString('en-NG')} kg</td>
                    <td className="num">{row.gramsPerHead} g</td>
                    <td className="num">{formatNaira(row.costKobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-footer">
            <span className="faint">
              Each issue debits the {t.group.one}&apos;s work-in-progress account and credits
              feed inventory, so this table and the ledger cannot disagree.
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ========================================================================== */
/* Health                                                                      */
/* ========================================================================== */

export async function HealthSection({ module }: { module: SpeciesModule }) {
  const [events, groups, people] = await Promise.all([
    getHealth(module.key),
    getGroups(module.key),
    getActiveNames(),
  ]);
  const t = module.terms;

  const overdue = events.filter((event) => event.status === 'OVERDUE');
  const due = events.filter((event) => event.status === 'DUE');
  const done = events.filter((event) => event.status === 'DONE');

  return (
    <>
      <PageHeader
        title={module.nav.find((n) => n.slug === 'health')?.label ?? 'Health'}
        subtitle={`${module.productName} · schedule and incidents`}
      />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Overdue" value={String(overdue.length)} goodWhen="down" />
          <Stat label="Due soon" value={String(due.length)} goodWhen="neutral" />
          <Stat label="Completed" value={String(done.length)} goodWhen="up" />
          <Stat
            label={`${title(t.group.many)} covered`}
            value={String(new Set(events.map((event) => event.groupCode)).size)}
          />
        </div>

        {overdue.length > 0 ? (
          <div className="notice notice-error">
            {overdue.length} treatment{overdue.length === 1 ? ' is' : 's are'} past due.
          </div>
        ) : null}

        {/*
          Always rendered, even with zero events: this card is also the only
          way to record a treatment (its "Record a treatment" button), and a
          brand new company — with nothing scheduled yet, which is every
          company on day one — could otherwise never record its first one.
          The table's own empty row carries the "nothing scheduled" message
          this used to show instead.
        */}
        <HealthSchedule
          events={events}
          groups={groups
            .filter((group) => group.status === 'ACTIVE')
            .map((group) => ({
              code: group.code,
              house: group.house,
              population: group.population,
              output: (t.outputByPurpose?.[group.purpose] ?? t.output).many,
            }))}
          staff={people.map((person) => person.name)}
          today={new Date().toISOString().slice(0, 10)}
          labels={{
            group: title(t.group.one),
            animal: t.animal.one,
            output: t.output.many,
          }}
        />
      </div>
    </>
  );
}

/* ========================================================================== */
/* Performance                                                                 */
/* ========================================================================== */

export async function PerformanceSection({ module }: { module: SpeciesModule }) {
  const rows = await getPerformance(module.key);
  const t = module.terms;

  return (
    <>
      <PageHeader
        title="Performance"
        subtitle={`How each ${t.group.one} is doing`}
      />

      <div className="stack">
        {/*
          Only shown when it is true. This used to say flatly that no standards
          were configured, which stopped being the case once the published
          breed guides were seeded — a notice that keeps apologising for data it
          now has teaches people to stop reading notices.
        */}
        {rows.every((row) => row.standardMortality === null && row.standardLayRate === null) ? (
          <div className="notice notice-info">
            No breed standard matches these {t.group.many}, so the figures have nothing to be
            measured against. Add a mortality or lay-rate curve for this breed in Setup and
            they become comparable.
          </div>
        ) : (
          <div className="notice notice-info">
            Where a standard is shown it comes from the breeder&apos;s published guide and is
            approximate — verify it against the stock you actually buy. Feed conversion needs
            live weights, which nothing records yet, so it is left blank rather than guessed.
          </div>
        )}

        <Card title={title(t.group.many)} padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>{title(t.group.one)}</th>
                  <th>Breed</th>
                  <th className="right" style={{ width: 110 }}>
                    Mortality
                  </th>
                  <th className="right" style={{ width: 100 }}>
                    Lay rate
                  </th>
                  <th className="right" style={{ width: 90 }}>
                    FCR <HelpTerm k="fcr" />
                  </th>
                  <th className="right" style={{ width: 130 }}>
                    Cost per {t.animal.one}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.group.id}>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      <Link href={`/m/${module.key}/${module.registerSlug}/${row.group.id}`}>
                        {row.group.code}
                      </Link>
                      <div className="faint">{row.group.stage}</div>
                    </td>
                    <td>
                      {row.group.breed}
                      <div className="faint">{row.group.purpose}</div>
                    </td>
                    <td className="num">
                      {/*
                        Red against the breed's own standard where there is one,
                        rather than a flat 5% for every bird on the farm — a
                        broiler at 4% by day 42 is fine and a layer at 4% by
                        week 20 is not.
                      */}
                      <span
                        style={
                          row.standardMortality !== null
                            ? row.mortalityRate > row.standardMortality
                              ? { color: 'var(--error-700)' }
                              : undefined
                            : row.mortalityRate > 5
                              ? { color: 'var(--error-700)' }
                              : undefined
                        }
                      >
                        {row.mortalityRate.toFixed(2)}%
                      </span>
                      {row.standardMortality !== null ? (
                        <div className="faint">std {row.standardMortality.toFixed(1)}%</div>
                      ) : null}
                    </td>
                    <td className="num">
                      {row.layRate !== null ? `${row.layRate}%` : '—'}
                      {row.standardLayRate !== null ? (
                        <div className="faint">std {row.standardLayRate.toFixed(0)}%</div>
                      ) : null}
                    </td>
                    <td className="num">{row.fcr !== null ? row.fcr.toFixed(2) : '—'}</td>
                    <td className="num">{formatNaira(row.costPerHeadKobo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-footer">
            <span className="faint">
              Cost per {t.animal.one} is the {t.group.one}&apos;s accumulated cost divided by
              its live population — it rises as animals are lost, which is the point.
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ========================================================================== */
/* Breeding                                                                    */
/* ========================================================================== */

export async function BreedingSection({ module }: { module: SpeciesModule }) {
  if (module.key === 'poultry') return <PoultryBreedingSection module={module} />;

  const cycles = await getBreedingCycles();
  const t = module.terms;

  const hatched = cycles.filter((cycle) => cycle.hatchRate !== null);
  const averageRate = hatched.length
    ? Number(
        (hatched.reduce((sum, cycle) => sum + (cycle.hatchRate ?? 0), 0) / hatched.length).toFixed(
          1,
        ),
      )
    : 0;

  return (
    <>
      <PageHeader
        title={module.nav.find((n) => n.slug === 'breeding')?.label ?? 'Breeding'}
        subtitle={`${t.breeding} groups and their outcomes`}
      />

      <div className="stack">
        <DemoFlag note="Breeding has no model behind it yet — these cycles are illustrative, not this farm's real records." />
        <div className="stat-grid">
          <Stat label="Average hatch rate" value={`${averageRate}%`} goodWhen="up" hint="completed cycles" />
          <Stat
            label="Eggs laid"
            value={cycles.reduce((sum, cycle) => sum + cycle.eggsLaid, 0).toLocaleString('en-NG')}
          />
          <Stat
            label="Hatchlings"
            value={cycles
              .reduce((sum, cycle) => sum + (cycle.hatchlings ?? 0), 0)
              .toLocaleString('en-NG')}
          />
          <Stat
            label="Incubating"
            value={String(cycles.filter((cycle) => cycle.status === 'INCUBATING').length)}
          />
        </div>

        <Card title="Cycles" subtitle="Most recent first" padded={false}>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Set on</th>
                  <th style={{ width: 110 }}>{title(t.group.one)}</th>
                  <th className="right" style={{ width: 110 }}>
                    Breeders
                  </th>
                  <th className="right" style={{ width: 110 }}>
                    Eggs laid
                  </th>
                  <th className="right" style={{ width: 110 }}>
                    Hatchlings
                  </th>
                  <th className="right" style={{ width: 110 }}>
                    Hatch rate
                  </th>
                  <th style={{ width: 110 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((cycle) => (
                  <tr key={cycle.id}>
                    <td className="num" style={{ textAlign: 'left' }}>
                      {formatDate(cycle.setOn)}
                    </td>
                    <td className="num strong" style={{ textAlign: 'left' }}>
                      {cycle.colonyCode}
                    </td>
                    <td className="num">{cycle.breeders.toLocaleString('en-NG')}</td>
                    <td className="num">{cycle.eggsLaid.toLocaleString('en-NG')}</td>
                    <td className="num">
                      {cycle.hatchlings !== null ? cycle.hatchlings.toLocaleString('en-NG') : '—'}
                    </td>
                    <td className="num">
                      {cycle.hatchRate !== null ? `${cycle.hatchRate}%` : '—'}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          cycle.status === 'HATCHED' ? 'badge-success' : 'badge-warning'
                        }`}
                      >
                        {cycle.status.toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

/**
 * The real thing, for poultry: egg collection, incubation and hatching,
 * backed by `EggCollectionBatch`/`IncubationBatch`/`HatchEvent` — not the
 * fixture `BreedingSection` above still uses for snail, which has no
 * breeding model in the database at all.
 */
async function PoultryBreedingSection({ module }: { module: SpeciesModule }) {
  const [eggBatches, incubationBatches, layingGroups] = await Promise.all([
    getEggBatches(),
    getIncubationBatches(),
    getLayingGroups(),
  ]);

  return (
    <>
      <PageHeader
        title={module.nav.find((n) => n.slug === 'breeding')?.label ?? 'Breeding'}
        subtitle="Eggs collected, set to incubate, and what hatched"
      />
      <PoultryBreeding
        eggBatches={eggBatches}
        incubationBatches={incubationBatches}
        layingGroups={layingGroups}
        today={new Date().toISOString().slice(0, 10)}
      />
    </>
  );
}

/* ========================================================================== */
/* Growth / stages                                                             */
/* ========================================================================== */

export async function GrowthSection({ module }: { module: SpeciesModule }) {
  const [buckets, groups] = await Promise.all([
    getStageBreakdown(module.key, module.terms.stages),
    getGroups(module.key),
  ]);
  const t = module.terms;
  const total = buckets.reduce((sum, bucket) => sum + bucket.population, 0);
  const active = groups.filter((group) => group.status === 'ACTIVE');

  return (
    <>
      <PageHeader
        title={module.nav.find((n) => n.slug === 'growth')?.label ?? 'Growth'}
        subtitle={`Population by lifecycle stage`}
      />

      <div className="stack">
        <Card title="Stages" subtitle={`${total.toLocaleString('en-NG')} ${t.animal.many} in total`}>
          {buckets.length === 0 ? (
            <EmptyState
              icon={<IconClipboard size={22} />}
              title="Nothing to show"
              body={`No ${t.group.one} is at a tracked stage.`}
            />
          ) : (
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              {buckets.map((bucket) => (
                <div key={bucket.stage}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 500 }}>{bucket.stage}</span>
                    <span className="num">
                      {bucket.population.toLocaleString('en-NG')}
                      <span className="faint" style={{ marginLeft: 8 }}>
                        {total > 0 ? `${Math.round((bucket.population / total) * 100)}%` : ''}
                      </span>
                    </span>
                  </div>
                  <div className="meter">
                    <div
                      className="meter-fill"
                      style={{ width: `${total > 0 ? (bucket.population / total) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="faint" style={{ marginTop: 4 }}>
                    {bucket.groups.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Moving between stages">
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <p className="muted" style={{ fontSize: 14 }}>
              Movement between stages is recorded as an event against the {t.group.one}, so the
              population that leaves one stage is exactly the population that enters the next.
            </p>
            <div>
              <StageChange
                groups={active.map((group) => ({
                  id: group.id,
                  code: group.code,
                  house: group.house,
                  stage: group.stage,
                  population: group.population,
                }))}
                stages={t.stages}
                houses={[...new Set(active.map((group) => group.house))].sort()}
                today={new Date().toISOString().slice(0, 10)}
                labels={{
                  group: title(t.group.one),
                  animal: t.animal.one,
                  housing: t.housing.one,
                }}
                trigger={`Move a ${t.group.one} to another stage`}
              />
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

/* ========================================================================== */
/* Harvest                                                                     */
/* ========================================================================== */

export async function HarvestSection({ module }: { module: SpeciesModule }) {
  const [rows, groups] = await Promise.all([
    getHarvests(module.key),
    getGroups(module.key),
  ]);
  const t = module.terms;

  const totalKg = rows.reduce((sum, row) => sum + row.kg, 0);
  const totalValue = rows.reduce((sum, row) => sum + toKobo(row.valueKobo), 0n);

  return (
    <>
      <PageHeader
        title={module.nav.find((n) => n.slug === 'harvest')?.label ?? 'Harvest'}
        subtitle={`What has come off the farm`}
      />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Harvested" value={`${totalKg} kg`} hint="last 16 days" />
          <Stat label="Value" value={formatNaira(totalValue)} money hint="at standard cost" />
          <Stat
            label="Harvests"
            value={String(rows.length)}
          />
          <Stat
            label={`${title(t.group.many)} harvested`}
            value={String(new Set(rows.map((row) => row.colonyCode)).size)}
          />
        </div>

        <HarvestLog
          rows={rows}
          groups={groups
            .filter((group) => group.status === 'ACTIVE')
            .map((group) => ({
              code: group.code,
              house: group.house,
              population: group.population,
            }))}
          // The grades the farm has actually used, so the list cannot offer one
          // that means nothing here.
          grades={[...new Set(rows.map((row) => row.grade))].sort((a, b) => a.localeCompare(b))}
          today={new Date().toISOString().slice(0, 10)}
          labels={{ group: title(t.group.one), animal: t.animal.one }}
        />
      </div>
    </>
  );
}

/* ========================================================================== */

export const SECTION_COMPONENTS: Record<
  string,
  (props: { module: SpeciesModule; period?: string }) => Promise<React.ReactElement>
> = {
  production: ProductionSection,
  feeding: FeedingSection,
  health: HealthSection,
  performance: PerformanceSection,
  breeding: BreedingSection,
  growth: GrowthSection,
  harvest: HarvestSection,
};

export { IconAlert, IconBox };
