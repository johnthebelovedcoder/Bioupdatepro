import { api } from '@/lib/api';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { FarmForm, PenForm } from '@/components/pen-form';
import { IconFarm } from '@/components/icons';
import { Tabs } from '@/components/tabs';
import { TableSearch } from '@/components/table-search';

export const metadata = { title: 'Houses & pens — BioAssetPro' };

interface Farm {
  id: string;
  code: string;
  name: string;
  active: boolean;
  _count: { pens: number };
}

interface Pen {
  id: string;
  code: string;
  name: string;
  active: boolean;
  farmId: string;
  farmName: string;
  populations: number;
}

/**
 * The places on the farm.
 *
 * Everything here was created by somebody. A farm with no pens shows no pens
 * and says what to do about it, rather than displaying a structure nobody
 * entered — which is what the old screen did, and why the first person to use
 * the product asked where the data was coming from.
 */
export default async function PensPage() {
  let farms: Farm[] = [];
  let pens: Pen[] = [];
  let error: string | null = null;

  try {
    [farms, pens] = await Promise.all([
      api<Farm[]>('/masters/farms'),
      api<Pen[]>('/masters/pens'),
    ]);
  } catch {
    error = 'Could not load your farm structure.';
  }

  return (
    <>
      <PageHeader
        title="Houses &amp; pens"
        subtitle="Every place an animal can live. A population has to be placed in one"
      />

      <div className="stack">
        <Tabs />
        {error ? <div className="notice notice-error">{error}</div> : null}

        {/* A pen needs a farm. Where there is none, that is the first thing to fix. */}
        {farms.length === 0 ? <FarmForm /> : <PenForm farms={farms} />}

        <TableSearch placeholder="Search houses & pens">
          <Card
            title={`${pens.length} ${pens.length === 1 ? 'place' : 'places'}`}
            {...(farms.length > 1 ? { subtitle: `Across ${farms.length} farms` } : {})}
            padded={false}
          >
            {pens.length === 0 ? (
              <EmptyState
                icon={<IconFarm size={22} />}
                title="No houses or pens yet"
                body="Add the first one above. Until a house exists there is nowhere to put a population, so nothing else on the livestock side can be recorded."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 140 }}>Code</th>
                      <th>Name</th>
                      {farms.length > 1 ? <th>Farm</th> : null}
                      <th className="right" style={{ width: 140 }}>
                        Populations
                      </th>
                      <th style={{ width: 100 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pens.map((pen) => (
                      <tr key={pen.id}>
                        <td className="num strong" style={{ textAlign: 'left' }}>
                          {pen.code}
                        </td>
                        <td>{pen.name}</td>
                        {farms.length > 1 ? <td className="faint">{pen.farmName}</td> : null}
                        <td className="num">
                          {pen.populations > 0 ? (
                            pen.populations
                          ) : (
                            <span className="faint">empty</span>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${pen.active ? 'badge-success' : ''}`}>
                            {pen.active ? 'in use' : 'closed'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TableSearch>
      </div>
    </>
  );
}
