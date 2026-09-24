import { api } from '@/lib/api';
import { getFarmConfig } from '@/lib/farm-config.server';
import { subscribedModules } from '@/lib/modules';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { BreedForm } from '@/components/breed-form';

export const metadata = { title: 'Breeds — BioAssetPro' };

interface Breed {
  id: string;
  speciesKey: string;
  code: string;
  name: string;
  classification: string | null;
  openingStage: string;
  stages: Array<{ stageName: string; minDay: number }>;
}

/**
 * The breeds this farm keeps, per species, with the age each stage starts at.
 *
 * Placement suggests these, and a stage change earlier than the breed's own
 * threshold is flagged for review — never refused, since a farm's records are
 * the truth and the registry only a guide.
 */
export default async function BreedsPage() {
  const [config, breeds] = await Promise.all([
    getFarmConfig(),
    api<Breed[]>('/masters/species-breeds').catch(() => [] as Breed[]),
  ]);
  const modules = subscribedModules(config.modules);

  return (
    <>
      <PageHeader title="Breeds" subtitle="What each species' stages mean in days, breed by breed" />

      <Tabs />

      <div className="stack">
        {modules.map((module) => {
          const rows = breeds.filter((breed) => breed.speciesKey === module.key);
          return (
            <Card
              key={module.key}
              title={module.label}
              subtitle={`${rows.length} breed${rows.length === 1 ? '' : 's'}`}
              action={
                <BreedForm
                  speciesKey={module.key}
                  speciesLabel={module.label}
                  stages={module.terms.stages}
                />
              }
              padded={false}
            >
              {rows.length === 0 ? (
                <p className="faint" style={{ padding: 'var(--sp-5)' }}>
                  None yet. Placement still works without one — a breed here only adds the age
                  checks.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="data wide">
                    <thead>
                      <tr>
                        <th style={{ width: 120 }}>Code</th>
                        <th>Name</th>
                        <th style={{ width: 140 }}>Starts at</th>
                        <th>Stages (from day)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((breed) => (
                        <tr key={breed.id}>
                          <td className="num strong" style={{ textAlign: 'left' }}>
                            {breed.code}
                          </td>
                          <td style={{ textAlign: 'left' }}>
                            {breed.name}
                            {breed.classification ? (
                              <div className="faint">{breed.classification}</div>
                            ) : null}
                          </td>
                          <td>{breed.openingStage}</td>
                          <td className="faint" style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                            {breed.stages.map((s) => `${s.stageName} ${s.minDay}`).join(' · ') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
