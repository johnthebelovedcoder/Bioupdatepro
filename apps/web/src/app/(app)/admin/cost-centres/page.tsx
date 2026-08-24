import { api } from '@/lib/api';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { MasterForm } from '@/components/master-form';
import { createCostCentre } from '../actions';
import { IconChart } from '@/components/icons';

import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Cost centres — BioAssetPro' };

interface CostCentre {
  id: string;
  code: string;
  name: string;
  active: boolean;
  managerName: string | null;
  parentName: string | null;
}

/**
 * Cost centres — what a cost is attributed to.
 *
 * The least glamorous screen in the product and one of the most consequential:
 * the work-in-progress account refuses any line without a cost centre, so a
 * farm with none cannot post a feed issue at all. That rule comes from the
 * source workbooks rather than from a preference here.
 */
export default async function CostCentresPage() {
  let centres: CostCentre[] = [];
  try {
    centres = await api<CostCentre[]>('/masters/cost-centres');
  } catch {
    centres = [];
  }

  return (
    <>
      <PageHeader
        title="Cost centres"
        subtitle="What each cost is attributed to — the breakdown behind every profit figure"
      />

      <div className="stack">
        <Tabs />
        <Card
          title={`${centres.length} ${centres.length === 1 ? 'cost centre' : 'cost centres'}`}
          padded={false}
        >
          {centres.length === 0 ? (
            <EmptyState
              icon={<IconChart size={22} />}
              title="No cost centres yet"
              body="Add one below. Production costs cannot be posted without somewhere to attribute them, so feed issues will be refused until at least one exists."
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>Code</th>
                    <th>Name</th>
                    <th>Sits under</th>
                    <th>Manager</th>
                    <th style={{ width: 100 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {centres.map((centre) => (
                    <tr key={centre.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {centre.code}
                      </td>
                      <td>{centre.name}</td>
                      <td className="faint">{centre.parentName ?? '—'}</td>
                      <td className="faint">{centre.managerName ?? '—'}</td>
                      <td>
                        <span className={`badge ${centre.active ? 'badge-success' : ''}`}>
                          {centre.active ? 'active' : 'closed'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <MasterForm
          title="Add a cost centre"
          subtitle="One per part of the business you want to see costs for separately"
          submitLabel="Add cost centre"
          action={createCostCentre}
          fields={[
            { name: 'code', label: 'Code', hint: '130, PL-GROW.', required: true, half: true },
            {
              name: 'name',
              label: 'Name',
              hint: 'Farm operations, brooding, processing.',
              required: true,
              half: true,
            },
            {
              name: 'parentId',
              label: 'Sits under',
              hint: 'Leave blank for a top-level centre.',
              options: [
                { value: '', label: 'Nothing — top level' },
                ...centres.map((centre) => ({
                  value: centre.id,
                  label: `${centre.code} — ${centre.name}`,
                })),
              ],
              half: true,
            },
            { name: 'managerName', label: 'Manager', hint: 'Who answers for it.', half: true },
          ]}
        />
      </div>
    </>
  );
}
