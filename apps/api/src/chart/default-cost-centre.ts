import { chartVersionOf } from './chart';

interface CostCentreReader {
  company: { findUnique(args: { where: { id: string }; select: { chartVersion: true } }): Promise<{ chartVersion: string } | null> };
  costCentre: {
    findFirst(args: {
      where: { companyId: string; active: true; postingAllowed: true };
      orderBy: { code: 'asc' };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
}

/**
 * The cost centre an order takes when none was named, on the approved chart.
 *
 * Nearly every approved account an order's documents post to — revenue, cost
 * of sales, inventory and fixed-asset controls — requires a cost centre, and
 * the farm screens that raise orders (Record a sale, Buy supplies) do not ask
 * for one, so the delivery, goods receipt or invoice would be refused at
 * approval time. The company's first active cost centre that allows posting
 * stands in; an order that names one keeps it. The old charts require none, so
 * they are left as they are.
 */
export async function approvedDefaultCostCentreId(client: CostCentreReader, companyId: string): Promise<string | null> {
  if ((await chartVersionOf(client, companyId)) !== 'APPROVED') return null;
  const centre = await client.costCentre.findFirst({
    where: { companyId, active: true, postingAllowed: true },
    orderBy: { code: 'asc' },
    select: { id: true },
  });
  return centre?.id ?? null;
}
