import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getRecipeDetail, getCostPools, getRoutingOperations } from '@/lib/production';
import { getPurchasableItems } from '@/lib/trade';
import { getCostCentres } from '@/lib/masters';
import { Card, PageHeader } from '@/components/ui';
import { AddRecipeComponentButton } from '@/components/add-recipe-component-button';
import { ActivateRecipeVersionButton } from '@/components/activate-recipe-version-button';
import { ExplodeRecipeForm } from '@/components/explode-recipe-form';
import { AddRoutingOperationButton } from '@/components/add-routing-operation-button';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getRecipeDetail(id);
  return { title: detail ? `${detail.recipe.code} — BioAssetPro` : 'BioAssetPro' };
}

/**
 * One recipe: its output, and every version it has ever had.
 *
 * A version's components are only editable while it is DRAFT — the moment it
 * activates it becomes a costed, effective-dated fact that past production
 * orders were exploded against, and changing it under them would rewrite
 * history. A correction is a new version, not an edit to this one.
 */
export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, items, costCentres, costPools] = await Promise.all([
    getRecipeDetail(id),
    getPurchasableItems(),
    getCostCentres(),
    getCostPools(),
  ]);
  if (!detail) notFound();

  const { recipe, versions } = detail;
  const routingByVersion = new Map(
    await Promise.all(
      versions.map(async (version) => [version.id, await getRoutingOperations(version.id)] as const),
    ),
  );

  return (
    <>
      <PageHeader
        title={recipe.code}
        subtitle={`${recipe.name} · produces ${recipe.outputItem.code} — ${recipe.outputItem.description}`}
      />

      <div className="stack">
        <div className="row" style={{ gap: 6 }}>
          <Link href="/production/recipes" className="faint">
            Recipes
          </Link>
          <span className="faint">/</span>
          <span className="faint">{recipe.code}</span>
        </div>

        {versions.length === 0 ? (
          <Card title="No versions yet">
            <p className="faint">
              Something went wrong creating this recipe&apos;s first version — raise a new one to
              give it components.
            </p>
          </Card>
        ) : (
          versions.map((version) => (
            <Card
              key={version.id}
              title={`Version ${version.version}`}
              subtitle={`Batch size ${version.batchSize} · effective ${version.effectiveFrom.slice(0, 10)}${version.effectiveTo ? ` to ${version.effectiveTo.slice(0, 10)}` : ''}`}
              padded={false}
              action={
                <div className="row" style={{ gap: 'var(--sp-2)', alignItems: 'center' }}>
                  {version.components.length > 0 ? (
                    <ExplodeRecipeForm recipeVersionId={version.id} batchSize={version.batchSize} />
                  ) : null}
                  {version.status === 'ACTIVE' ? (
                    <span className="badge badge-success">active</span>
                  ) : version.status === 'SUPERSEDED' ? (
                    <span className="badge">superseded</span>
                  ) : (
                    <span className="badge badge-warning">draft</span>
                  )}
                </div>
              }
            >
              {version.components.length === 0 ? (
                <div style={{ padding: 'var(--sp-4)' }}>
                  <p className="faint">
                    No components yet. {version.status === 'DRAFT' ? 'Add at least one before activating.' : ''}
                  </p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 150 }}>Item</th>
                        <th className="right" style={{ width: 140 }}>
                          Per batch
                        </th>
                        <th className="right" style={{ width: 100 }}>
                          Wastage
                        </th>
                        <th style={{ width: 90 }}>Optional</th>
                      </tr>
                    </thead>
                    <tbody>
                      {version.components.map((component) => (
                        <tr key={component.id}>
                          <td style={{ textAlign: 'left' }}>
                            <span className="strong">{component.componentItem.code}</span>
                            <div className="faint">{component.componentItem.description}</div>
                          </td>
                          <td className="num">
                            {component.quantityPerBatch} {component.unitOfMeasure.code}
                          </td>
                          <td className="num">
                            {component.wastagePercent ? `${component.wastagePercent}%` : '—'}
                          </td>
                          <td className="faint">{component.optional ? 'yes' : 'no'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/*
                Routing — US-897-014. Its own sub-section rather than folded
                into the components table: a component is what the recipe
                consumes, an operation is a step it goes through, and the two
                have different fields (item/quantity vs. resource/hours).
              */}
              {(() => {
                const operations = routingByVersion.get(version.id) ?? [];
                return (
                  <div style={{ padding: 'var(--sp-4)', borderTop: '1px solid var(--border)' }}>
                    <div
                      className="row"
                      style={{ justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}
                    >
                      <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Routing</h3>
                      <AddRoutingOperationButton
                        recipeId={recipe.id}
                        recipeVersionId={version.id}
                        costCentres={costCentres}
                        costPools={costPools}
                      />
                    </div>
                    {operations.length === 0 ? (
                      <p className="faint">
                        No labour or machine standards yet. Optional — a recipe with no routing
                        costs on materials alone.
                      </p>
                    ) : (
                      <div className="table-wrap">
                        <table className="data">
                          <thead>
                            <tr>
                              <th style={{ width: 40 }}>#</th>
                              <th>Operation</th>
                              <th style={{ width: 90 }}>Resource</th>
                              <th>Cost centre</th>
                              <th>Cost pool</th>
                              <th className="right" style={{ width: 90 }}>
                                Setup h
                              </th>
                              <th className="right" style={{ width: 100 }}>
                                Run h/unit
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {operations.map((op) => (
                              <tr key={op.id}>
                                <td className="faint">{op.sequence}</td>
                                <td className="strong" style={{ textAlign: 'left' }}>
                                  {op.operationName}
                                </td>
                                <td className="faint">{op.resourceType.toLowerCase()}</td>
                                <td className="faint">{op.costCentre.code}</td>
                                <td className="faint">{op.costPool.code}</td>
                                <td className="num">{op.setupHours}</td>
                                <td className="num">{op.runHoursPerUnit}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {version.status === 'DRAFT' ? (
                <div
                  className="row"
                  style={{
                    gap: 'var(--sp-3)',
                    padding: 'var(--sp-4)',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <AddRecipeComponentButton recipeId={recipe.id} recipeVersionId={version.id} items={items} />
                  {version.components.length > 0 ? (
                    <ActivateRecipeVersionButton recipeId={recipe.id} recipeVersionId={version.id} />
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))
        )}
      </div>
    </>
  );
}
