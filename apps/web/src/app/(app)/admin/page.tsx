import Link from 'next/link';
import { api } from '@/lib/api';
import { Card, PageHeader } from '@/components/ui';
import { IconArrowRight } from '@/components/icons';

import { Tabs } from '@/components/tabs';
import { NOT_BUILT_YET } from '@/lib/navigation';

export const metadata = { title: 'Setup — BioAssetPro' };

interface Counted {
  length: number;
}

/**
 * Administration — where everything in the system gets created.
 *
 * This page exists because the product had no answer to a simple question:
 * "where do I type things in?" Two forms existed and both were buried as tabs
 * inside operational screens, so somebody looking to register a vendor had
 * nowhere obvious to look and reasonably concluded there was nothing there.
 *
 * Every count is live. A farm that has created nothing sees zeroes, and each
 * zero is a link to the form that fixes it. The list also shows what is NOT
 * buildable yet, rather than quietly omitting it — a setup screen that hides
 * the gaps is how somebody discovers a missing feature at the worst moment.
 */
export default async function AdminPage() {
  const counts = await Promise.all([
    safeCount('/masters/farms'),
    safeCount('/masters/pens'),
    safeCount('/masters/warehouses'),
    safeCount('/masters/cost-centres'),
    safeCount('/masters/suppliers'),
    safeCount('/masters/customers'),
    safeCount('/masters/items'),
    safeCount('/masters/employees'),
  ]);

  const [farms, pens, stores, centres, vendors, customers, items, employees] = counts;

  const ready = [
    {
      href: '/pens',
      name: 'Farms, houses & pens',
      count: pens,
      unit: 'pens',
      why: 'Where animals live. A population cannot be placed without one.',
      extra: farms === 1 ? '1 farm' : `${farms} farms`,
    },
    {
      href: '/suppliers',
      name: 'Vendors',
      count: vendors,
      unit: 'vendors',
      why: 'Everyone you buy from. Needed before any purchase can be raised.',
    },
    {
      href: '/admin/items',
      name: 'Items',
      count: items,
      unit: 'items',
      why: 'Feed, medication, produce. Everything bought, stored or sold.',
    },
    {
      href: '/admin/customers',
      name: 'Customers',
      count: customers,
      unit: 'customers',
      why: 'Everyone you sell to.',
    },
    {
      href: '/admin/stores',
      name: 'Stores',
      count: stores,
      unit: 'stores',
      why: 'Where stock physically sits. Goods receipts need one.',
    },
    {
      href: '/admin/cost-centres',
      name: 'Cost centres',
      count: centres,
      unit: 'cost centres',
      why: 'What a cost is attributed to. Production postings are refused without one.',
    },
    {
      href: '/staff',
      name: 'People & access',
      count: employees,
      unit: 'employees',
      why: 'Who can sign in, and what each of them may do.',
    },
  ];

  /*
   * Named rather than omitted, and read from the navigation model rather
   * than retyped here.
   *
   * Each gap carries the section it will land in, so this page answers two
   * questions at once: what is missing, and where it will appear when it
   * arrives. A list that only names the gap leaves the reader to wonder
   * whether it is a menu they have simply failed to find.
   */
  const notYet = NOT_BUILT_YET;

  return (
    <>
      <PageHeader
        title="Setup"
        subtitle="Everything the system knows about your business, and where to add more"
      />

      <div className="stack">
        <Tabs />
        <Card title="What you can set up" padded={false}>
          {ready.map((entry) => (
            <Link key={entry.href} href={entry.href} className="list-row">
              <div className="list-main">
                <div className="list-title">
                  {entry.name}
                  {entry.count === 0 ? (
                    <span className="badge badge-warning" style={{ marginLeft: 'var(--sp-2)' }}>
                      none yet
                    </span>
                  ) : null}
                </div>
                <div className="list-sub">{entry.why}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="num" style={{ fontSize: 15, fontWeight: 600 }}>
                  {entry.count}
                </div>
                <div className="faint">{entry.extra ?? entry.unit}</div>
              </div>
              <IconArrowRight size={15} />
            </Link>
          ))}
        </Card>

        <Card title="Not available yet" padded={false}>
          {notYet.map((entry) => (
            <div className="list-row" key={entry.label}>
              <div className="list-main">
                <div className="list-title faint">{entry.label}</div>
                <div className="list-sub">{entry.why}</div>
              </div>
              <span className="badge">under {entry.belongsUnder}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

/** A count, or zero where the list cannot be read. Never a crash. */
async function safeCount(path: string): Promise<number> {
  try {
    const rows = await api<Counted>(path);
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}
