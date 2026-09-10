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

/*
 * The client's own `Role_RACI_KPI` sheet names sixteen roles. Only six had an
 * entry here — everyone else signing in with a title from the client's own
 * document got an empty sidebar, because an unrecognised role fails closed
 * (see `sectionsFor` below) with nothing on screen to say why. The other ten
 * roles below close that gap.
 *
 * This is still the cosmetic layer the file header describes: adding a role
 * here makes the RIGHT PAGES OFFER THEMSELVES and lets already-`@AnyRole`
 * reads through, exactly like every existing entry. It does NOT grant a
 * write action the API doesn't already permit — raising a PO, approving a
 * valuation and the rest stay behind the API's own `@Roles(...)` guards,
 * which are not extended here. Wiring those to match this table's shape is a
 * separate, larger pass: each of the RACI sheet's ~39 controlled endpoints
 * needs its own judgement call against that role's stated boundary ("cannot
 * approve own PO", "cannot alter posted invoice", and so on), not a
 * mechanical copy of this list.
 */
const BY_ROLE: Record<string, Section[]> = {
  ADMINISTRATOR: ALL,
  CFO: ALL,

  // ROL-001. Captures the daily round only — not the full livestock section,
  // which also holds the register and cost figures a farm attendant has no
  // reason to see. "Supervisor reviews; cannot post GL."
  FARM_ATTENDANT: ['dashboard', 'recording'],

  // ROL-002 / ROL-003. The RACI sheet splits the supervisor by species; the
  // product still has one PRODUCTION_SUPERVISOR role underneath (§ vocabulary
  // audit flags the split as unbuilt). Both get the same reach that role has
  // today, so a farm that adopts the RACI titles is not penalised for it.
  SNAIL_SUPERVISOR: ['dashboard', 'livestock', 'recording', 'inventory'],
  POULTRY_SUPERVISOR: ['dashboard', 'livestock', 'recording', 'inventory'],

  // ROL-005. Sources and raises purchase orders. Not inventory — receiving
  // what arrives is the Storekeeper's job, not theirs ("cannot ...receive own PO").
  PROCUREMENT_OFFICER: ['dashboard', 'trade'],

  // ROL-006. "Receive, issue, transfer and count inventory; site scoped."
  STOREKEEPER: ['dashboard', 'inventory'],

  // ROL-007. "Inspect, hold, release or reject lots; independent from
  // production." No dedicated QA section exists yet — inventory is the
  // closest home for lot-level decisions until one does.
  QA_OFFICER: ['dashboard', 'inventory'],

  // ROL-008. Processing/production orders are not built (see the core-gap
  // audit), so this mirrors the supervisor roles until there is a production
  // section of its own to narrow it to.
  PRODUCTION_LEAD: ['dashboard', 'livestock', 'recording', 'inventory'],

  // ROL-009. Matches invoices against goods receipt and keeps supplier
  // accounts — reads the trade side, not the ledger. Needs 'inventory' too:
  // the only door to entering an invoice is a link on the goods-received
  // list ("Enter the supplier's invoice"), and the API's own GET
  // /procurement/receipts/:id is explicitly open to "anyone entering an
  // invoice" — without this section that door was behind a wall for the
  // one role whose job the whole screen exists for.
  AP_OFFICER: ['dashboard', 'trade', 'money', 'inventory'],

  // ROL-010. "Create order, dispatch and invoice; cannot override credit/QA hold."
  SALES_OFFICER: ['dashboard', 'trade'],

  // ROL-011. Applies receipts and reconciles customer balances.
  AR_OFFICER: ['dashboard', 'trade', 'money'],

  // ROL-012. "Reconcile BA, inventory, WIP, journals and valuations" — needs
  // to see the ledger to tie it out, not to approve what is posted to it.
  FARM_ACCOUNTANT: ['dashboard', 'livestock', 'inventory', 'ledger'],

  // ROL-014. Prepares payments and reconciles the bank — the money section,
  // not the books themselves. Needs 'trade' too: the only screen with a
  // payment form is Buying > Invoices (/procurement/invoices), and the API's
  // own POST /procurement/payments names TREASURY_OFFICER as who makes this —
  // without this section the one person whose job is paying suppliers could
  // not reach the button that does it.
  TREASURY_OFFICER: ['dashboard', 'money', 'trade'],

  // ROL-015. Configuration and access, explicitly NOT finance or operations
  // ("cannot approve finance/operations") — so no money, ledger or approvals.
  SYSTEM_ADMIN: ['dashboard', 'staff', 'settings'],

  // ROL-016. "Review controls, audit trail and traceability... Read-only."
  // Broad reach by design — an auditor who cannot see a cycle cannot audit
  // it — but no approvals, staff admin or settings: those are not what they
  // are there to review.
  INTERNAL_AUDITOR: ['dashboard', 'livestock', 'trade', 'inventory', 'money', 'ledger'],

  // The books, and everything feeding them.
  FINANCE_CONTROLLER: [
    'dashboard',
    'livestock',
    // `recording` split out of `livestock` above (the daily-round page now
    // resolves there specifically) — kept here so this role loses no reach
    // it already had.
    'recording',
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
    'recording',
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

/** Every section that exists, and every role the client's RACI sheet names — for the admin override matrix (US-897-035) to enumerate. */
export const ALL_SECTIONS: Section[] = ALL;
export const ALL_ROLES: string[] = Object.keys(BY_ROLE);

/** One admin-set exception to the table above, for one company (US-897-035). */
export interface RoleSectionOverride {
  role: string;
  section: string;
  enabled: boolean;
}

/**
 * The hardcoded defaults above, with a company's overrides applied on top for
 * whichever of the held roles they name.
 *
 * A row beats the default for that one (role, section): `enabled: true`
 * grants a section a role's hardcoded entry never had, `enabled: false`
 * withdraws one it did. Absence of a row changes nothing — this stays a pure
 * function so it works the same in a server fetch and in a client re-render.
 */
export function applyOverrides(
  base: ReadonlySet<Section>,
  roles: readonly string[],
  overrides: readonly RoleSectionOverride[],
): Set<Section> {
  const result = new Set(base);
  for (const override of overrides) {
    if (!roles.includes(override.role)) continue;
    if (override.enabled) result.add(override.section as Section);
    else result.delete(override.section as Section);
  }
  return result;
}

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
  /*
   * Customers, items and stores used to live at `/admin/customers`,
   * `/admin/items` and `/admin/stores` even though `navigation.ts` files them
   * under Selling and Store — a URL taxonomy that contradicted the
   * information taxonomy, and the reason this table once needed three
   * special-cased entries just to route around its own segment name. Moved
   * to top-level routes that match where they actually live; the ROUTES
   * entries below are now the ordinary kind, same shape as everything else.
   */
  { prefix: '/customers', section: 'trade' },
  { prefix: '/items', section: 'inventory' },
  { prefix: '/stores', section: 'inventory' },
  { prefix: '/admin/cost-centres', section: 'settings' },
  { prefix: '/admin', section: 'settings' },
  { prefix: '/staff', section: 'staff' },
  { prefix: '/settings', section: 'settings' },
  { prefix: '/farm', section: 'livestock' },
  // Filed under Farm and Buying respectively in `navigation.ts`, but never
  // had an entry here — both fell through to the catch-all `dashboard` rule,
  // which every role holds, so the sidebar hid them from a role without
  // `livestock`/`trade` while a direct URL let that same role straight in.
  { prefix: '/pens', section: 'livestock' },
  { prefix: '/suppliers', section: 'trade' },
  // AgriPro Core's remaining pages carry real numbers (biological-asset
  // carrying values and valuations) and had the same silent-catch-all gap as
  // above — each needs the permission section that actually governs its
  // content, not the broad `dashboard` fallback every role holds.
  { prefix: '/agripro/biological-assets', section: 'livestock' },
  { prefix: '/agripro/valuations', section: 'livestock' },
  { prefix: '/m/', section: 'livestock' },
  { prefix: '/welcome', section: 'dashboard' },
  { prefix: '/', section: 'dashboard' },
];

/**
 * `/m/{module}/records` — the daily round — resolves to `recording`, ahead
 * of the general `/m/` -> `livestock` rule below. Every module key would
 * otherwise need its own entry in `ROUTES`, which cannot express a wildcard
 * middle segment; this is what actually makes the `recording` permission
 * (granted to `FARM_ATTENDANT` and the supervisor roles) mean something
 * narrower than the rest of `livestock` — previously it was granted by
 * `permissions.ts` but never matched by any path, so it had no effect.
 */
function isDailyRoundPath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  return segments[0] === 'm' && segments[2] === 'records';
}

export function sectionForPath(pathname: string): Section {
  if (isDailyRoundPath(pathname)) return 'recording';
  const match = [...ROUTES]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((route) => pathname === route.prefix || pathname.startsWith(route.prefix));
  return match?.section ?? 'dashboard';
}
