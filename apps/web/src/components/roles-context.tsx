'use client';

import { createContext, useContext } from 'react';
import type { RoleSectionOverride } from '@/lib/permissions';

/**
 * Who is signed in, for the client components that need to hide things.
 *
 * The sidebar has always received roles as a prop because there is exactly one
 * of it. The tab bar appears on twenty pages, and threading roles through every
 * one of them would mean twenty chances to forget — which is how the tab bar
 * came to offer a production supervisor a "Buying" tab that bounced them
 * straight to the no-access page.
 *
 * This is presentation only, and worth saying plainly: the API re-reads roles
 * from the database on every request and refuses there. Hiding a tab is a
 * courtesy to the person, not a control on the data.
 */
interface RolesContextValue {
  roles: readonly string[];
  /** Admin-set exceptions to the hardcoded role→section table (US-897-035). */
  roleSectionOverrides: readonly RoleSectionOverride[];
}

const RolesContext = createContext<RolesContextValue>({ roles: [], roleSectionOverrides: [] });

export function RolesProvider({
  roles,
  roleSectionOverrides = [],
  children,
}: {
  roles: readonly string[];
  roleSectionOverrides?: readonly RoleSectionOverride[];
  children: React.ReactNode;
}) {
  return (
    <RolesContext.Provider value={{ roles, roleSectionOverrides }}>
      {children}
    </RolesContext.Provider>
  );
}

export function useRoles(): readonly string[] {
  return useContext(RolesContext).roles;
}

export function useRoleSectionOverrides(): readonly RoleSectionOverride[] {
  return useContext(RolesContext).roleSectionOverrides;
}
