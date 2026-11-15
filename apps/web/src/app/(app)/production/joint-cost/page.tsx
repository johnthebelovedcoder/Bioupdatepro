import { api } from '@/lib/api';
import { getStockItems } from '@/lib/masters';
import { formatNaira } from '@/lib/money';
import { Card, PageHeader } from '@/components/ui';
import { Tabs } from '@/components/tabs';
import { JointCostControls, ProposePriceForm, ProposeStandardAllocationForm } from '@/components/joint-cost-forms';
import { HelpTerm } from '@/components/help';

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
  standardAllocations: Array<{
    id: string;
    itemCode: string;
    itemDescription: string;
    allocationPercentage: string;
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
  MANUAL: 'Manual per-order percentages',
};

/**
 * Joint-cost controls (JOINT_COST_ALLOCATION, handbook §62): the one method
 * every processing order is costed by, and the approved, dated selling prices
 * that method reads. Standard percentages are effective-dated approvals;
 * manual percentages are captured on each order's output record.
 */
export default async function JointCostPage() {
  const [data, items] = await Promise.all([api<JointCost>('/production-orders/joint-cost'), getStockItems()]);

  return (
    <>
      <PageHeader title="Joint-cost prices" subtitle="How a processing order's cost is shared between meat and by-products" actions={<div className="row" style={{ gap: 'var(--sp-3)' }}><HelpTerm k="jointCost" /><HelpTerm k="nrv" /></div>} />
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

        <Card title="Standard output percentages" subtitle="Each main output's percentage is proposed and approved separately. The effective set for an order must total exactly 100%.">
          <div className="table-wrap">
            <table className="data wide">
              <thead>
                <tr>
                  <th>Output</th>
                  <th className="right">Share</th>
                  <th>From</th>
                  <th>Evidence</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.standardAllocations.length === 0 ? (
                  <tr><td colSpan={5} className="faint">No standard percentages proposed yet.</td></tr>
                ) : data.standardAllocations.map((allocation) => (
                  <tr key={allocation.id}>
                    <td style={{ textAlign: 'left' }}>{allocation.itemCode} <span className="faint">{allocation.itemDescription}</span></td>
                    <td className="num right">{allocation.allocationPercentage}%</td>
                    <td>{allocation.effectiveFrom}</td>
                    <td className="faint" style={{ textAlign: 'left' }}>{allocation.evidenceReference} · by {allocation.proposedBy}</td>
                    <td><JointCostControls allocationId={allocation.id} status={allocation.status} approvedBy={allocation.approvedBy} rejectionReason={allocation.rejectionReason} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <ProposeStandardAllocationForm items={items.map((item) => ({ id: item.id, label: `${item.code} — ${item.name}` }))} />
          </div>
        </Card>
      </div>
    </>
  );
}
