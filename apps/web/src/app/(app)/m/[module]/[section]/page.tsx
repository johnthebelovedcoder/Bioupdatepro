import { notFound } from 'next/navigation';
import { getModule, title, type SpeciesModule } from '@/lib/modules';
import { getGroups } from '@/lib/operations';
import { getFarmConfig } from '@/lib/farm-config.server';
import { getYesterday } from '@/lib/operations';
import { NotBuiltYet } from '@/components/ui';
import { Register } from '@/components/register';
import { DailyRecordEntry } from '@/components/daily-record';
import { SECTION_COMPONENTS } from '@/components/sections';

/**
 * Any section within a species module.
 *
 * One route for every section of every module. The plan shown is composed from
 * the module's own vocabulary, so the snail version says "colony" and "pen"
 * where the poultry version says "batch" and "house" — without either being
 * written out twice.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ module: string; section: string }>;
}) {
  const { module: key, section } = await params;
  const module = getModule(key);
  const item = module?.nav.find((entry) => entry.slug === section);
  return {
    title: item && module ? `${item.label} — ${module.productName}` : 'BioAssetPro',
  };
}

export default async function ModuleSectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ module: string; section: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { module: key, section } = await params;
  const module = getModule(key);
  if (!module || !module.subscribed) notFound();

  const item = module.nav.find((entry) => entry.slug === section);
  if (!item) notFound();

  if (section === 'records') {
    const query = await searchParams;
    const [groups, config] = await Promise.all([getGroups(module.key), getFarmConfig()]);

    /*
     * Yesterday's figures, so the round can offer them as a starting point.
     * Only fetched when the farm has that shortcut switched on — there is no
     * point paying for the read otherwise.
     */
    const yesterday = config.operations.sameAsYesterday
      ? await getYesterday(module.key, config.operations.collectionLabels)
      : undefined;
    return (
      <DailyRecordEntry
        moduleKey={module.key}
        groups={groups.filter((group) => group.status === 'ACTIVE')}
        today={new Date().toISOString().slice(0, 10)}
        collectionLabels={config.operations.collectionLabels}
        mortalityPhoto={config.operations.mortalityPhoto}
        multipleCauses={config.operations.multipleMortalityCauses}
        sameAsYesterday={config.operations.sameAsYesterday}
        explainOutliers={config.operations.explainOutliers}
        yesterday={yesterday}
        language={config.organisation.workerLanguage}
        // Arriving from a population's page opens the round on that stop.
        {...(query.at ? { startAt: query.at } : {})}
      />
    );
  }

  if (section === module.registerSlug) {
    const query = await searchParams;
    const all = await getGroups(module.key);

    const filters = {
      status: query.status ?? '',
      house: query.house ?? '',
      purpose: query.purpose ?? '',
      stage: query.stage ?? '',
      search: query.search ?? '',
    };

    const needle = filters.search.trim().toLowerCase();
    const groups = all.filter((group) => {
      // Default view is working populations only; closed ones are history and
      // would otherwise accumulate at the top of the list forever.
      if (filters.status === 'CLOSED' && group.status !== 'CLOSED') return false;
      if (filters.status === '' && group.status !== 'ACTIVE') return false;
      if (filters.house && group.house !== filters.house) return false;
      if (filters.purpose && group.purpose !== filters.purpose) return false;
      if (filters.stage && group.stage !== filters.stage) return false;
      if (needle) {
        const haystack = `${group.code} ${group.breed} ${group.purpose}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    return (
      <Register
        module={module}
        groups={groups}
        filters={filters}
        options={{
          // Options come from the data actually present, not a fixed list, so
          // they never offer a filter that returns nothing.
          houses: unique(all.map((group) => group.house)),
          purposes: unique(all.map((group) => group.purpose)),
          stages: unique(all.map((group) => group.stage)),
        }}
      />
    );
  }

  // Everything else the module declares has a screen of its own.
  const Section = SECTION_COMPONENTS[section];
  if (Section) {
    const query = await searchParams;
    return <Section module={module} {...(query.period ? { period: query.period } : {})} />;
  }

  return (
    <NotBuiltYet
      title={item.label}
      summary={`${module.productName} · ${summaryFor(module, section)}`}
      // NotBuiltYet already opens with "Nothing here is implemented"; this
      // continues that sentence rather than repeating it.
      dependsOn={`There is no ${module.terms.group.one}, event or production model in the database yet.`}
      planned={plannedFor(module, section)}
    />
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function summaryFor(module: SpeciesModule, section: string): string {
  const t = module.terms;
  switch (section) {
    case 'batches':
    case 'colonies':
      return `Every ${t.group.one} of ${t.animal.many}, with population and stage.`;
    case 'records':
      return `What happened today in each ${t.housing.one}.`;
    case 'production':
      return `${title(t.output.many)} collected, by ${t.housing.one} and ${t.group.one}.`;
    case 'breeding':
      // Not `${t.breeding} cycles` — for snails that term is already "Breeding
      // cycle", which reads as "Breeding cycle cycles".
      return 'Breeding groups, eggs laid, and what hatched.';
    case 'growth':
      return `Movement through ${t.stages.join(', ').toLowerCase()}.`;
    case 'feeding':
      return `Feed issued to each ${t.group.one}, and what it cost.`;
    case 'health':
      return 'Vaccination schedule, treatments and disease incidents.';
    case 'harvest':
      return `${t.offtake} records and what came off the farm.`;
    case 'performance':
      return `How each ${t.group.one} is performing against its standard.`;
    default:
      return '';
  }
}

function plannedFor(module: SpeciesModule, section: string): string[] {
  const t = module.terms;
  const G = t.group.one;
  const Gs = t.group.many;
  const A = t.animal.one;
  const As = t.animal.many;
  const H = t.housing.one;

  switch (section) {
    case 'batches':
    case 'colonies':
      return [
        `Register of every ${G}: breed, purpose, ${H}, opening and current ${As}`,
        `${t.intake} records, with source and cost`,
        `Lifecycle stage — ${t.stages.join(' → ')}`,
        `Transfers between ${t.housing.many}, and splits or merges`,
        `Cost accumulated against the ${G}, and profit when it closes`,
      ];
    case 'records':
      return [
        `One form per ${H} per day: feed issued, ${t.output.many}, mortality`,
        'Mortality with cause, and a photograph where useful',
        `${title(As)} count updates automatically — never typed twice`,
        'Submitted by the worker who did the work, and recorded against them',
      ];
    case 'production':
      return [
        `${title(t.output.many)} by ${H}, ${G} and day`,
        'Whole, cracked and dirty recorded separately',
        'Hen-day production and lay rate per batch',
        'Production against the breed standard curve',
      ];
    case 'breeding':
      return [
        `${title(t.breeding)} groups and the dates they were set`,
        'Eggs laid, hatched, and hatch rate',
        `New ${As} counted and added to the ${G} population`,
        'History retained for every completed cycle',
      ];
    case 'growth':
      return [
        `Population by stage: ${t.stages.join(', ')}`,
        'Stage transitions, with the count moved and when',
        'Sampled weights extrapolated to the population',
        'Growth against expectation for the breed',
      ];
    case 'feeding':
      return [
        `Feed issued to a ${G}, decrementing inventory automatically`,
        'Consumption per head and per day',
        'Feed cost accumulating against the batch',
        'Wastage recorded separately from consumption',
      ];
    case 'health':
      return [
        'Vaccination schedule, planned against administered',
        'Treatments, dose and withdrawal periods',
        'Disease incidents with symptoms and outcome',
        'Mortality linked to the incident that caused it',
      ];
    case 'harvest':
      return [
        `${title(t.offtake)} records by ${G} and grade`,
        'Weight and count captured at harvest',
        'Finished stock moving into inventory',
        'Cost transferred out of the batch at the point of harvest',
      ];
    case 'performance':
      return [
        `Mortality rate per ${G} against its normal curve`,
        module.key === 'poultry'
          ? 'Feed conversion ratio for broilers, hen-day production for layers'
          : 'Feed conversion and growth rate against stage expectation',
        `Cost per live ${A}`,
        `${title(G)} profitability, read from the ledger`,
      ];
    default:
      return [];
  }
}
