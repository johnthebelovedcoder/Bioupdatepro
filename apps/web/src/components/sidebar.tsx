'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getModule, type ModuleKey } from '@/lib/modules';
import { canSee, type Section } from '@/lib/permissions';
import {
  IconBox,
  IconChart,
  IconDashboard,
  IconFarm,
  IconSettings,
  IconWallet,
  type IconProps,
} from './icons';

/**
 * Navigation, kept short on purpose.
 *
 * This was nineteen entries and nobody reads a menu that long. Related pages
 * are now grouped behind one entry and reached with tabs once you are there —
 * buying sits with the store, the ledger sits with the money, people sit with
 * setup. That is nine entries plus the module's own sections.
 *
 * The wording is the farm's, not the accountant's: "Store" rather than
 * "Inventory", "Money" rather than "Finance", "Daily round" rather than "Daily
 * records". The accounting pages keep their proper names, because the person
 * opening a trial balance is looking for a trial balance.
 */
interface NavItem {
  href: string;
  /** Which permission section this belongs to. */
  section: Section;
  label: string;
  icon: React.ComponentType<IconProps>;
  /** Other routes that live under this entry as tabs. */
  covers?: string[];
}

const MAIN: NavItem[] = [
  { href: '/', label: 'Home', icon: IconDashboard, section: 'dashboard' },
];

const SHARED: NavItem[] = [
  { href: '/farm', label: 'Farm', icon: IconFarm, covers: ['/farm'], section: 'livestock' },
  {
    href: '/inventory',
    label: 'Store & buying',
    icon: IconBox,
    covers: ['/inventory', '/procurement'],
    section: 'inventory',
  },
  {
    href: '/finance',
    label: 'Money',
    icon: IconWallet,
    covers: ['/finance', '/sales', '/ledger'],
    section: 'money',
  },
  {
    href: '/settings',
    label: 'Setup',
    icon: IconSettings,
    covers: ['/settings', '/staff'],
    section: 'settings',
  },
];

export function SidebarNav({
  activeModule,
  roles = [],
}: {
  activeModule: ModuleKey;
  /** The signed-in user's roles. Entries they cannot reach are not shown. */
  roles?: readonly string[];
}) {
  const pathname = usePathname();
  const module = getModule(activeModule);

  const isActive = (item: NavItem) => {
    if (item.href === '/') return pathname === '/';
    const roots = item.covers ?? [item.href];
    return roots.some((root) => pathname === root || pathname.startsWith(`${root}/`));
  };

  return (
    <div className="sidebar-scroll">
      <div className="nav-group">
        {MAIN.filter((item) => canSee(roles, item.section)).map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item)} />
        ))}
      </div>

      {module ? (
        <div className="nav-group">
          <div className="nav-group-title">{module.productName}</div>
          <NavLink
            item={{
              href: `/m/${module.key}`,
              label: 'Overview',
              icon: module.icon,
              section: 'livestock',
            }}
            active={pathname === `/m/${module.key}`}
          />
          {module.nav.map((entry) => (
            <NavLink
              key={entry.slug}
              item={{
                href: `/m/${module.key}/${entry.slug}`,
                label: entry.label,
                icon: entry.icon,
                section: 'livestock',
              }}
              active={
                pathname === `/m/${module.key}/${entry.slug}` ||
                pathname.startsWith(`/m/${module.key}/${entry.slug}/`)
              }
            />
          ))}
        </div>
      ) : null}

      <div className="nav-group">
        <div className="nav-group-title">The business</div>
        {SHARED.filter((item) => canSee(roles, item.section)).map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item)} />
        ))}
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} className="nav-link" aria-current={active ? 'page' : undefined}>
      <Icon size={18} />
      <span className="nav-link-label">{item.label}</span>
    </Link>
  );
}

export { IconChart };
