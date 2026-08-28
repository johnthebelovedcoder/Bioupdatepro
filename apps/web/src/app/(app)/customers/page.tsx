import { api } from '@/lib/api';
import { formatNaira } from '@/lib/money';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { MasterForm } from '@/components/master-form';
import { createCustomer } from '../admin/actions';
import { IconTag } from '@/components/icons';

import { Tabs } from '@/components/tabs';
import { TableSearch } from '@/components/table-search';

export const metadata = { title: 'Customers — BioAssetPro' };

interface Customer {
  id: string;
  code: string;
  name: string;
  status: string;
  tin: string | null;
  creditLimitKobo: string | null;
  riskRating: string | null;
}

export default async function CustomersPage() {
  let customers: Customer[] = [];
  try {
    customers = await api<Customer[]>('/masters/customers');
  } catch {
    customers = [];
  }

  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone you sell to" />

      <div className="stack">
        <Tabs />

        <MasterForm
          title="Add a customer"
          subtitle="A credit limit here is what warns you before selling to somebody who already owes too much"
          submitLabel="Add customer"
          action={createCustomer}
          fields={[
            { name: 'code', label: 'Customer code', hint: 'CUS-SUNRISE.', required: true, half: true },
            { name: 'name', label: 'Name', required: true, half: true },
            { name: 'category', label: 'Type', hint: 'Wholesale, retail, hotel.', half: true },
            { name: 'tin', label: 'TIN', half: true },
            { name: 'phone', label: 'Phone', half: true },
            { name: 'email', label: 'Email', type: 'email', half: true },
            { name: 'state', label: 'State', hint: 'Decides withholding tax jurisdiction.', half: true },
            {
              name: 'creditLimit',
              label: 'Credit limit (₦)',
              hint: 'Leave blank for cash-only.',
              type: 'number',
              half: true,
            },
          ]}
        />

        <TableSearch placeholder="Search customers">
          <Card
            title={`${customers.length} ${customers.length === 1 ? 'customer' : 'customers'}`}
            padded={false}
          >
            {customers.length === 0 ? (
              <EmptyState
                icon={<IconTag size={22} />}
                title="No customers yet"
                body="Add one above. A sale on credit has to name a customer, so the money owed can be chased."
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 160 }}>Code</th>
                      <th>Name</th>
                      <th style={{ width: 140 }}>TIN</th>
                      <th className="right" style={{ width: 150 }}>
                        Credit limit
                      </th>
                      <th style={{ width: 100 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((customer) => (
                      <tr key={customer.id}>
                        <td className="num strong" style={{ textAlign: 'left' }}>
                          {customer.code}
                        </td>
                        <td>{customer.name}</td>
                        <td className="num" style={{ textAlign: 'left' }}>
                          {customer.tin ?? '—'}
                        </td>
                        <td className="num">
                          {customer.creditLimitKobo
                            ? formatNaira(customer.creditLimitKobo)
                            : '—'}
                        </td>
                        <td>
                          <span
                            className={`badge ${customer.status === 'ACTIVE' ? 'badge-success' : ''}`}
                          >
                            {customer.status.toLowerCase()}
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
