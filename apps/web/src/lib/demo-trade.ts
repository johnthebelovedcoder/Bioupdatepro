/**
 * Type contracts for customers and suppliers.
 *
 * `lib/trade.ts` reads both from the real API — this file used to generate
 * them as fixtures, along with inventory, stock movements, purchase orders,
 * sales invoices, receivables ageing and staff, all of which now have real
 * sources elsewhere (`lib/masters.ts`, `lib/trade.ts`, `lib/procurement.ts`,
 * `lib/sales.ts`, `app/(app)/staff/actions.ts`). What is left is the two
 * shapes still shared type-only between `lib/trade.ts` and the components
 * written against them.
 */

export interface Supplier {
  id: string;
  name: string;
  category: string;
  phone: string;
  terms: string;
  balanceKobo: string;
  lastOrderOn: string;
}

export interface Customer {
  id: string;
  name: string;
  type: string;
  phone: string;
  balanceKobo: string;
  overdueKobo: string;
  lastOrderOn: string;
}
