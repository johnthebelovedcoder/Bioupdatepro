/**
 * What each role may reach in the interface.
 *
 * This mirrors the roles the API enforces, and mirroring is exactly what it is:
 * the API is the boundary and this is a courtesy. Hiding a link stops nobody
 * who can type a URL, so nothing here is relied upon for security — its job is
 * to keep a production supervisor from being shown a payroll screen that would
 * refuse them anyway, which is a worse experience than not offering it.
 *
 * Kept as one table rather than scattered checks so that "who can see the
 * ledger" is answerable by reading a file, and so it cannot drift silently out
 * of step with the guards on the API.
 */

export type Section =
  | 'dashboard'
  | 'livestock'
  | 'recording'
  | 'trade'
  | 'inventory'
  | 'money'
  | 'ledger'
  | 'staff'
  | 'settings';

/** Everything, for the roles that genuinely have it. */
const ALL: Section[] = [
  'dashboard',
  'livestock',
  'recording',
  'trade',
  'inventory',
  'money',
  'ledger',
  'staff',
  'settings',
];

const BY_ROLE: Record<string, Section[]> = {
  ADMINISTRATOR: ALL,
  MANAGING_DIRECTOR: ALL,

  // The books, and everything feeding them.
  FINANCIAL_CONTROLLER: [
    'dashboard',
    'livestock',
    'trade',
    'inventory',
    'money',
    'ledger',
    'settings',
  ],

  // Buying, selling and what is owed. Not the ledger itself.
  FINANCE_MANAGER: ['dashboard', 'livestock', 'trade', 'inventory', 'money', 'ledger'],

  // Runs the farm: the animals, the recording, the store, and the people.
  FARM_MANAGER: [
    'dashboard',
    'livestock',
    'recording',
    'trade',
    'inventory',
    'money',
    'staff',
    'settings',
  ],

  /*
   * The narrowest role, and the one that matters most to get right.
   *
   * A supervisor walks the houses and records what they see. They have no
   * business in the ledger, in payroll or in the farm's money — and showing
   * them a revenue figure they cannot act on is not a kindness, it is an
   * invitation to speculate about wages in the pen.
   */
  PRODUCTION_SUPERVISOR: ['dashboard', 'livestock', 'recording'],
};

/** Every section this person can reach, from all the roles they hold. */
export function sectionsFor(roles: readonly string[]): Set<Section> {
  const allowed = new Set<Section>();
  for (const role of roles) {
    for (const section of BY_ROLE[role] ?? []) allowed.add(section);
  }
  // No recognised role means no sections. Failing closed matters here: an
  // unknown role string is a mistake, and a mistake should not open doors.
  return allowed;
}

export function canSee(roles: readonly string[], section: Section): boolean {
  return sectionsFor(roles).has(section);
}

/**
 * Which section a path belongs to.
 *
 * Longest prefix wins, so `/ledger/audit` resolves to the ledger rather than
 * matching something shorter by accident.
 */
const ROUTES: Array<{ prefix: string; section: Section }> = [
  { prefix: '/ledger', section: 'ledger' },
  { prefix: '/finance', section: 'money' },
  { prefix: '/sales', section: 'trade' },
  { prefix: '/procurement', section: 'trade' },
  { prefix: '/inventory', section: 'inventory' },
  { prefix: '/staff', section: 'staff' },
  { prefix: '/settings', section: 'settings' },
  { prefix: '/farm', section: 'livestock' },
  { prefix: '/m/', section: 'livestock' },
  { prefix: '/welcome', section: 'dashboard' },
  { prefix: '/', section: 'dashboard' },
];

export function sectionForPath(pathname: string): Section {
  const match = [...ROUTES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((route) => pathname === route.prefix || pathname.startsWith(route.prefix));
  return match?.section ?? 'dashboard';
}
