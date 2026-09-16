import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getRecipeDetail } from '@/lib/production';
import { getPurchasableItems } from '@/lib/trade';
import { Card, PageHeader } from '@/components/ui';
import { AddRecipeComponentButton } from '@/components/add-recipe-component-button';
import { ActivateRecipeVersionButton } from '@/components/activate-recipe-version-button';

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
  const [detail, items] = await Promise.all([getRecipeDetail(id), getPurchasableItems()]);
  if (!detail) notFound();

  const { recipe, versions } = detail;

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
                version.status === 'ACTIVE' ? (
                  <span className="badge badge-success">active</span>
                ) : version.status === 'SUPERSEDED' ? (
                  <span className="badge">superseded</span>
                ) : (
                  <span className="badge badge-warning">draft</span>
                )
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
