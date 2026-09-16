import Link from 'next/link';
import { getRecipes } from '@/lib/production';
import { getPurchasableItems } from '@/lib/trade';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { NewRecipeButton } from '@/components/new-recipe-button';
import { IconBox } from '@/components/icons';

export const metadata = { title: 'Recipes — BioAssetPro' };

/**
 * Recipes — the bill of materials a processing order runs against.
 *
 * A recipe with an active version is ready to use; one still a draft needs
 * its components added and then activating — both from its own page, since
 * a component list belongs with the recipe it describes, not in a table row.
 */
export default async function RecipesPage() {
  const [recipes, items] = await Promise.all([getRecipes(), getPurchasableItems()]);

  return (
    <>
      <PageHeader
        title="Recipes"
        subtitle="What a processing order consumes to make one batch of output"
      />

      <div className="stack">
        <Tabs />

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <NewRecipeButton items={items} />
        </div>

        <Card title={`${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}`} padded={false}>
          {recipes.length === 0 ? (
            <EmptyState
              icon={<IconBox size={22} />}
              title="No recipes yet"
              body="Add the first one above. A processing order needs a recipe to run against — nothing can be raised until one exists."
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Code</th>
                    <th>Name</th>
                    <th>Produces</th>
                    <th style={{ width: 100 }}>Batch size</th>
                    <th style={{ width: 100 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recipes.map((recipe) => (
                    <tr key={recipe.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        <Link href={`/production/recipes/${recipe.id}`}>{recipe.code}</Link>
                      </td>
                      <td>{recipe.name}</td>
                      <td className="faint">
                        {recipe.outputItemCode} — {recipe.outputItemDescription}
                      </td>
                      <td className="num">{recipe.batchSize ?? '—'}</td>
                      <td>
                        {recipe.activeVersionId ? (
                          <span className="badge badge-success">
                            v{recipe.activeVersionNumber} active
                          </span>
                        ) : (
                          <span className="badge badge-warning">no active version</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
