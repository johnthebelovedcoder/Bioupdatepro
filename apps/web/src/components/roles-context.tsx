'use client';

import { createContext, useContext } from 'react';

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
const RolesContext = createContext<readonly string[]>([]);

export function RolesProvider({
  roles,
  children,
}: {
  roles: readonly string[];
  children: React.ReactNode;
}) {
  return <RolesContext.Provider value={roles}>{children}</RolesContext.Provider>;
}

export function useRoles(): readonly string[] {
  return useContext(RolesContext);
}
