/**
 * The shape of a sellable/purchasable product, and its VAT-label copy.
 *
 * Not demo data despite this file's neighbours — `getSellableItems()` and
 * `getPurchasableItems()` in lib/trade.ts read real items from
 * `/masters/items` into exactly this shape (the same "match the shape,
 * swap the source" discipline as the rest of this migration), so only the
 * type and the static VAT labels live here now.
 *
 * The price is a DEFAULT, not a fixed rate. Nigerian farm-gate prices move
 * week to week and are haggled at the gate; a system that will not let the
 * seller change the price at the point of sale is a system that gets a made-up
 * price typed into it, or gets bypassed entirely.
 */

import type { ModuleKey } from './modules';

export type VatTreatment = 'ZERO_RATED' | 'STANDARD' | 'EXEMPT';

export interface Product {
  id: string;
  code: string;
  name: string;
  category: 'Eggs' | 'Live birds' | 'Dressed' | 'Snails' | 'By-product';
  unit: string;
  defaultPriceKobo: string;
  /**
   * VAT treatment.
   *
   * Most of this list is ZERO-RATED rather than exempt, which is not a
   * technicality: under the Nigeria Tax Act 2025 basic food and agricultural
   * produce are zero-rated, so the farm charges no VAT AND still recovers the
   * input VAT on its feed and medication. Marking these "exempt" instead would
   * quietly cost the farm every naira of that input VAT.
   */
  vat: VatTreatment;
  /**
   * Whether selling this takes animals out of a population.
   *
   * This is the field that matters. A crate of eggs is finished goods leaving
   * the store; a live bird is an animal leaving the batch, and its share of
   * that batch's accumulated cost has to leave with it.
   */
  fromPopulation: boolean;
  moduleKey?: ModuleKey;
  /** Animals removed per unit sold. A bird is 1; a kg of snails is many. */
  animalsPerUnit?: number;
}

export const VAT_LABELS: Record<VatTreatment, string> = {
  ZERO_RATED: 'No VAT (zero-rated)',
  STANDARD: 'VAT 7.5%',
  EXEMPT: 'Exempt',
};
