'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getModule, type ModuleKey } from '@/lib/modules';
import { canSee } from '@/lib/permissions';
import { CORE, HOME, SECTIONS, duplicateRoutes, type NavSection } from '@/lib/navigation';
import { IconChart, type IconProps } from './icons';

/**
 * Navigation, from the one place that describes it.
 *
 * This file used to hold its own list of entries, and `tabs.tsx` held four
 * more, and neither knew about the other. That is how `/pens` came to be
 * "Houses & pens" in one and "Farms & pens" in the other, and how vendors
 * ended up with two homes. Both now render `lib/navigation.ts`, so the menu
 * and the tab bar cannot disagree — and a route that acquires a second home
 * shows up as a console warning in development rather than as a support
 * question a year later.
 *
 * The top level is one entry per business cycle rather than the four broad
 * groups it had before. That is more entries, deliberately: the groups were
 * overflowing into tab bars of nine, and there was nowhere at all for fixed
 * assets, banking, payroll or the feed mill to land. Role filtering keeps it
 * short for the people who need it short — a production supervisor sees three
 * of these, a controller sees all of them.
 */
export function SidebarNav({
  activeModule,
  roles = [],
}: {
  activeModule: ModuleKey | null;
  /** The signed-in user's roles. Sections they cannot reach are not shown. */
  roles?: readonly string[];
}) {
  const pathname = usePathname();
  const module = getModule(activeModule);

  if (process.env.NODE_ENV !== 'production') {
    const duplicates = duplicateRoutes();
    if (duplicates.length > 0) {
      console.warn(
        `Navigation: these routes have more than one home — ${duplicates.join(', ')}. ` +
          `Pick the canonical one and cross-link from the other.`,
      );
    }
  }

  const isActive = (section: NavSection) =>
    section.href === '/'
      ? pathname === '/'
      : section.children.some(
          (child) => pathname === child.href || pathname.startsWith(`${child.href}/`),
        );

  const visible = SECTIONS.filter((section) => canSee(roles, section.section));

  return (
    <div className="sidebar-scroll">
      <div className="nav-group">
        {canSee(roles, HOME.section) ? (
          <NavLink
            href={HOME.href}
            label={HOME.label}
            icon={HOME.icon}
            active={pathname === '/'}
            hint={openingHint(HOME)}
          />
        ) : null}
        {/*
          The platform, named, above the cycles that belong to it.

          The word "AgriPro" did not appear anywhere in the running application
          until this line — a client could read his own specification, open the
          product, and have no way to tell that the platform he commissioned was
          the thing underneath everything else.
        */}
        {canSee(roles, CORE.section) ? (
          <NavLink
            href={CORE.href}
            label={CORE.label}
            icon={CORE.icon}
            active={pathname.startsWith('/agripro')}
            hint={openingHint(CORE)}
          />
        ) : null}
      </div>

      {module ? (
        <div className="nav-group">
          <div className="nav-group-title">{module.productName}</div>
          <NavLink
            href={`/m/${module.key}`}
            label="Overview"
            icon={module.icon}
            active={pathname === `/m/${module.key}`}
            hint={`${module.productName}'s own numbers — population, mortality, feed, output`}
          />
          {module.nav.map((entry) => (
            <NavLink
              key={entry.slug}
              href={`/m/${module.key}/${entry.slug}`}
              label={entry.label}
              icon={entry.icon}
              active={
                pathname === `/m/${module.key}/${entry.slug}` ||
                pathname.startsWith(`/m/${module.key}/${entry.slug}/`)
              }
              hint={entry.hint}
            />
          ))}
        </div>
      ) : null}

      {/*
        "AgriPro Core" rather than "The business".

        These cycles ARE the platform layer of the specification — buying,
        selling, stock, people, money, the books. Filing them under a heading
        that names nothing is how the product came to contain AgriPro without
        anybody being able to see it.
      */}
      <div className="nav-group">
        <div className="nav-group-title">AgriPro Core</div>
        {visible.map((section) => (
          <NavLink
            key={section.key}
            href={section.href}
            label={section.label}
            icon={section.icon}
            active={isActive(section)}
            hint={openingHint(section)}
          />
        ))}
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  hint,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<IconProps>;
  active: boolean;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className="nav-link"
      aria-current={active ? 'page' : undefined}
      title={hint}
    >
      <Icon size={18} />
      <span className="nav-link-label">{label}</span>
    </Link>
  );
}

/**
 * What a section's own opening page is for, reused as the section's tooltip.
 *
 * `NavSection` carries no hint of its own — its first child already has one
 * (`children[0].hint`, per that page's own doc comment: "always the first
 * child unless stated"), and that is the exact sentence a hover over the
 * section itself should say. Writing a second, separate string per section
 * would just be the same fact told twice, with the two eventually drifting.
 */
function openingHint(section: NavSection): string | undefined {
  return section.children.find((child) => child.href === section.href)?.hint;
}

export { IconChart };
