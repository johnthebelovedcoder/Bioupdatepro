'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { entryFor } from '@/lib/navigation';
import { getModule } from '@/lib/modules';

/**
 * Where you are, as a trail back to Home.
 *
 * Rendered once here rather than per page, the way `Tabs` is — that pattern
 * already let two pages disagree about a shared route's label before
 * `navigation.ts` became the one source both read from (see its own header).
 * A breadcrumb is exactly the kind of thing a page author forgets to add, so
 * this reads the current path in the shell itself and needs nothing from the
 * page underneath it.
 *
 * It also reaches somewhere `Tabs` deliberately does not: a `hidden` entry
 * like "Record a delivery" is left out of the tab bar on purpose (it is
 * opened from a row, not chosen from a menu), which means the tab bar alone
 * gives no way back to "Buying" from it. The breadcrumb still resolves it,
 * because `entryFor` matches on the URL, not on what the tab bar chooses to
 * show.
 */
export function Breadcrumbs() {
  const pathname = usePathname();
  const trail = trailFor(pathname);

  // Home alone repeats what the header already says. Nothing to add here.
  if (trail.length <= 1) return null;

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {trail.map((crumb, index) => {
        const isLast = index === trail.length - 1;
        return (
          <span key={crumb.href} className="breadcrumb-item">
            {index > 0 ? (
              <span className="breadcrumb-sep" aria-hidden="true">
                /
              </span>
            ) : null}
            {isLast ? (
              <span className="breadcrumb-current" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link href={crumb.href} title={crumb.hint} className="breadcrumb-link">
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

interface Crumb {
  href: string;
  label: string;
  hint?: string;
}

function trailFor(pathname: string): Crumb[] {
  if (pathname === '/') return [];

  const home: Crumb = { href: '/', label: 'Home' };

  /*
   * Species-module pages live outside `navigation.ts` entirely — `sidebar.tsx`
   * builds their menu straight from the module registry, so this does the
   * same rather than teaching `navigation.ts` about a tree it was deliberately
   * kept out of.
   */
  const moduleMatch = pathname.match(/^\/m\/([a-z]+)(?:\/([a-z-]+))?/);
  if (moduleMatch) {
    const module = getModule(moduleMatch[1]);
    if (module) {
      const crumbs: Crumb[] = [home, { href: `/m/${module.key}`, label: module.productName }];
      const navEntry = moduleMatch[2]
        ? module.nav.find((entry) => entry.slug === moduleMatch[2])
        : undefined;
      if (navEntry) {
        crumbs.push({ href: `/m/${module.key}/${navEntry.slug}`, label: navEntry.label });
      }
      return crumbs;
    }
  }

  const found = entryFor(pathname);
  if (!found) return [home];

  const { section, entry } = found;
  const crumbs: Crumb[] = [home, { href: section.href, label: section.label }];
  // On the section's own opening page, `entry` IS that first crumb — naming
  // it twice would read as a mistake, not as extra information.
  if (entry.href !== section.href) {
    crumbs.push({ href: entry.href, label: entry.label, hint: entry.hint });
  }
  return crumbs;
}
