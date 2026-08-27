import {
  IconBox,
  IconCart,
  IconChart,
  IconCheckCircle,
  IconClipboard,
  IconDashboard,
  IconFarm,
  IconSettings,
  IconTag,
  IconUsers,
  IconWallet,
  type IconProps,
} from '@/components/icons';
import type { Section } from './permissions';

/**
 * Where everything lives. One file, one answer.
 *
 * The navigation used to be described in two places that did not know about
 * each other — a sidebar with its own list, and four hand-written tab sets —
 * and they disagreed. `/pens` appeared under Farm as "Houses & pens" and again
 * under Setup as "Farms & pens"; `/suppliers` appeared twice as "Vendors". Both
 * placements were individually reasonable, which is exactly how this happens:
 * nobody adds a duplicate on purpose, they add a second sensible home for
 * something and no single file is in a position to notice.
 *
 * So there is now one tree. The sidebar renders its sections, the tab bars
 * render a section's children, and search indexes the whole thing. A
 * destination that appears twice here is visible as a duplicate the moment you
 * read the file, and `assertOneHomePerRoute` below fails the build if one slips
 * through anyway.
 *
 * The grouping follows the client's own vocabulary from the workbook's
 * AGRIPRO_MODULE_WORKFLOW sheet — setup, procure-to-pay, order-to-cash,
 * inventory, payroll, close, reporting. That is a deliberate choice over
 * inventing our own: their UAT reviewers will look for things under the names
 * their specification uses, and every module still to be built already has a
 * shelf waiting for it rather than needing the menu reorganised again.
 */

export interface NavEntry {
  href: string;
  /** What it is called. The farm's word where there is one, not the ledger's. */
  label: string;
  /** One line for search results and hover, saying what you would come here for. */
  hint?: string;
  /** Extra words that should find this entry in search but do not belong on screen. */
  keywords?: string[];
  /** Marks a page that exists but is openly labelled unfinished. */
  partial?: boolean;
  /**
   * Belongs to the section but is not a tab.
   *
   * Detail and form pages need a section — otherwise the tab bar vanishes the
   * moment you open one, and the user loses their place — but they are reached
   * from a row or a button, never from the tab bar itself. Listing them here
   * keeps them findable in search and keeps the tabs correct while you are on
   * them.
   */
  hidden?: boolean;
}

export interface NavSection {
  key: string;
  label: string;
  icon: React.ComponentType<IconProps>;
  /** Which permission section governs the whole group. */
  section: Section;
  /** Where the section opens. Always the first child unless stated. */
  href: string;
  children: NavEntry[];
}

/**
 * The business cycles, in the order a farm meets them.
 *
 * Buying comes before selling because a farm spends before it earns, and stock
 * sits between them because that is literally where the goods are. Books and
 * Reports come last because they are the consequence of everything above.
 */
