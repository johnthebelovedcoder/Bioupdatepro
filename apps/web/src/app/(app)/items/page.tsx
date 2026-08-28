import { api } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { MasterForm } from '@/components/master-form';
import { createItem } from '../admin/actions';
import { IconBox } from '@/components/icons';

import { Tabs } from '@/components/tabs';
import { TableSearch } from '@/components/table-search';

export const metadata = { title: 'Items — BioAssetPro' };

interface Item {
  id: string;
  code: string;
  description: string;
  itemType: string;
  isBiologicalFeed: boolean;
  unitOfMeasure: string;
  vatCode: string | null;
  standardCostKobo: string | null;
}

interface Uom {
  id: string;
  code: string;
  name: string;
}

interface TaxCode {
  code: string;
  name?: string;
}

interface GlAccount {
  id: string;
  accountNumber: string;
  name: string;
  accountType: string;
}

/**
 * Items — everything the farm buys, stores or sells.
 *
 * The unit and the VAT code are offered as lists rather than free text, and
 * both come from what this company actually has. A typed unit that does not
 * exist is rejected by the API with a message about unit codes, which is not
 * a sentence a farmer should ever have to read.
 */
export default async function ItemsPage() {
  const [items, units, taxCodes, accounts] = await Promise.all([
    safe<Item[]>('/masters/items', []),
    safe<Uom[]>('/masters/units', []),
    safe<TaxCode[]>('/masters/tax-codes', []),
    safe<GlAccount[]>('/masters/gl-accounts', []),
  ]);

  /*
   * The account a receipt of this item debits.
   *
   * Assets are offered first because that is what an inventory item needs, and
   * the API refuses one without it — goods receipt posts Dr Inventory / Cr GRNI
   * and has nowhere to put the debit otherwise. Offering the whole chart
   * unsorted would make picking the wrong one as easy as picking the right one.
   */
  const assetOptions = accounts
    .filter((account) => account.accountType === 'ASSET')
    .map((account) => ({
      value: account.id,
      label: `${account.accountNumber} — ${account.name}`,
    }));
  const expenseOptions = [
    { value: '', label: 'None' },
    ...accounts
      .filter((account) => account.accountType === 'EXPENSE')
      .map((account) => ({
        value: account.id,
        label: `${account.accountNumber} — ${account.name}`,
      })),
  ];

  const unitOptions = units.map((unit) => ({ value: unit.code, label: unit.name || unit.code }));
  const vatOptions = [
    { value: '', label: 'No VAT code' },
    ...taxCodes
      .filter((code) => code.code.startsWith('VAT'))
      .map((code) => ({ value: code.code, label: code.code })),
  ];

  return (
    <>
      <PageHeader
        title="Items"
        subtitle="Feed, medication, produce — anything bought, stored or sold"
      />

      <div className="stack">
        <Tabs />

        <TableSearch
          placeholder="Search items"
          actions={
            <MasterForm
              title="Add an item"
              subtitle="How it is measured and taxed decides where its money lands"
              submitLabel="Add item"
              action={createItem}
              fields={[
                { name: 'code', label: 'Item code', hint: 'FD-LAYER, MD-LASOTA.', required: true, half: true },
                { name: 'description', label: 'Description', hint: 'Layer mash.', required: true, half: true },
                {
                  name: 'unitOfMeasureCode',
                  label: 'Measured in',
                  options: unitOptions.length > 0 ? unitOptions : [{ value: 'Kg', label: 'Kg' }],
                  required: true,
                  half: true,
                },
                {
                  name: 'itemType',
                  label: 'Type',
                  options: [
                    { value: 'INVENTORY', label: 'Inventory — stocked and counted' },
                    { value: 'SERVICE', label: 'Service — not stocked' },
                    { value: 'ASSET', label: 'Asset' },
                  ],
                  half: true,
                },
                {
                  name: 'vatTaxCode',
                  label: 'VAT treatment',
                  hint: 'Farm produce and inputs are usually zero-rated.',
                  options: vatOptions,
                  half: true,
                },
                { name: 'category', label: 'Category', hint: 'Feed, Medication.', half: true },
                {
                  name: 'inventoryGlAccountId',
                  label: 'Stock account',
                  hint: 'Where receiving this debits. Required for anything stocked.',
                  options:
                    assetOptions.length > 0
                      ? assetOptions
                      : [{ value: '', label: 'No accounts found' }],
                  half: true,
                },
                {
                  name: 'expenseGlAccountId',
                  label: 'Expense account',
                  hint: 'Used when it is consumed rather than stocked.',
                  options: expenseOptions,
                  half: true,
                },
                {
                  name: 'reorderLevel',
                  label: 'Reorder level',
                  hint: 'Warn when stock falls below this.',
                  type: 'number',
                  half: true,
                },
                {
                  name: 'standardCost',
                  label: 'Standard cost (₦)',
                  hint: 'What you expect to pay, per unit.',
                  type: 'number',
                  half: true,
                },
                {
                  name: 'isBiologicalFeed',
                  label: 'This is animal feed',
                  hint: 'Feed issued to a population is costed against it',
                  type: 'checkbox',
                },
              ]}
            />
          }
        >
          <Card title={`${items.length} ${items.length === 1 ? 'item' : 'items'}`} padded={false}>
            {items.length === 0 ? (
              <EmptyState
                icon={<IconBox size={22} />}
                title="No items yet"
                body="Add the first one above. A purchase order has to name an item, so nothing can be bought until one exists."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>Code</th>
                      <th>Description</th>
                      <th style={{ width: 120 }}>Type</th>
                      <th style={{ width: 80 }}>Unit</th>
                      <th style={{ width: 100 }}>VAT</th>
                      <th className="right" style={{ width: 140 }}>
                        Standard cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td className="num strong" style={{ textAlign: 'left' }}>
                          {item.code}
                        </td>
                        <td>
                          {item.description}
                          {item.isBiologicalFeed ? (
                            <span className="badge" style={{ marginLeft: 'var(--sp-2)' }}>
                              feed
                            </span>
                          ) : null}
                        </td>
                        <td className="faint">{item.itemType.toLowerCase()}</td>
                        <td className="faint">{item.unitOfMeasure}</td>
                        <td className="faint">{item.vatCode ?? '—'}</td>
                        <td className="num">
                          {item.standardCostKobo ? formatNaira(item.standardCostKobo) : '—'}
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

async function safe<T>(path: string, fallback: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch {
    return fallback;
  }
}
