/**
 * How THIS farm works.
 *
 * The spine for everything built on top of it. Feed runway needs lead times;
 * variance detection needs tolerances; benchmarking needs breed curves; alerts
 * need thresholds and a channel to shout down. Every one of those differs
 * between a 2,000-bird layer farm in Ogun and a 40,000-bird operation in Kano,
 * so none of them may be hard-coded into a feature.
 *
 * Three rules govern this file:
 *
 *   1. EVERY threshold in the product comes from here. If a number decides
 *      something — a colour, an alert, a recommendation — it is configurable.
 *      The product specification already says this about alert thresholds; the
 *      same reasoning applies to anything a farm could reasonably disagree with.
 *
 *   2. DEFAULTS ARE MARKED BY PROVENANCE. Some come from published breed
 *      standards, some are ordinary commercial judgement, and some are placeholders
 *      that a farm must replace before they mean anything. Those are different
 *      things and the interface says which is which, because a benchmark of
 *      unknown origin sitting beside a real figure is worse than no benchmark.
 *
 *   3. Shaped as the API will return it, so this becomes an endpoint later
 *      rather than a rewrite.
 */

import type { ModuleKey } from './modules';

/** Where a default came from, so the UI can be honest about it. */
export type Provenance =
  /** From a published breed management guide. Verify against your own. */
  | 'published'
  /** Ordinary commercial practice. A farm may reasonably differ. */
  | 'judgement'
  /** A placeholder. Means nothing until the farm sets it. */
  | 'placeholder';

export interface ConfigValue<T> {
  value: T;
  provenance: Provenance;
  /** Shown next to the field so nobody has to guess where a number came from. */
  note?: string;
}

/* -------------------------------------------------------------------------- */
/* Organisation                                                                */
/* -------------------------------------------------------------------------- */

export type LanguageCode = 'en' | 'ha' | 'yo' | 'ig';

export const LANGUAGES: Array<{ code: LanguageCode; label: string; english: string }> = [
  { code: 'en', label: 'English', english: 'English' },
  { code: 'ha', label: 'Hausa', english: 'Hausa' },
  { code: 'yo', label: 'Yorùbá', english: 'Yoruba' },
  { code: 'ig', label: 'Igbo', english: 'Igbo' },
];

export interface OrganisationConfig {
  name: string;
  currency: string;
  locale: string;
  timezone: string;
  /** For the office. Workers can be given a different one. */
  language: LanguageCode;
  /**
   * The pen screens specifically. The owner reads English; the person standing
   * in the house at 6am may not, and that is the screen where a
   * misunderstanding becomes bad data.
   */
  workerLanguage: LanguageCode;
  financialYearStartMonth: number;
}

/* -------------------------------------------------------------------------- */
/* Daily operations                                                            */
/* -------------------------------------------------------------------------- */

export interface OperationsConfig {
  /**
   * How many times a day eggs are collected.
   *
   * Not cosmetic. Commercial layer farms in Nigeria commonly collect three
   * times — a system that only accepts one figure a day forces the worker to
   * add up in their head, and mental arithmetic at 6pm is where egg counts go
   * wrong. One entry per collection, summed by the system.
   */
  collectionsPerDay: number;
  collectionLabels: string[];
  /** Off, optional, or required on a mortality entry. */
  mortalityPhoto: 'off' | 'optional' | 'required';
  /**
   * Offer yesterday's figures as a starting point on the daily round.
   *
   * Saves a great deal of tapping, and carries a real risk: a worker who taps
   * "same as yesterday" without looking produces plausible numbers that are
   * wrong, which is worse than no numbers. Farms that do not trust it should be
   * able to switch it off, and pre-filled values are always marked as carried
   * over rather than entered.
   */
  sameAsYesterday: boolean;
  /** Allow more than one cause on a single mortality entry. */
  multipleMortalityCauses: boolean;
  /** Require a note when a figure is unusually far from the norm. */
  explainOutliers: boolean;
}

/* -------------------------------------------------------------------------- */
/* Feed and stock                                                              */
/* -------------------------------------------------------------------------- */

export interface FeedConfig {
  /**
   * Days between placing an order and the feed arriving.
   *
   * This is what turns "you have 240kg left" into "order by Thursday", which is
   * the only version of that sentence a farmer can act on.
   */
  supplierLeadDays: number;
  /** Warn when the runway falls below this many days beyond the lead time. */
  runwayBufferDays: number;
  /** Below this many days of feed is an emergency, not a warning. */
  runwayCriticalDays: number;
  /** Consumption is averaged over this many days to work out the runway. */
  consumptionWindowDays: number;
}

