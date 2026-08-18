'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Tabs across related pages.
 *
 * These exist to shorten the sidebar. Nineteen top-level entries is a menu
 * nobody reads; grouping the related ones behind a single entry and letting
 * tabs move between them turns it into nine. Each tab is still its own route,
 * so links and the back button keep working.
 */
export interface Tab {
  href: string;
  label: string;
}

export function Tabs({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname();

  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className="tab"
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

/* The tab sets, defined once so a page cannot disagree with the sidebar. */

export const FARM_TABS: Tab[] = [
  { href: '/farm', label: 'Houses & pens' },
  { href: '/farm/activity', label: "What's happened" },
];

export const STORE_TABS: Tab[] = [
  { href: '/inventory', label: 'What we have' },
  { href: '/procurement', label: 'Buying' },
];

export const MONEY_TABS: Tab[] = [
  { href: '/finance', label: 'Money in & out' },
  { href: '/sales', label: 'Selling' },
  { href: '/finance/batches', label: 'What each batch made' },
  { href: '/finance/losses', label: 'Watching for losses' },
  { href: '/ledger/trial-balance', label: 'Trial balance' },
  { href: '/ledger/journals', label: 'Journal entries' },
  { href: '/ledger/audit', label: 'Audit trail' },
];

export const SETUP_TABS: Tab[] = [
  { href: '/settings', label: 'Farm setup' },
  { href: '/staff', label: 'People & access' },
];