export const SECTIONS: NavSection[] = [
  {
    key: 'farm',
    label: 'Farm',
    icon: IconFarm,
    section: 'livestock',
    href: '/farm',
    children: [
      { href: '/farm', label: 'Overview', hint: 'Every farm, house and pen at a glance' },
      {
        href: '/pens',
        label: 'Houses & pens',
        hint: 'Add a house or pen, and see what is living in each',
        keywords: ['greenhouse', 'coop', 'house', 'pen', 'structure'],
      },
      {
        href: '/farm/activity',
        label: "What's happened",
        hint: 'Everything recorded on the farm, newest first',
        keywords: ['history', 'activity', 'log', 'timeline'],
      },
    ],
  },

  {
    key: 'buying',
    label: 'Buying',
    icon: IconCart,
    section: 'trade',
    href: '/procurement',
    children: [
      {
        href: '/procurement',
        label: 'Purchase orders',
        hint: 'What has been ordered, and what still needs approving',
        keywords: ['po', 'order', 'procurement', 'purchase', 'p2p'],
      },
      {
        href: '/procurement/new',
        label: 'Buy supplies',
        hint: 'Raise an order for feed, medication or anything else',
        keywords: ['new order', 'raise', 'requisition'],
      },
      {
        href: '/suppliers',
        label: 'Vendors',
        hint: 'Everyone the farm buys from',
        keywords: ['supplier', 'vendor', 'seller'],
      },
    ],
  },

  {
    key: 'selling',
    label: 'Selling',
    icon: IconTag,
    section: 'trade',
    href: '/sales',
    children: [
      {
        href: '/sales',
        label: 'Sales',
        hint: 'What has been sold and what is still owed',
        keywords: ['revenue', 'order', 'o2c', 'invoice'],
      },
      {
        href: '/sales/new',
        label: 'Record a sale',
        hint: 'Sell birds, snails, eggs or produce',
        keywords: ['new sale', 'sell'],
      },
      {
        href: '/customers',
        label: 'Customers',
        hint: 'Everyone the farm sells to',
        keywords: ['buyer', 'customer', 'client', 'debtor'],
      },
    ],
  },

  {
    key: 'stock',
    label: 'Store',
    icon: IconBox,
    section: 'inventory',
    href: '/inventory',
    children: [
      {
        href: '/inventory',
        label: 'What we have',
        hint: 'Feed, medication and produce on hand',
        keywords: ['stock', 'inventory', 'on hand', 'balance'],
      },
      /*
       * Receiving lives with the store, not with buying.
       *
       * The two halves of a delivery belong to different people: raising and
       * approving an order is a commercial act about money, and taking goods
       * off a vehicle is a physical act about quantity. The store supervisor
       * does the second and is deliberately not shown the first, so filing
       * this under Buying would have put the one screen they need behind a
       * section they cannot open. Buying still links straight here from each
       * approved order.
       */
      {
        href: '/procurement/receipts',
        label: 'Goods received',
        hint: 'Deliveries taken in, and the ledger entry each one made',
        keywords: ['grn', 'delivery', 'receipt', 'grni', 'received', 'arrived'],
      },
      /*
       * The receive form, listed so the tab bar survives being on it.
       *
       * Its real route carries an order id, so search sends you to the list of
       * what is expected instead — one step back, where you choose which
       * delivery you are recording. Sending somebody to `/procurement/receive`
       * itself would be a 404, and a search result that 404s is worse than one
       * that lands a click away.
       */
      {
        href: '/procurement/receive',
        label: 'Record a delivery',
        hint: 'Enter what came off the vehicle against an approved order',
        keywords: ['receive', 'delivery', 'goods in', 'unload'],
        hidden: true,
      },
      {
        href: '/items',
        label: 'Items',
        hint: 'Everything the farm buys, stores or sells',
        keywords: ['item', 'product', 'sku', 'material', 'feed'],
      },
      {
        href: '/stores',
        label: 'Stores',
        hint: 'Where stock physically sits',
        keywords: ['warehouse', 'store', 'location', 'cold room'],
      },
    ],
  },

  {
    key: 'people',
    label: 'People',
    icon: IconUsers,
    section: 'staff',
    href: '/staff',
    children: [
      {
        href: '/staff',
        label: 'Staff',
        hint: 'Who works here, and what they may do',
        keywords: ['employee', 'worker', 'staff', 'user', 'role', 'invite'],
      },
    ],
  },

  {
    key: 'money',
    label: 'Money',
    icon: IconWallet,
    section: 'money',
    href: '/finance',
    children: [
      {
        href: '/finance',
        label: 'Money in & out',
        hint: 'What came in, what went out, what is owed',
        keywords: ['cash', 'finance', 'income', 'expense'],
      },
      {
        href: '/finance/batches',
        label: 'What each population made',
        hint: 'Profit and cost per flock or cohort',
        keywords: ['profitability', 'margin', 'batch', 'flock', 'cohort', 'cost'],
      },
      {
        href: '/finance/losses',
        label: 'Watching for losses',
        hint: 'Where the farm is losing money, and why',
        keywords: ['loss', 'mortality', 'waste', 'shrinkage'],
      },
      /*
       * Filed here, not under People — the API's own `@Roles(...)` guard on
       * `PayrollController` only ever admitted Finance Manager, Finance
       * Controller and CFO, and People > Staff is gated to a `staff`
       * permission none of them hold. Nav home should match who can actually
       * use the screen.
       */
      {
        href: '/finance/payroll',
        label: 'Payroll setup',
        hint: 'Turn on the current PAYE, pension, NHF, NSITF and ITF rates',
        keywords: ['payroll', 'paye', 'nhf', 'nsitf', 'itf', 'pension', 'statutory', 'tax'],
      },
    ],
  },

  {
    /*
     * The accountant's section, deliberately separate from Money.
     *
     * These used to be tabs beside "Money in & out", which put a trial balance
     * one click from a screen a farm manager uses daily. §56 of the handbook is
     * explicit that journals, GL accounts and variance mechanics are for
     * authorised finance roles only — and a section is a much clearer boundary
     * than a tab.
     */
    key: 'books',
    label: 'Books',
    icon: IconClipboard,
    section: 'ledger',
    href: '/ledger/trial-balance',
    children: [
      {
        href: '/ledger/trial-balance',
        label: 'Trial balance',
        hint: 'Every account and its balance',
        keywords: ['tb', 'trial balance', 'balances'],
      },
      {
        href: '/ledger/journals',
        label: 'Journal entries',
        hint: 'Every posting, with what caused it',
        keywords: ['journal', 'gl', 'posting', 'entry', 'double entry'],
      },
      {
        href: '/ledger/audit',
        label: 'Audit trail',
        hint: 'Who did what, when, and what changed',
        keywords: ['audit', 'trail', 'history', 'who changed'],
      },
    ],
  },

  {
    key: 'approvals',
    label: 'Approvals',
    icon: IconCheckCircle,
    section: 'approvals',
    href: '/approvals',
    children: [
      {
        href: '/approvals',
        label: 'Waiting on you',
        hint: 'Documents you can approve or send back',
        keywords: ['approve', 'reject', 'authorise', 'sign off', 'queue', 'inbox'],
      },
    ],
  },

  {
    /*
     * Only what has no cycle of its own.
     *
     * Vendors, customers, items and stores used to live here, which made Setup
     * a nine-tab drawer of unrelated things and meant a vendor had two homes.
     * They now sit with the work that uses them; what stays is the structure of
     * the business itself and the app's own preferences.
     */
    key: 'setup',
    label: 'Setup',
    icon: IconSettings,
    section: 'settings',
    href: '/admin',
    children: [
      {
        href: '/admin',
        label: 'Overview',
        hint: 'Every kind of record, with a count and where to add one',
        keywords: ['admin', 'setup', 'configuration', 'master data'],
      },
      {
        href: '/admin/cost-centres',
        label: 'Cost centres',
        hint: 'What a cost is attributed to',
        keywords: ['cost centre', 'cost center', 'department', 'dimension'],
      },
      {
        href: '/settings',
        label: 'Preferences',
        hint: 'Language, units, feed lead times and thresholds',
        keywords: ['settings', 'preferences', 'options', 'configure'],
      },
    ],
  },
];

