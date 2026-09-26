import Link from 'next/link';
import { getProductionOrders, getRecipes } from '@/lib/production';
import { formatDate, formatNaira, formatQuantity } from '@/lib/money';
import { Card, CardLink, EmptyState, PageHeader, Stat } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { IconFeed } from '@/components/icons';

export const metadata = { title: 'Feed mill — BioAssetPro' };

const OPEN = new Set(['DRAFT', 'SUBMITTED', 'APPROVED', 'RELEASED', 'IN_PRODUCTION']);

/**
 * The feed mill as its own segment (Segment P&L: Farm | Feed mill |
 * Processing): its milling runs, what finished feed has cost, and what is
 * still on the floor. A run is an ordinary processing order on the FEED_MILL
 * cycle — raised, issued and costed on the same screens — so this page
 * gathers them rather than duplicating the workflow.
 */
export default async function FeedMillPage() {
  const [orders, recipes] = await Promise.all([getProductionOrders(), getRecipes()]);
  const runs = orders.filter((order) => order.processingCycle === 'FEED_MILL');
  const completed = runs.filter((order) => order.status === 'COMPLETED');
  const open = runs.filter((order) => OPEN.has(order.status));

  const milledQuantity = completed.reduce((sum, order) => sum + Number(order.plannedOutputQuantity), 0);
  const milledCost = completed.reduce((sum, order) => sum + BigInt(order.finishedGoodsCostKobo), 0n);
  const costPerUnit = milledQuantity > 0 ? String(Math.round(Number(milledCost) / milledQuantity)) : null;

  const feedOutputs = new Set(runs.map((order) => order.recipeVersion.recipe.outputItemId));
  const feedRecipes = recipes.filter((recipe) => feedOutputs.has(recipe.outputItemId));

  return (
    <>
      <PageHeader title="Feed mill" subtitle="Milling runs, what finished feed costs, and what is still in production" />
      <Tabs />
      <div className="stack">
        <div className="stat-grid">
          <Stat label="Runs completed" value={String(completed.length)} />
          <Stat label="In progress" value={String(open.length)} />
          <Stat label="Feed milled" value={formatQuantity(String(milledQuantity))} hint="Completed runs, planned output" />
          <Stat label="Cost a unit" value={costPerUnit ? formatNaira(costPerUnit) : '—'} hint="Finished cost ÷ quantity, completed runs" />
        </div>

        <Card
          title="Milling runs"
          subtitle="Raise a run from Processing orders, choosing the Feed mill cycle"
          action={<CardLink href="/production">Raise a run</CardLink>}
          padded={false}
        >
          {runs.length === 0 ? (
            <EmptyState
              icon={<IconFeed size={22} />}
              title="No milling runs yet"
              body="A run takes feed ingredients from the store, mills them by an approved recipe, and puts finished feed back at its full cost."
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>Run</th>
                    <th>Feed</th>
                    <th className="right" style={{ width: 130 }}>Quantity</th>
                    <th className="right" style={{ width: 140 }}>Finished cost</th>
                    <th className="right" style={{ width: 120 }}>A unit</th>
                    <th style={{ width: 130 }}>Status</th>
                    <th style={{ width: 110 }}>Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((order) => {
                    const quantity = Number(order.plannedOutputQuantity);
                    const cost = BigInt(order.finishedGoodsCostKobo);
                    return (
                      <tr key={order.id}>
                        <td className="num strong" style={{ textAlign: 'left' }}>
                          <Link href={`/production/${order.id}`}>{order.orderNumber}</Link>
                        </td>
                        <td className="faint">
                          {order.recipeVersion.recipe.outputItem.code} — {order.recipeVersion.recipe.outputItem.description}
                        </td>
                        <td className="num">{formatQuantity(order.plannedOutputQuantity)}</td>
                        <td className="num">{formatNaira(order.finishedGoodsCostKobo)}</td>
                        <td className="num">
                          {cost > 0n && quantity > 0 ? formatNaira(String(Math.round(Number(cost) / quantity))) : '—'}
                        </td>
                        <td>
                          <span className={`badge ${order.status === 'COMPLETED' ? 'badge-success' : order.status === 'CANCELLED' ? 'badge-danger' : 'badge-warning'}`}>
                            {order.status.toLowerCase().replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {formatDate(order.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Feed recipes" subtitle="Formulations a run can be milled by" action={<CardLink href="/production/recipes">All recipes</CardLink>}>
          {feedRecipes.length === 0 ? (
            <p className="faint">
              Recipes appear here once a milling run has used them. Set one up under <Link href="/production/recipes">Recipes</Link>.
            </p>
          ) : (
            <ul className="stack" style={{ gap: 'var(--sp-2)', margin: 0, paddingLeft: 18 }}>
              {feedRecipes.map((recipe) => (
                <li key={recipe.id}>
                  <Link href={`/production/recipes/${recipe.id}`}>{recipe.code}</Link> <span className="faint">{recipe.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Also for the mill">
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            <CardLink href="/production/standard-costs">Standard costs — what finished feed is received at, a kilo</CardLink>
            <CardLink href="/production/cost-pools">Cost pools — the milling overhead a run absorbs by machine hours</CardLink>
            <CardLink href="/inventory">Ingredient and finished-feed stock</CardLink>
            <CardLink href="/ledger/profit-loss">Feed mill segment in the profit and loss</CardLink>
          </div>
        </Card>
      </div>
    </>
  );
}
