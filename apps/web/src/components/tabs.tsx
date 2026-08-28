'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { sectionFor } from '@/lib/navigation';
import { canSee } from '@/lib/permissions';
import { useRoles } from './roles-context';

/**
 * Tabs across the pages of one section.
 *
 * There is nothing to pass in any more. The tab bar works out which section
 * the current page belongs to and renders that section's children, so it can
 * never show a different set from the sidebar or label the same page
 * differently — which is what happened while four tab sets were maintained by
 * hand next to a sidebar that did not read them.
 *
 * A page that belongs to no section renders nothing rather than guessing.
 */
export function Tabs() {
  const pathname = usePathname();
  const router = useRouter();
  const roles = useRoles();
  const section = sectionFor(pathname);

  /*
   * A section the role cannot reach shows no tabs at all.
   *
   * This is what let a production supervisor stand on the receiving screen —
   * which is theirs — looking at a "Purchase orders" tab that answered "ask an
   * administrator". Every tab in a section shares that section's permission, so
   * the check is one call rather than one per tab.
   */
  if (!section || !canSee(roles, section.section)) return null;

  const tabs = section.children.filter((child) => !child.hidden);
  if (tabs.length < 2) return null;

  /*
   * Longest-match wins, the same rule `sectionFor` uses to pick between
   * sections. Needed here too: AgriPro Core's "Overview" sits at the bare
   * section root (`/agripro`), which is a path-prefix of every one of its
   * own siblings (`/agripro/valuations`, etc.) — a plain "does my href
   * prefix the URL" check would mark Overview active everywhere in the
   * section, not just on itself.
   */
  const activeTab = tabs
    .filter((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <>
      <div className="tabs hide-on-phone" role="tablist" aria-label={section.label}>
        {tabs.map((tab) => {
          const active = tab.href === activeTab?.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={active}
              className="tab"
              title={tab.hint}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {/*
       * A horizontal row that scrolls sideways is awkward to browse by touch,
       * so the phone gets a dropdown over the same tabs instead — one section,
       * one list of tabs, two ways of picking from it.
       */}
      <select
        className="tabs-select show-on-phone"
        aria-label={section.label}
        value={activeTab?.href ?? tabs[0]?.href ?? ''}
        onChange={(event) => router.push(event.target.value)}
      >
        {tabs.map((tab) => (
          <option key={tab.href} value={tab.href}>
            {tab.label}
          </option>
        ))}
      </select>
    </>
  );
}

/*
 * There is deliberately nothing else exported from this file.
 *
 * `FARM_TABS`, `STORE_TABS`, `MONEY_TABS` and `SETUP_TABS` used to live here
 * and be passed in by each page. That argument was the whole problem: a page
 * could hand over a list the sidebar knew nothing about, and two of them
 * eventually did. Removing the export removes the way back.
 */
