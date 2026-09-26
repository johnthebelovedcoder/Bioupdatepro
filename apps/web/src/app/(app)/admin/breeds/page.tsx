import { api } from '@/lib/api';
import { getFarmConfig } from '@/lib/farm-config.server';
import { subscribedModules } from '@/lib/modules';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { BreedForm } from '@/components/breed-form';
import { StageStandardsForm } from '@/components/stage-standards';

export const metadata = { title: 'Breeds — BioAssetPro' };

interface Breed {
  id: string;
  speciesKey: string;
  code: string;
  name: string;
  classification: string | null;
  openingStage: string;
  stages: Array<{ id: string; stageName: string; minDay: number; targetWeightGrams: number | null; dailyFeedGramsPerHead: number | null }>;
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
                          <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>
                            {breed.stages.length === 0 ? (
                              '—'
                            ) : (
                              <details>
                                <summary className="faint">
                                  {breed.stages.map((s) => `${s.stageName} ${s.minDay}`).join(' · ')}
                                </summary>
                                <div className="stack" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                                  <span className="faint" style={{ fontSize: 12 }}>
                                    Target live weight and feed per head per day, in grams — harvest readiness and the feed plan use them.
                                  </span>
                                  {breed.stages.map((s) => (
                                    <StageStandardsForm key={s.id} stage={s} />
                                  ))}
                                </div>
                              </details>
                            )}
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
