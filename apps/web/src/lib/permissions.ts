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
  | 'approvals'
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
  'approvals',
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
    'approvals',
    'settings',
  ],

  // Buying, selling and what is owed. Not the ledger itself.
  FINANCE_MANAGER: [
    'dashboard',
    'livestock',
    'trade',
    'inventory',
    'money',
    'ledger',
    'approvals',
  ],

  // Runs the farm: the animals, the recording, the store, and the people.
  FARM_MANAGER: [
    'dashboard',
    'livestock',
    'recording',
    'trade',
    'inventory',
    'money',
    'approvals',
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
  /*
   * Plus the store, because receiving is their job.
   *
   * The posting rules name a Store Officer as the maker of a goods receipt and
   * a supervisor as its approver — and this role had no route to either screen,
   * so the one person on site when the truck arrives could not record what came
   * off it. What they get is the store and the receiving pages, not the buying
   * pages: a supervisor confirms that thirty bags arrived, and has no business
   * knowing what the farm agreed to pay for them.
   */
  PRODUCTION_SUPERVISOR: ['dashboard', 'livestock', 'recording', 'inventory'],
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
  // Its own section rather than folded into money or trade: approving spans
  // both — a payroll run and a goods receipt sit in the same queue — and the
  // roles that may approve are not the roles that may read the ledger.
  { prefix: '/approvals', section: 'approvals' },
  { prefix: '/finance', section: 'money' },
  { prefix: '/sales', section: 'trade' },
  { prefix: '/procurement', section: 'trade' },
  /*
   * Receiving belongs to the store, not to buying.
   *
   * Longer prefixes win, so these two win over `/procurement` above. The split
   * is the point: raising and approving an order is a commercial act about
   * money, while receiving is a physical act about quantity, and the roles that
   * do them are different people on a real farm.
   */
  { prefix: '/procurement/receive', section: 'inventory' },
  { prefix: '/procurement/receipts', section: 'inventory' },
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