/* -------------------------------------------------------------------------- */
/* Variance — the shrinkage watch                                              */
/* -------------------------------------------------------------------------- */

/**
 * Detecting what does not add up.
 *
 * Feed, eggs and birds go missing on farms. It is endemic, everybody knows it,
 * and almost no farm software addresses it because doing so needs both the
 * operational record AND a ledger that agrees with it. This product has both.
 *
 * Every tolerance is a farm's own call. Set them too tight and the system cries
 * wolf until it is ignored; too loose and it never fires. Neither failure is
 * one a vendor should choose on a farm's behalf.
 */
export interface VarianceConfig {
  enabled: boolean;
  /**
   * Flag when feed used per animal differs from the farm's own recent average
   * by more than this. Compared against the farm's history, not a book figure,
   * so it adapts to how this farm actually feeds.
   */
  feedPerHeadTolerancePct: number;
  /** Flag when production per animal falls this far below its recent average. */
  productionTolerancePct: number;
  /** Flag when a physical count differs from book stock by more than this. */
  stockCountTolerancePct: number;
  /** Flag when deaths exceed the recent average by this multiple. */
  mortalitySpikeMultiple: number;
  /** Ignore variances on populations smaller than this — the noise dominates. */
  minimumPopulation: number;
}

/* -------------------------------------------------------------------------- */
/* Breed standards — what turns a number into information                      */
/* -------------------------------------------------------------------------- */

export interface StandardPoint {
  /** Age in weeks for layers, days for broilers. Unit is on the standard. */
  age: number;
  value: number;
}

export interface BreedStandard {
  id: string;
  moduleKey: ModuleKey;
  breed: string;
  purpose: string;
  ageUnit: 'day' | 'week';
  provenance: Provenance;
  source: string;
  /** Cumulative mortality percentage by age. */
  mortality: StandardPoint[];
  /** Hen-day lay percentage by age. Layers only. */
  layRate?: StandardPoint[];
  /** Cumulative feed conversion ratio by age. Meat birds only. */
  fcr?: StandardPoint[];
  /** Live weight in grams by age. */
  weight?: StandardPoint[];
  /** Feed intake, grams per animal per day. */
  feedIntake?: StandardPoint[];
}

/**
 * Interpolate a standard at an arbitrary age.
 *
 * Standards are published at intervals; a batch is whatever age it is. Linear
 * between the two nearest points, clamped at both ends rather than
 * extrapolated — inventing a figure beyond the published range would be making
 * up the benchmark, which defeats the purpose of having one.
 */