/**
 * The platform itself, named.
 *
 * Sits with Home above the cycles rather than among them, because it is not a
 * cycle — it is the thing the cycles belong to. A client who has read the
 * specification and opened the application should be able to see the word
 * AgriPro without being told where to look.
 */
export const CORE: NavSection = {
  key: 'core',
  label: 'AgriPro Core',
  icon: IconChart,
  section: 'dashboard',
  href: '/agripro',
  children: [
    {
      href: '/agripro',
      label: 'Overview',
      hint: 'The shared platform, what it does, and how far each part has got',
      keywords: ['agripro', 'core', 'platform', 'erp', 'modules', 'architecture'],
    },
    {
      href: '/agripro/posting-rules',
      label: 'Posting rules',
      hint: 'What every business event does to the ledger, and which accounts it touches',
      keywords: [
        'posting',
        'rule',
        'ledger flag',
        'gl',
        'chart',
        'pcr',
        'double entry',
        'debit',
        'credit',
        'section 66',
      ],
    },
    {
      href: '/agripro/biological-assets',
      label: 'Biological assets',
      hint: 'Every population’s carrying value, mortality, stage transfers and valuations',
      keywords: [
        'biological asset',
        'ias 41',
        'fvlcts',
        'fair value',
        'valuation',
        'carrying value',
        'mortality',
        'stage transfer',
        'roll-forward',
        'section 61',
        'section 67',
      ],
    },
  ],
};

