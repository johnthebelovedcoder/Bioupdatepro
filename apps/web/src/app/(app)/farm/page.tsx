import { getFarms, getPens } from '@/lib/masters';
import { getGroups } from '@/lib/operations';
import { subscribedModules } from '@/lib/modules';
import { getFarmConfig } from '@/lib/farm-config.server';
import { Card, PageHeader, Stat } from '@/components/ui';
import { IconFarm } from '@/components/icons';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Farms & pens — BioAssetPro' };

/**
 * The farm hierarchy: sites, the houses inside them, and what is living in
 * each — now real (`/masters/farms`, `/masters/pens`, both live endpoints).
 *
 * What is NOT real, and stays that way honestly rather than being invented:
 * capacity. `FarmStructureService`'s own docblock says why — capacity, house
 * type and environmental limits are not in any source document yet, and a
 * capacity meter with no capacity to measure against would be a number
 * nobody measured. So there is no "space used" figure and no meter here;
 * the page shows what a house holds, not what it holds against.
 *
 * Deliberately not species-scoped. A farm holds birds and snails at the same
 * time, and the person walking it needs one picture of the whole site rather
 * than two lists behind a module switch.
 */
export default async function FarmPage() {
  const config = await getFarmConfig();
  const moduleKeys = subscribedModules(config.modules).map((module) => module.key);

  const [farms, pens, ...groupLists] = await Promise.all([
    getFarms(),
    getPens(),
    ...moduleKeys.map((key) => getGroups(key)),
  ]);
  const groups = groupLists.flat().filter((group) => group.status === 'ACTIVE');

  const housesByFarm = pens.reduce<Record<string, typeof pens>>((byFarm, pen) => {
    (byFarm[pen.farmId] ??= []).push(pen);
    return byFarm;
  }, {});
  // Matched by name — the same value `/operations/groups` reports as `house`
  // comes from this exact pen's own name, so this is a real join, not a guess.
  const groupsByHouse = groups.reduce<Record<string, typeof groups>>((byHouse, group) => {
    (byHouse[group.house] ??= []).push(group);
    return byHouse;
  }, {});

  const totalPopulation = groups.reduce((sum, group) => sum + group.population, 0);

  return (
    <>
      <PageHeader title="Farms & pens" subtitle="Sites, houses and what is living in each" />

      <Tabs />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Farms" value={String(farms.length)} />
          <Stat label="Houses & pens" value={String(pens.length)} />
          <Stat label="Animals housed" value={totalPopulation.toLocaleString('en-NG')} />
        </div>

        {farms.map((farm) => (
          <Card key={farm.id} title={farm.name} subtitle={farm.code} padded={false}>
            {(housesByFarm[farm.id] ?? []).map((house) => {
              const inHouse = groupsByHouse[house.name] ?? [];
              const population = inHouse.reduce((sum, group) => sum + group.population, 0);
              return (
                <div className="list-row" key={house.id}>
                  <span className="list-icon">
                    <IconFarm size={16} />
                  </span>
                  <div className="list-main">
                    <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                      <span className="list-title">{house.name}</span>
                      <span className="num" style={{ fontSize: 13 }}>
                        {population.toLocaleString('en-NG')}
                      </span>
                    </div>
                    <div className="list-sub">
                      {inHouse.length === 0
                        ? 'Empty'
                        : inHouse
                            .map((group) => `${group.code} · ${group.purpose} · ${group.stage}`)
                            .join('  ·  ')}
                    </div>
                  </div>
                </div>
              );
            })}
            {(housesByFarm[farm.id] ?? []).length === 0 ? (
              <p className="muted" style={{ fontSize: 14, padding: 'var(--sp-4)' }}>
                No pens set up yet for this farm.
              </p>
            ) : null}
          </Card>
        ))}

        {farms.length === 0 ? (
          <Card>
            <p className="muted" style={{ fontSize: 14 }}>
              No farms set up yet.
            </p>
          </Card>
        ) : null}
      </div>
    </>
  );
}
