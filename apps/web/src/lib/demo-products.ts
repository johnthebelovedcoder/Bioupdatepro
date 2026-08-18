/**
 * DEMONSTRATION DATA — NOT REAL FARM RECORDS.
 *
 * What the farm sells, and what it normally charges.
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

export async function getProducts(): Promise<Product[]> {
  return [
    {
      id: 'p-egg-crate',
      code: 'EGG-CRATE',
      name: 'Eggs — crate of 30',
      category: 'Eggs',
      unit: 'crate',
      defaultPriceKobo: '480000',
      vat: 'ZERO_RATED',
      fromPopulation: false,
    },
    {
      id: 'p-egg-cracked',
      code: 'EGG-CRACK',
      name: 'Cracked eggs — crate',
      category: 'Eggs',
      unit: 'crate',
      defaultPriceKobo: '260000',
      vat: 'ZERO_RATED',
      fromPopulation: false,
    },
    {
      id: 'p-broiler-live',
      code: 'BRD-LIVE',
      name: 'Live broiler',
      category: 'Live birds',
      unit: 'bird',
      defaultPriceKobo: '650000',
      vat: 'ZERO_RATED',
      fromPopulation: true,
      moduleKey: 'poultry',
      animalsPerUnit: 1,
    },
    {
      id: 'p-spent-layer',
      code: 'BRD-SPENT',
      name: 'Spent layer',
      category: 'Live birds',
      unit: 'bird',
      defaultPriceKobo: '420000',
      vat: 'ZERO_RATED',
      fromPopulation: true,
      moduleKey: 'poultry',
      animalsPerUnit: 1,
    },
    {
      id: 'p-dressed',
      code: 'BRD-DRESS',
      name: 'Dressed chicken',
      category: 'Dressed',
      unit: 'kg',
      defaultPriceKobo: '380000',
      vat: 'ZERO_RATED',
      fromPopulation: false,
    },
    {
      id: 'p-snail-table',
      code: 'SNL-TABLE',
      name: 'Table-size snails',
      category: 'Snails',
      unit: 'kg',
      defaultPriceKobo: '350000',
      vat: 'ZERO_RATED',
      fromPopulation: true,
      moduleKey: 'snail',
      animalsPerUnit: 12,
    },
    {
      id: 'p-snail-breeder',
      code: 'SNL-BREED',
      name: 'Breeding snails',
      category: 'Snails',
      unit: 'piece',
      defaultPriceKobo: '35000',
      vat: 'ZERO_RATED',
      fromPopulation: true,
      moduleKey: 'snail',
      animalsPerUnit: 1,
    },
    {
      id: 'p-manure',
      code: 'BY-MANURE',
      name: 'Poultry manure',
      category: 'By-product',
      unit: 'bag',
      defaultPriceKobo: '90000',
      vat: 'ZERO_RATED',
      fromPopulation: false,
    },
  ];
}

export const VAT_LABELS: Record<VatTreatment, string> = {
  ZERO_RATED: 'No VAT (zero-rated)',
  STANDARD: 'VAT 7.5%',
  EXEMPT: 'Exempt',
};
