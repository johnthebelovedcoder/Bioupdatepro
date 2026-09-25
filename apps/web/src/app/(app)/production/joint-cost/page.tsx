import { api } from '@/lib/api';
import { getStockItems } from '@/lib/masters';
import { formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { JointCostControls, ProposePriceForm } from '@/components/joint-cost-forms';

export const metadata = { title: 'Joint-cost prices — BioAssetPro' };

interface JointCost {
  method: string;
  prices: Array<{
    id: string;
    itemCode: string;
    itemDescription: string;
    sellingPricePerUnitKobo: string;
    furtherCostPerUnitKobo: string;
    effectiveFrom: string;
    evidenceReference: string;
    status: string;
    proposedBy: string;
    approvedBy: string | null;
    rejectionReason: string | null;
  }>;
}

const METHOD_LABEL: Record<string, string> = {
  NRV: 'Relative sales value (NRV) at split-off',
  WEIGHT: 'Relative weight',
  SALES_VALUE: 'Relative sales value',
  STANDARD_PERCENTAGE: 'Standard percentages',
};

/**
 * Joint-cost controls (JOINT_COST_ALLOCATION, handbook §62): the one method
 * every processing order is costed by, and the approved, dated selling prices
 * that method reads. An order never takes a price typed onto it.
 */
export default async function JointCostPage() {
  const [data, items] = await Promise.all([api<JointCost>('/production-orders/joint-cost'), getStockItems()]);

  return (
    <>
      <PageHeader title="Joint-cost prices" subtitle="How a processing order's cost is shared between meat and by-products" />
      <Tabs />
      <div className="stack">
        <Card title="Released method" subtitle="Every processing order uses this one method">
          <JointCostControls method={data.method} label={METHOD_LABEL[data.method] ?? data.method} />
        </Card>

        <Card title="Selling prices at split-off" subtitle="Proposed, approved by someone else, then fixed — a change is a new price from a later date" padded={false}>
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Output</th>
                  <th className="right" style={{ width: 140 }}>Selling price</th>
                  <th className="right" style={{ width: 140 }}>Further cost</th>
                  <th style={{ width: 110 }}>From</th>
                  <th>Evidence</th>
                  <th style={{ width: 200 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.prices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="faint">
                      No prices yet. A processing order cannot be costed until each of its outputs has an approved price.
                    </td>
                  </tr>
                ) : (
                  data.prices.map((p) => (
                    <tr key={p.id}>
                      <td style={{ textAlign: 'left' }}>
                        {p.itemCode} <span className="faint">{p.itemDescription}</span>
                      </td>
                      <td className="num right">{formatNaira(p.sellingPricePerUnitKobo)}</td>
                      <td className="num right">{formatNaira(p.furtherCostPerUnitKobo)}</td>
                      <td>{p.effectiveFrom}</td>
                      <td className="faint" style={{ textAlign: 'left' }}>
                        {p.evidenceReference} · by {p.proposedBy}
                      </td>
                      <td>
                        <JointCostControls priceId={p.id} status={p.status} approvedBy={p.approvedBy} rejectionReason={p.rejectionReason} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Propose a price">
          <ProposePriceForm items={items.map((i) => ({ id: i.id, label: `${i.code} — ${i.name}` }))} />
        </Card>
      </div>
    </>
  );
}
