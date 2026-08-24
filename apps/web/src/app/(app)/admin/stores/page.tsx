import { api } from '@/lib/api';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { MasterForm } from '@/components/master-form';
import { createStore } from '../actions';
import { IconBox } from '@/components/icons';

import { Tabs } from '@/components/tabs';

export const metadata = { title: 'Stores — BioAssetPro' };

interface Store {
  id: string;
  code: string;
  name: string;
  type: string;
  active: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  RAW_MATERIAL: 'Feed & supplies',
  WORK_IN_PROGRESS: 'Processing floor',
  FINISHED_GOODS: 'Produce ready to sell',
  BY_PRODUCT: 'By-products',
  GENERAL: 'General',
};

/**
 * Stores — where stock physically sits.
 *
 * The type is not a label. A goods receipt looks for a raw-material store and
 * a harvest looks for a finished-goods one, so a farm holding only a GENERAL
 * store finds its produce has nowhere to go at exactly the wrong moment.
 */
export default async function StoresPage() {
  let stores: Store[] = [];
  try {
    stores = await api<Store[]>('/masters/warehouses');
  } catch {
    stores = [];
  }

  return (
    <>
      <PageHeader title="Stores" subtitle="Where feed, medication and produce physically sit" />

      <div className="stack">
        <Tabs />
        <Card
          title={`${stores.length} ${stores.length === 1 ? 'store' : 'stores'}`}
          padded={false}
        >
          {stores.length === 0 ? (
            <EmptyState
              icon={<IconBox size={22} />}
              title="No stores yet"
              body="Add one below. Goods cannot be received without somewhere to receive them into."
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 150 }}>Code</th>
                    <th>Name</th>
                    <th>Holds</th>
                    <th style={{ width: 100 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stores.map((store) => (
                    <tr key={store.id}>
                      <td className="num strong" style={{ textAlign: 'left' }}>
                        {store.code}
                      </td>
                      <td>{store.name}</td>
                      <td className="faint">{TYPE_LABEL[store.type] ?? store.type}</td>
                      <td>
                        <span className={`badge ${store.active ? 'badge-success' : ''}`}>
                          {store.active ? 'in use' : 'closed'}
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
          title="Add a store"
          subtitle="What it holds decides which movements can use it"
          submitLabel="Add store"
          action={createStore}
          fields={[
            { name: 'code', label: 'Store code', hint: 'RAW-WH, FG-WH.', required: true, half: true },
            { name: 'name', label: 'Name', hint: 'Feed store, cold room.', required: true, half: true },
            {
              name: 'type',
              label: 'What it holds',
              options: [
                { value: 'RAW_MATERIAL', label: 'Feed & supplies — what you buy in' },
                { value: 'FINISHED_GOODS', label: 'Produce ready to sell' },
                { value: 'WORK_IN_PROGRESS', label: 'Processing floor' },
                { value: 'BY_PRODUCT', label: 'By-products — shells, manure' },
                { value: 'GENERAL', label: 'General' },
              ],
            },
          ]}
        />
      </div>
    </>
  );
}