export function standardAt(points: StandardPoint[], age: number): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.age - b.age);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (age <= first.age) return first.value;
  if (age >= last.age) return last.value;

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const lower = sorted[index]!;
    const upper = sorted[index + 1]!;
    if (age >= lower.age && age <= upper.age) {
      const span = upper.age - lower.age;
      if (span === 0) return lower.value;
      const ratio = (age - lower.age) / span;
      return lower.value + (upper.value - lower.value) * ratio;
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Alerts                                                                      */
/* -------------------------------------------------------------------------- */

export type AlertChannel = 'inApp' | 'whatsapp' | 'sms' | 'email';

export type AlertKind =
  | 'lowStock'
  | 'feedRunway'
  | 'mortalitySpike'
  | 'varianceDetected'
  | 'vaccinationDue'
  | 'paymentOverdue'
  | 'sellWindow'
  | 'dailyRoundMissing';

export interface AlertRule {
  kind: AlertKind;
  label: string;
  description: string;
  enabled: boolean;
  channels: AlertChannel[];
  /** Role codes that receive it. */
  recipients: string[];
}

/* -------------------------------------------------------------------------- */
/* Selling                                                                     */
/* -------------------------------------------------------------------------- */

export interface SalesConfig {
  defaultPaymentTermsDays: number;
  /** Allow a sale to be recorded without a customer record — a cash gate sale. */
  allowWalkIn: boolean;
  /** Warn before selling to a customer already over this balance, in kobo. */
  creditLimitKobo: string;
  /**
   * Recommend selling meat birds once the cost of another day's feed exceeds
   * the value of the weight that day would add.
   */
  sellAdviceEnabled: boolean;
  /** Current market price per kg, in kobo. Farms update this constantly. */
  marketPricePerKgKobo: string;
}

/* -------------------------------------------------------------------------- */

export interface FarmConfig {
  organisation: OrganisationConfig;
  operations: OperationsConfig;
  feed: FeedConfig;
  variance: VarianceConfig;
  alerts: AlertRule[];
  sales: SalesConfig;
  standards: BreedStandard[];
  /** Which species modules this organisation has. */
  modules: ModuleKey[];
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Published breed standards.
 *
 * These are approximate figures from the breeders' public management guides and
 * are marked `published` so the interface can say so. They are a STARTING POINT,
 * not this farm's truth: real performance varies with climate, housing, feed
 * quality and management, and Nigerian conditions differ materially from the
 * temperate conditions most guides assume. Every farm should replace these with
 * the guide for the stock they actually buy.
 *
 * They are here because a benchmark a farm can correct is far more useful than
 * no benchmark at all — but the provenance flag is why showing them is honest.
 */
const PUBLISHED_STANDARDS: BreedStandard[] = [
  {
    id: 'std-cobb500',
    moduleKey: 'poultry',
    breed: 'Cobb 500',
    purpose: 'Broiler',
    ageUnit: 'day',
    provenance: 'published',
    source: 'Cobb 500 broiler performance guide — approximate, verify against your supplier',
    mortality: [
      { age: 7, value: 0.8 },
      { age: 14, value: 1.3 },
      { age: 21, value: 1.9 },
      { age: 28, value: 2.6 },
      { age: 35, value: 3.4 },
      { age: 42, value: 4.2 },
    ],
    fcr: [
      { age: 14, value: 1.18 },
      { age: 21, value: 1.32 },
      { age: 28, value: 1.45 },
      { age: 35, value: 1.58 },
      { age: 42, value: 1.72 },
    ],
    weight: [
      { age: 7, value: 190 },
      { age: 14, value: 460 },
      { age: 21, value: 900 },
      { age: 28, value: 1450 },
      { age: 35, value: 2050 },
      { age: 42, value: 2650 },
    ],
    feedIntake: [
      { age: 7, value: 23 },
      { age: 14, value: 52 },
      { age: 21, value: 85 },
      { age: 28, value: 120 },
      { age: 35, value: 150 },
      { age: 42, value: 175 },
    ],
  },
  {
    id: 'std-isabrown',
    moduleKey: 'poultry',
    breed: 'Isa Brown',
    purpose: 'Layer',
    ageUnit: 'week',
    provenance: 'published',
    source: 'ISA Brown management guide — approximate, verify against your supplier',
    mortality: [
      { age: 18, value: 1.5 },
      { age: 30, value: 2.6 },
      { age: 40, value: 3.6 },
      { age: 52, value: 5.0 },
      { age: 72, value: 8.0 },
    ],
    layRate: [
      { age: 18, value: 10 },
      { age: 21, value: 65 },
      { age: 24, value: 90 },
      { age: 28, value: 95 },
      { age: 40, value: 91 },
      { age: 52, value: 85 },
      { age: 72, value: 72 },
    ],
    feedIntake: [
      { age: 18, value: 85 },
      { age: 24, value: 108 },
      { age: 40, value: 115 },
      { age: 72, value: 118 },
    ],
  },
  {
    id: 'std-lohmann',
    moduleKey: 'poultry',
    breed: 'Lohmann Brown',
    purpose: 'Layer',
    ageUnit: 'week',
    provenance: 'published',
    source: 'Lohmann Brown management guide — approximate, verify against your supplier',
    mortality: [
      { age: 18, value: 1.4 },
      { age: 30, value: 2.5 },
      { age: 52, value: 4.8 },
      { age: 72, value: 7.6 },
    ],
    layRate: [
      { age: 18, value: 12 },
      { age: 21, value: 70 },
      { age: 24, value: 91 },
      { age: 28, value: 94 },
      { age: 40, value: 90 },
      { age: 52, value: 84 },
      { age: 72, value: 70 },
    ],
  },
  {
    /*
     * Snails have no equivalent of a broiler management guide. Rather than
     * invent one, this is marked as a placeholder with empty curves — the
     * interface will say there is no standard rather than show a fabricated
     * one next to a real figure.
     */
    id: 'std-snail-marginata',
    moduleKey: 'snail',
    breed: 'Archachatina marginata',
    purpose: 'Breeder colony',
    ageUnit: 'week',
    provenance: 'placeholder',
    source: 'No published standard. Set from your own records once you have a year of history.',
    mortality: [],
  },
];

const DEFAULT_ALERTS: AlertRule[] = [
  {
    kind: 'feedRunway',
    label: 'Feed about to run out',
    description: 'Sent when remaining feed will not last past the supplier lead time.',
    enabled: true,
    channels: ['inApp', 'whatsapp'],
    recipients: ['FARM_MANAGER', 'MANAGING_DIRECTOR'],
  },
  {
    kind: 'lowStock',
    label: 'Stock below reorder level',
    description: 'Any item, not just feed.',
    enabled: true,
    channels: ['inApp'],
    recipients: ['FARM_MANAGER'],
  },
  {
    kind: 'mortalitySpike',
    label: 'Unusual deaths',
    description: 'Deaths well above the recent average for that population.',
    enabled: true,
    channels: ['inApp', 'whatsapp'],
    recipients: ['FARM_MANAGER', 'MANAGING_DIRECTOR'],
  },
  {
    kind: 'varianceDetected',
    label: 'Figures that do not add up',
    description: 'Feed, production or stock outside the tolerance you set.',
    enabled: true,
    channels: ['inApp', 'whatsapp'],
    recipients: ['MANAGING_DIRECTOR', 'FINANCIAL_CONTROLLER'],
  },
  {
    kind: 'vaccinationDue',
    label: 'Vaccination due',
    description: 'Ahead of the scheduled date, and again if it is missed.',
    enabled: true,
    channels: ['inApp', 'whatsapp'],
    recipients: ['FARM_MANAGER', 'PRODUCTION_SUPERVISOR'],
  },
  {
    kind: 'paymentOverdue',
    label: 'Customer owes you',
    description: 'An invoice past its due date.',
    enabled: true,
    channels: ['inApp'],
    recipients: ['FINANCE_MANAGER'],
  },
  {
    kind: 'sellWindow',
    label: 'Time to sell',
    description: 'Meat birds where another day of feed costs more than it adds.',
    enabled: true,
    channels: ['inApp', 'whatsapp'],
    recipients: ['MANAGING_DIRECTOR', 'FARM_MANAGER'],
  },
  {
    kind: 'dailyRoundMissing',
    label: 'Round not recorded',
    description: 'No daily round submitted by the time you expect it.',
    enabled: true,
    channels: ['inApp'],
    recipients: ['FARM_MANAGER'],
  },
];

export const DEFAULT_CONFIG: FarmConfig = {
  organisation: {
    name: 'Kajola Farms',
    currency: 'NGN',
    locale: 'en-NG',
    timezone: 'Africa/Lagos',
    language: 'en',
    workerLanguage: 'en',
    financialYearStartMonth: 1,
  },
  operations: {
    collectionsPerDay: 3,
    collectionLabels: ['Morning', 'Afternoon', 'Evening'],
    mortalityPhoto: 'optional',
    sameAsYesterday: true,
    multipleMortalityCauses: true,
    explainOutliers: true,
  },
  feed: {
    supplierLeadDays: 3,
    runwayBufferDays: 4,
    runwayCriticalDays: 2,
    consumptionWindowDays: 7,
  },
  variance: {
    enabled: true,
    feedPerHeadTolerancePct: 12,
    productionTolerancePct: 10,
    stockCountTolerancePct: 3,
    mortalitySpikeMultiple: 2.5,
    minimumPopulation: 200,
  },
  alerts: DEFAULT_ALERTS,
  sales: {
    defaultPaymentTermsDays: 14,
    allowWalkIn: true,
    creditLimitKobo: '50000000',
    sellAdviceEnabled: true,
    marketPricePerKgKobo: '320000',
  },
  standards: PUBLISHED_STANDARDS,
  modules: ['poultry', 'snail'],
};

/**
 * The farm's configuration.
 *
 * Reads defaults today. Becomes a call to the organisation's settings endpoint
 * once tenancy exists — one seam, not a rewrite.
 */
export async function getFarmConfig(): Promise<FarmConfig> {
  return DEFAULT_CONFIG;
}

/** The standard that applies to a population, if the farm has one. */
export function standardFor(
  config: FarmConfig,
  group: { breed: string; purpose: string },
): BreedStandard | null {
  return (
    config.standards.find(
      (standard) => standard.breed === group.breed && standard.purpose === group.purpose,
    ) ??
    config.standards.find((standard) => standard.breed === group.breed) ??
    null
  );
}
