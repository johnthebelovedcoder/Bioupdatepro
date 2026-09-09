/**
 * Type contracts for the livestock reads.
 *
 * `lib/operations.ts` reads populations from the real API — this file used to
 * generate them as fixtures. What is left is the shapes those real functions
 * (and the pages written against them) share, so a page and its data source
 * cannot quietly disagree about what a population looks like.
 *
 * Money is in KOBO, as integers, matching the API's convention.
 */

/**
 * One managed population — a poultry flock or a snail cohort.
 *
 * Deliberately species-agnostic in shape. Everything species-specific about it
 * is either a free-text value the farm supplies (breed, purpose, stage) or comes
 * from the module registry's terminology. That is what lets one register render
 * both, and what will let it render a fish stock later.
 */
export interface BatchSummary {
  id: string;
  code: string;
  species: 'POULTRY' | 'SNAIL';
  breed: string;
  purpose: string;
  house: string;
  /** Where in its lifecycle. Values come from the module's `stages`. */
  stage: string;
  population: number;
  openingPopulation: number;
  ageDays: number;
  mortalityRate: number;
  status: 'ACTIVE' | 'CLOSED';
  /** When the population was placed or stocked. */
  startedOn: string;
  source: string;
  /** Cost accumulated against this population so far, in kobo. */
  costToDateKobo: string;
  /** What it has earned so far. Zero until it produces or is sold. */
  revenueToDateKobo: string;
}

export interface GroupEvent {
  id: string;
  occurredOn: string;
  type:
    | 'PLACEMENT'
    | 'FEED'
    | 'MORTALITY'
    | 'PRODUCTION'
    | 'TREATMENT'
    | 'STAGE'
    | 'HARVEST'
    | 'VALUATION'
    | 'DISPOSAL';
  summary: string;
  detail: string;
  quantity: string | null;
  recordedBy: string;
}

export interface GroupDetail extends BatchSummary {
  /** Population on each of the last fourteen days. */
  populationSeries: Array<{ date: string; value: number }>;
  /** Deaths on each of the last fourteen days. */
  mortalitySeries: Array<{ date: string; value: number }>;
  /** The whole life, most recent first — not windowed to a recent slice. */
  events: GroupEvent[];
  costBreakdown: Array<{ label: string; kobo: string }>;
  expectedEndOn: string | null;
  /** What the last approved IAS 41 valuation says a unit is worth. Null until
   * the population has been valued at least once. */
  currentFvlctsPerUnitKobo: string | null;
  /** currentFvlctsPerUnitKobo × population — what this population would carry
   * at, right now, if valued today. Null on the same terms. */
  carryingValueKobo: string | null;
}
