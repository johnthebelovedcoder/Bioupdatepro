'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getModule, type ModuleKey } from '@/lib/modules';
import { sectionFor } from '@/lib/navigation';
import { translator } from '@/lib/i18n';
import type { LanguageCode } from '@/lib/farm-config';
import { IconBox, IconDashboard, IconMenu, IconPlus, IconWallet } from './icons';

/**
 * The phone's main navigation.
 *
 * Five destinations, chosen for the person actually holding the phone — a
 * worker or a manager standing on the farm, not an accountant at a desk:
 *
 *   Home      what the farm looks like right now
 *   Livestock the birds or snails themselves
 *   Record    today's round — the single most-used action, so it is the middle
 *             button and it is the one that looks like a button
 *   Store     feed and drugs, the thing that runs out
 *   More      everything else, in the drawer
 *
 * Selling and the books are deliberately NOT here. They are desk work, they are
 * one tap away under More, and a bottom bar with seven items is a bottom bar
 * nobody can hit accurately.
 *
 * Hidden above 860px, where the sidebar is always visible and a second
 * navigation would just be clutter.
 */
export function BottomNav({
  activeModule,
  onMore,
  language = 'en',
}: {
  activeModule: ModuleKey | null;
  onMore: () => void;
  /** The worker's language — this bar is the worker's navigation. */
  language?: LanguageCode;
}) {
  const pathname = usePathname();
  const say = translator(language);
  const module = getModule(activeModule);
  if (!module) return null;

  const livestockHref = `/m/${module.key}/${module.registerSlug}`;
  const recordHref = `/m/${module.key}/records`;

  const isHome = pathname === '/';
  const isLivestock = pathname.startsWith(livestockHref) || pathname === `/m/${module.key}`;
  const isRecord = pathname === recordHref;
  /*
   * Which of the five is lit comes from the navigation model, not from a path
   * prefix written here.
   *
   * It used to be `startsWith('/procurement')`, which lit "Store" on the
   * purchase-order screen — fine while buying and the store were one group,
   * wrong the moment they became two. Reading the section means this bar
   * cannot disagree with the sidebar about where you are.
   */
  const isStore = sectionFor(pathname)?.key === 'stock';

  return (
    <nav className="bottom-nav" aria-label="Main">
      <Item href="/" label={say('nav.home')} active={isHome} icon={<IconDashboard size={20} />} />
      <Item
        href={livestockHref}
        label={module.label}
        active={isLivestock}
        icon={<module.icon size={20} />}
      />

      {/* The primary action, raised out of the bar so it reads as a button
          rather than a fifth tab. */}
      <Link
        href={recordHref}
        className="bottom-nav-primary"
        aria-current={isRecord ? 'page' : undefined}
        aria-label={say('nav.record')}
      >
        <span className="bottom-nav-primary-badge">
          <IconPlus size={22} />
        </span>
        <span className="bottom-nav-label">{say('nav.record')}</span>
      </Link>

      <Item href="/inventory" label={say('nav.store')} active={isStore} icon={<IconBox size={20} />} />

      <button type="button" className="bottom-nav-item" onClick={onMore}>
        <IconMenu size={20} />
        <span className="bottom-nav-label">{say('nav.more')}</span>
      </button>
    </nav>
  );
}

function Item({
  href,
  label,
  active,
  icon,
}: {
  href: string;
  label: string;
  active: boolean;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="bottom-nav-item"
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span className="bottom-nav-label">{label}</span>
    </Link>
  );
}

export { IconWallet };
