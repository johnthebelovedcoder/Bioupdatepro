import { MODULES, type ModuleKey, type SpeciesModule } from './modules';
import { SECTIONS, NOT_BUILT_YET } from './navigation';

/**
 * AgriPro Core, and the species products that sit on top of it.
 *
 * The specification is unambiguous about the shape of this product, and the
 * application had not reflected it anywhere a user could see. §60: "AgriPro is
 * the core ERP platform. SnailPro and PoultryPro are operational extensions
 * that add species-specific lifecycle screens and events. They must use
 * AgriPro's shared masters, controls, posting engine, subledgers, GL and
 * reports. They must never create separate accounting, procurement, inventory,
 * payroll, security, workflow or audit engines."
 *
 * Until now the word "AgriPro" appeared nowhere in the running product — a
 * client reading his own specification and then opening the app had no way to
 * tell that the thing he commissioned was in there. It was, structurally: the
 * business cycles in the sidebar ARE the platform layer. They were simply
 * filed under the heading "The business", which names nothing.
 *
 * So this file is not a rename. It is the missing statement of what the parts
 * are, which the navigation, the switcher and the Core overview all read from.
 *
 * On the branding question, deliberately left alone: the suite is BioAssetPro
 * and the platform inside it is AgriPro Core. The client's document never
 * mentions BioAssetPro, so whether the whole product should take the AgriPro
 * name is a commercial decision, not one to make quietly in a refactor.
 */

export interface CoreCapability {
  /** The cycle, in the specification's own vocabulary. */
  name: string;
  /** What it does, in the farm's. */
  what: string;
  /** The navigation section it lives in, when it has screens. */
  sectionKey?: string;
  /**
   * A specific page, when the section's own root is not the right link — the
   * biological-asset ledger lives under AgriPro Core's own pages, not under
   * one of the business-cycle `SECTIONS`, so `sectionKey` cannot resolve it.
   */
  href?: string;
  state: 'live' | 'engine-only' | 'not-built';
  /** Why it is in that state — stated, never implied. */
  note?: string;
}

/**
 * What the platform layer actually consists of, and how far each part is.
 *
 * Three states, because two would lie. "Engine-only" is the honest description
 * of most of this application: the posting rules exist, they are covered by
 * integration tests, and no person can reach them because nothing renders a
 * screen. Calling that either "done" or "missing" would misinform somebody
 * planning the next month of work.
 */
export const CORE_CAPABILITIES: CoreCapability[] = [
  {
    name: 'Platform controls',
    what: 'Companies, farms, users, roles, approvals, audit trail, periods',
    sectionKey: 'setup',
    state: 'live',
  },
  {
    name: 'Procure to pay',
    what: 'Orders, goods receipt, supplier invoices, payments',
    sectionKey: 'buying',
    state: 'engine-only',
    note: 'Orders and goods receipt have screens; invoices and payments post only through the API.',
  },
  {
    name: 'Order to cash',
    what: 'Sales orders, delivery, invoices, customer receipts',
    sectionKey: 'selling',
    state: 'engine-only',
    note: 'Recording a sale works; the invoice and receipt chain has no screens yet.',
  },
  {
    name: 'Inventory',
    what: 'Stock on hand, movements, valuation',
    sectionKey: 'stock',
    state: 'live',
  },
  {
    name: 'Approval workflow',
    what: 'One engine, every document, maker-checker throughout',
    sectionKey: 'approvals',
    state: 'live',
  },
  {
    name: 'General ledger',
    what: 'Journals, trial balance, audit trail',
    sectionKey: 'books',
    state: 'live',
  },
  {
    name: 'Tax',
    what: 'VAT and withholding through one shared engine',
    state: 'engine-only',
    note: 'Rates are configured through the API; there is no tax screen.',
  },
  {
    name: 'Biological assets',
    what: 'IAS 41 carrying value, mortality, stage transfer and FVLCTS valuation',
    href: '/agripro/biological-assets',
    state: 'live',
    note:
      'Acquisition, mortality and stage transfer post automatically; valuation goes through ' +
      'the same maker-checker queue as every other document. Covers snail and poultry; the ' +
      'stage-account mapping is only as complete as the product’s own stage vocabulary.',
  },
  {
    name: 'HR and payroll',
    what: 'Employees, PAYE, pension, statutory levies',
    sectionKey: 'people',
    state: 'engine-only',
    note:
      'The 2026 PAYE engine matches the specification. Activating a company’s ' +
      'statutory rates now has a screen (People → Payroll setup); raising and ' +
      'approving an actual monthly run still does not.',
  },
  {
    name: 'Period close',
    what: 'Checklist, reconciliations, close and year end',
    state: 'engine-only',
    note: 'Closing runs through the API only.',
  },
  { name: 'Fixed assets', what: 'Register, depreciation, disposal', state: 'not-built' },
  { name: 'Banking', what: 'Accounts, transactions, reconciliation', state: 'not-built' },
  {
    name: 'Posting control',
    what: 'Table-driven posting rules and the ledger-flag guard',
    state: 'not-built',
    note: 'Specification §66. Postings are currently written in code, not resolved from a rule table.',
  },
];

/** How far along the platform is, counted rather than asserted. */
export function coreProgress() {
  const live = CORE_CAPABILITIES.filter((c) => c.state === 'live').length;
  const engine = CORE_CAPABILITIES.filter((c) => c.state === 'engine-only').length;
  const missing = CORE_CAPABILITIES.filter((c) => c.state === 'not-built').length;
  return { live, engine, missing, total: CORE_CAPABILITIES.length };
}

/** The sections a capability points at, for linking out of the Core page. */
export function sectionHref(key?: string): string | null {
  if (!key) return null;
  return SECTIONS.find((section) => section.key === key)?.href ?? null;
}

/** Species products installed on top of the platform. */
export function installedModules(): SpeciesModule[] {
  return MODULES.filter((module) => module.subscribed);
}

/** Species products the registry knows about but this farm has not bought. */
export function availableModules(): SpeciesModule[] {
  return MODULES.filter((module) => !module.subscribed);
}

/**
 * The gaps, grouped for the Core page.
 *
 * Shared with the Setup hub rather than duplicated, so the two pages cannot
 * end up telling different stories about what is finished.
 */
export const CORE_GAPS = NOT_BUILT_YET;

export type { ModuleKey };
