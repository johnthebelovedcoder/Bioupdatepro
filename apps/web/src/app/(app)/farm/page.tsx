import { getFarmStructure } from '@/lib/demo-ops';
import { Card, PageHeader, Stat } from '@/components/ui';
import { IconFarm } from '@/components/icons';
import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Farms & pens — BioAssetPro' };

/**
 * The farm hierarchy: sites, the houses inside them, and what is living in each.
 *
 * Deliberately not species-scoped. A farm holds birds and snails at the same
 * time, and the person walking it needs one picture of the whole site rather
 * than two lists behind a module switch.
 */
export default async function FarmPage() {
  const farms = await getFarmStructure();

  const houses = farms.flatMap((farm) => farm.houses);
  const totalPopulation = houses.reduce(
    (sum, house) => sum + house.populations.reduce((inner, p) => inner + p.population, 0),
    0,
  );
  const totalCapacity = houses.reduce((sum, house) => sum + house.capacity, 0);
  const utilisation = totalCapacity > 0 ? Math.round((totalPopulation / totalCapacity) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Farms & pens"
        subtitle="Sites, houses and what is living in each"
      />

      <Tabs />

      <div className="stack">
        <div className="stat-grid">
          <Stat label="Farms" value={String(farms.length)} />
          <Stat label="Houses & pens" value={String(houses.length)} />
          <Stat label="Animals housed" value={totalPopulation.toLocaleString('en-NG')} />
          <Stat
            label="Space used"
            value={`${utilisation}%`}
            goodWhen="neutral"
            hint={`of ${totalCapacity.toLocaleString('en-NG')} places`}
          />
        </div>

        {farms.map((farm) => (
          <Card
            key={farm.code}
            title={farm.name}
            subtitle={`${farm.code} · ${farm.state} State · managed by ${farm.manager}`}
            padded={false}
          >
            {farm.houses.map((house) => {
              const population = house.populations.reduce((sum, p) => sum + p.population, 0);
              const ratio = house.capacity > 0 ? population / house.capacity : 0;
              return (
                <div className="list-row" key={house.name}>
                  <span className="list-icon">
                    <IconFarm size={16} />
                  </span>
                  <div className="list-main">
                    <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                      <span className="list-title">{house.name}</span>
                      <span className="num" style={{ fontSize: 13 }}>
                        {population.toLocaleString('en-NG')}
                        <span className="faint">
                          {' '}
                          / {house.capacity.toLocaleString('en-NG')}
                        </span>
                      </span>
                    </div>
                    <div className="meter">
                      {/*
                        Over capacity is shown in the danger colour rather than
                        clipped at 100%: overcrowding is a welfare and mortality
                        problem, and hiding it would be the wrong kindness.
                      */}
                      <div
                        className={`meter-fill ${ratio > 1 ? 'is-critical' : ratio > 0.9 ? 'is-low' : ''}`}
                        style={{ width: `${Math.min(100, ratio * 100)}%` }}
                      />
                    </div>
                    <div className="list-sub">
                      {house.populations.length === 0
                        ? 'Empty'
                        : house.populations
                            .map((p) => `${p.code} · ${p.purpose} · ${p.stage}`)
                            .join('  ·  ')}
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
        ))}

        <Card>
          <p className="muted" style={{ fontSize: 14 }}>
            A farm currently exists in the database only as a tag on journal lines. Capacity,
            occupancy and the house hierarchy shown here are not yet stored — they are what
            this screen will read once the farm structure is modelled.
          </p>
        </Card>
      </div>
    </>
  );
}