/** The dashboard is its own thing, above the cycles. */
export const HOME: NavSection = {
  key: 'home',
  label: 'Home',
  icon: IconDashboard,
  section: 'dashboard',
  href: '/',
  children: [{ href: '/', label: 'Home', hint: 'What needs attention today' }],
};

/**
 * Modules the specification requires and this application does not have yet.
 *
 * Listed rather than omitted, and listed here rather than in a document nobody
 * opens, so that the shape of the finished product is visible from inside the
 * product. §48 of the brief requires unimplemented features to be marked as
 * such; a menu that quietly lacks a fixed-asset register reads as a menu that
 * has one somewhere.
 */
export const NOT_BUILT_YET: Array<{ label: string; belongsUnder: string; why: string }> = [
  { label: 'Supplier invoices', belongsUnder: 'Buying', why: 'Clears GRNI and adds the VAT' },
  { label: 'Payments', belongsUnder: 'Buying', why: 'Settles what is owed to a vendor' },
  { label: 'Feed mill', belongsUnder: 'Store', why: 'Making feed rather than buying it' },
  { label: 'Processing', belongsUnder: 'Store', why: 'Turning livestock into product' },
  {
    label: 'Payroll runs',
    belongsUnder: 'People',
    why: 'Raising a monthly run, payslips and approval — activating the statutory rates is now under People → Payroll setup',
  },
  { label: 'Banking', belongsUnder: 'Money', why: 'Accounts and reconciliation' },
  { label: 'Fixed assets', belongsUnder: 'Money', why: 'Register and depreciation' },
  { label: 'Period close', belongsUnder: 'Books', why: 'Checklist, close and year end' },
  { label: 'Chart of accounts', belongsUnder: 'Setup', why: 'The accounts everything posts to' },
];

/* --- Derived views ------------------------------------------------------ */

/** The section a path belongs to, longest match first. */
export function sectionFor(pathname: string): NavSection | undefined {
  const candidates = SECTIONS.filter((section) =>
    section.children.some(
      (child) => pathname === child.href || pathname.startsWith(`${child.href}/`),
    ),
  );
  if (candidates.length === 0) return undefined;

  // A path under two sections resolves to the one whose matching child is the
  // most specific, so `/procurement/receipts` never resolves via `/procurement`.
  return candidates.sort((a, b) => longestMatch(b, pathname) - longestMatch(a, pathname))[0];
}

function longestMatch(section: NavSection, pathname: string): number {
  return section.children
    .filter((child) => pathname === child.href || pathname.startsWith(`${child.href}/`))
    .reduce((longest, child) => Math.max(longest, child.href.length), 0);
}

/** Every destination, flattened — what search indexes. */
export function allEntries(): Array<NavEntry & { section: NavSection }> {
  return [HOME, CORE, ...SECTIONS].flatMap((section) =>
    section.children.map((child) => ({ ...child, section })),
  );
}

/**
 * The specific entry a path resolves to, and the section that owns it.
 *
 * Built for breadcrumbs, which need the exact child page — `sectionFor` only
 * needs to know which section, so it stops at that. Same longest-match rule
 * as `sectionFor`: `/procurement/receipts` resolves to "Goods received", not
 * to "Purchase orders", because its own href is the longer, more specific
 * match. Covers `HOME` and `CORE` too, which `sectionFor` does not — a
 * breadcrumb on an AgriPro Core page with no trail would be a worse bug than
 * one that never renders.
 */
export function entryFor(pathname: string): { section: NavSection; entry: NavEntry } | undefined {
  const matches = allEntries().filter(
    (entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`),
  );
  if (matches.length === 0) return undefined;

  const best = matches.sort((a, b) => b.href.length - a.href.length)[0]!;
  const { section, ...entry } = best;
  return { section, entry };
}

/**
 * Fail loudly if a route acquires a second home.
 *
 * Called from the sidebar in development. The duplication this exists to catch
 * took months to notice by eye, and it was only noticed at all because somebody
 * went looking for where vendors were created and found two answers.
 */
export function duplicateRoutes(): string[] {
  const seen = new Map<string, number>();
  for (const entry of allEntries()) {
    seen.set(entry.href, (seen.get(entry.href) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([href]) => href);
}
