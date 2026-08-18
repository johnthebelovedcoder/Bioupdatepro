'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { SessionUser } from '@/lib/session';
import type { ModuleKey } from '@/lib/modules';
import type { LanguageCode } from '@/lib/farm-config';
import { SidebarNav } from './sidebar';
import { ModuleSwitcher } from './module-switcher';
import { UserMenu } from './user-menu';
import { SyncStatus } from './sync-status';
import { BottomNav } from './bottom-nav';
import { OfflineSupport } from './offline-support';
import { IconMenu } from './icons';

/**
 * The application frame.
 *
 * One client component owns the navigation's open state, because on a phone the
 * header toggle and the sidebar are the same control. Above 860px the drawer
 * styling drops away and the sidebar is simply a column — there is no second
 * navigation implementation to keep in step.
 */
export function AppShell({
  user,
  activeModule,
  workerLanguage = 'en',
  organisationName = '',
  children,
}: {
  user: SessionUser;
  activeModule: ModuleKey;
  /** The pen language. The bottom bar is the worker's navigation. */
  workerLanguage?: LanguageCode;
  /** The farm's own name, shown in place of a product list. */
  organisationName?: string;
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // Navigating on a phone should reveal the page, not leave the drawer over it.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setNavOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  return (
    <div className="app-shell">
      <OfflineSupport />
      {navOpen ? (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <nav className="app-sidebar" data-open={navOpen} aria-label="Main">
        <div className="sidebar-head">
          <div className="brand">
            <span className="brand-mark">BA</span>
            <span style={{ minWidth: 0 }}>
              <span className="brand-name" style={{ display: 'block' }}>
                BioAssetPro
              </span>
              <span className="brand-sub">Farm ERP</span>
            </span>
          </div>
        </div>

        <div className="sidebar-module">
          <ModuleSwitcher active={activeModule} />
        </div>

        <SidebarNav activeModule={activeModule} roles={user.roles} />

        <div className="sidebar-foot">
          {/*
            The farm's own name, not a list of the modules on sale.

            This read "SnailPro · PoultryPro" for everyone, so a farm keeping
            only snails was shown a poultry product it may not be subscribed to,
            in its own sidebar. The module you are working in is already named
            in the switcher directly above; repeating the catalogue underneath
            it tells the user nothing about their farm.
          */}
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-faint)',
              padding: '0 var(--sp-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {organisationName}
          </div>
        </div>
      </nav>

      <div className="app-body">
        <header className="app-header">
          <button
            type="button"
            className="btn btn-icon nav-toggle"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <IconMenu size={18} />
          </button>
          <div className="spacer" />
          <SyncStatus />
          <UserMenu user={user} />
        </header>
        <main className="page">{children}</main>
      </div>

      {/* Phone only. The drawer is still there behind "More" for everything
          that does not earn a place in five. */}
      <BottomNav
        activeModule={activeModule}
        language={workerLanguage}
        onMore={() => setNavOpen(true)}
      />
    </div>
  );
}
