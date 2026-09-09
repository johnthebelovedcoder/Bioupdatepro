import 'server-only';
import { api } from './api';
import type { Customer, Supplier } from './demo-trade';
import type { Product } from './demo-products';

/**
 * Customers, suppliers and sellable items, from the database.
 *
 * The sale and purchase screens were choosing from lists held in the browser,
 * so every id they submitted named a row that did not exist. The endpoints now
 * accept those submissions, which makes the ids matter: this is what turns the
 * screens from a form into a transaction.
 *
 * Same discipline as lib/operations.ts — these return the shapes the components
 * were already written against, so only the source changes.
 */

interface ApiCustomer {
  id: string;
  code: string;
  name: string;
  status: string;
  creditLimitKobo: string | null;
  riskRating: string | null;
}

interface ApiSupplier {
  id: string;
  code: string;
  name: string;
  status: string;
  paymentTerm: string | null;
  netDays: number | null;
  creditLimitKobo: string | null;
}

interface ApiItem {
  id: string;
  code: string;
  description: string;
  itemType: string;
  isBiologicalFeed: boolean;
  unitOfMeasure: string;
  vatCode: string | null;
  standardCostKobo: string | null;
}

export async function getCustomers(): Promise<Customer[]> {
  const rows = await api<ApiCustomer[]>('/masters/customers?status=ACTIVE');
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.riskRating ?? 'Customer',
    phone: '',
    /*
     * Zero rather than a plausible-looking figure.
     *
     * The real balance is the sum of that customer's unpaid invoices, and this
     * farm has none yet. Inventing one would put a number on the credit warning
     * that nothing in the ledger supports — and the warning exists precisely to
     * stop somebody selling on credit to a customer who already owes too much.
     */
    balanceKobo: '0',
    overdueKobo: '0',
    lastOrderOn: '',
  }));
}

export async function getSuppliers(): Promise<Supplier[]> {
  const rows = await api<ApiSupplier[]>('/masters/suppliers?status=ACTIVE');
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: 'Supplier',
    phone: '',
    leadDays: row.netDays ?? 0,
    // The payment term the supplier master actually carries, rather than a
    // guess — it is what decides when their invoice falls due.
    terms: row.paymentTerm ?? '',
    balanceKobo: '0',
    lastOrderOn: '',
  }));
}

/**
 * What the farm can sell, from the item master.
 *
 * The default price is deliberately ZERO. There is no price list in this
 * company yet, and the only money the item master carries is standard COST —
 * offering that as a selling price would prefill every sale at break-even and
 * some of them would be accepted. The form already refuses a zero price with
 * "Set a price for X", so an absent price stops the sale rather than quietly
 * mispricing it.
 */
export async function getSellableItems(): Promise<Product[]> {
  const rows = await api<ApiItem[]>('/masters/items');
  return rows
    .filter((row) => !row.isBiologicalFeed)
    .map((row) => ({
      id: row.id,
      code: row.code,
      name: row.description,
      category: categoryFor(row),
      unit: row.unitOfMeasure,
      defaultPriceKobo: '0',
      // Agricultural produce is zero-rated under the Nigeria Tax Act 2025, and
      // the item's own VAT code is what the tax engine will actually apply on
      // the order — this is only what the screen shows beside the line.
      vat: row.vatCode?.toUpperCase().includes('STD') ? 'STANDARD' : 'ZERO',
      /*
       * Whether selling this takes animals out of a population.
       *
       * Read off the code, which is a heuristic and should not stay one — it
       * belongs in the item master as a flag beside `isBiologicalFeed`. It is
       * here because the alternative is worse: without it the batch picker
       * never appears, the sale never reports how many animals left, and a
       * population quietly stays at its old count after the birds have gone.
       */
      fromPopulation: /\bLIVE\b|-LIVE/.test(row.code.toUpperCase()),
      animalsPerUnit: 1,
    })) as Product[];
}

/** Everything the farm buys, feed included. */
export async function getPurchasableItems(): Promise<Product[]> {
  const rows = await api<ApiItem[]>('/masters/items');
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.description,
    category: categoryFor(row),
    unit: row.unitOfMeasure,
    // Here the standard cost IS the right default: it is what the farm expects
    // to pay, and a purchase price that differs from it is worth noticing.
    defaultPriceKobo: row.standardCostKobo ?? '0',
    vat: row.vatCode?.toUpperCase().includes('STD') ? 'STANDARD' : 'ZERO',
    fromPopulation: false,
    animalsPerUnit: 1,
  })) as Product[];
}

export interface GlAccount {
  id: string;
  accountNumber: string;
  name: string;
  accountType: string;
  fsCategory: string | null;
  fsCategorySetAt: string | null;
}

/** Active posting accounts, for a bank/cash picker on a payment form. */
export async function getGlAccounts(): Promise<GlAccount[]> {
  return api<GlAccount[]>('/masters/gl-accounts');
}

export interface SpeciesBreed {
  id: string;
  speciesKey: string;
  code: string;
  name: string;
  classification: string | null;
}

/**
 * The governed species/breed names for one module (US-897-004/005) — real
 * data instead of farm-config.ts's hardcoded suggestion list. Returns an
 * empty array rather than throwing for a company that has not registered any
 * yet; the placement form's own free-text entry already covers that case.
 */
export async function getSpeciesBreeds(speciesKey: string): Promise<SpeciesBreed[]> {
  return api<SpeciesBreed[]>(`/masters/species-breeds?speciesKey=${encodeURIComponent(speciesKey)}`);
}

export interface LedgerMoney {
  revenueKobo: string;
  expenseKobo: string;
  receivableKobo: string;
  workInProgressKobo: string;
  finishedGoodsKobo: string;
}

/**
 * The dashboard's money, from the ledger rather than a fixture.
 *
 * Expect zeroes where the farm genuinely has none. That is the point: the
 * previous figures were invented and a farmer who spotted one wrong number
 * would rightly stop believing the rest of the screen.
 */
export async function getLedgerMoney(): Promise<LedgerMoney> {
  return api<LedgerMoney>('/reporting/money-summary');
}

export interface ExpenseCategoryLine {
  accountNumber: string;
  accountName: string;
  amountKobo: string;
}

export interface FinancePeriodPoint {
  date: string;
  label: string;
  revenueKobo: string;
  expenseKobo: string;
}

export interface FinanceTrend {
  points: FinancePeriodPoint[];
  /** By account, for the most recent of the periods in `points`. */
  expenseByCategory: ExpenseCategoryLine[];
}

/**
 * Revenue and expense, period by period — the Finance page's trend charts,
 * replacing lib/demo-trade.ts's getCashFlow() (six months that never moved,
 * whatever a farm actually posted).
 *
 * Built on `/reporting/money-summary/trend`, not `/reporting/profit-loss`:
 * both compute the same figures from the same posted journal lines, but
 * profit-loss is gated to finance-only roles while this page's own stated
 * intent is a simplified view "in the words a farm manager uses" — a Farm
 * Manager has the 'money' section on the web side and was always allowed to
 * open this page, so the endpoint behind it has to match that, not quietly
 * hand over a ledger-level report through the back door of a page a Farm
 * Manager already had.
 */
export async function getFinanceTrend(periods = 6): Promise<FinanceTrend> {
  return api<FinanceTrend>(`/reporting/money-summary/trend?periods=${periods}`);
}

function categoryFor(row: ApiItem): Product['category'] {
  const code = row.code.toUpperCase();
  if (code.startsWith('FG-')) return 'Dressed';
  if (code.startsWith('RM-')) return 'By-product';
  return 'By-product';
}
