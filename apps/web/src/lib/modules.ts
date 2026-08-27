import {
  IconBird,
  IconSnail,
  IconBox,
  IconChart,
  IconClipboard,
  IconEgg,
  IconFeed,
  IconCheckCircle,
  IconFarm,
  type IconProps,
} from '@/components/icons';

/**
 * The species module registry.
 *
 * Poultry and snail are not two codebases — they are two rows of configuration
 * over one set of concepts. A managed population, a place it lives, lifecycle
 * stages it passes through, feed going in, output coming out, animals dying.
 * That is true of fish, goats, pigs and rabbits too.
 *
 * What differs between them is the LANGUAGE. A poultry manager has flocks of
 * birds in houses and collects eggs; a snail farmer has cohorts of snails in
 * pens and harvests. Calling a snail cohort a "flock" in the interface would be
 * wrong in the way that makes people distrust software — and matters here
 * specifically because the client's own glossary names these terms: "Cohort"
 * for snail, "Flock" for poultry (`FARMING_GLOSSARY` rows 6 and 14 of the
 * AgriPro workbook). So every user-facing noun comes from `terms` below, and
 * no screen hard-codes "bird" or "cohort".
 *
 * Adding FishPro later is a new entry in this file plus its metric definitions.
 * It is deliberately not a new module, route tree, or set of components.
 */

export type ModuleKey =
  | 'poultry'
  | 'snail'
  | 'fish'
  | 'dairy'
  | 'pig'
  | 'goat'
  | 'rabbit';

/** A word in both its singular and plural form, so copy never guesses. */
export interface Word {
  one: string;
  many: string;
}

export interface Terminology {
  /** A managed population. Poultry: a flock. Snail: a cohort. */
  group: Word;
  /** One animal. */
  animal: Word;
  /** Where they are kept. */
  housing: Word;
  /** Lifecycle stages, earliest first. */
  stages: string[];
  /** What the operation primarily produces. */
  output: Word;
  /**
   * What a population produces where that differs by what it is kept for.
   *
   * A module has one headline output, but not every population sells it: a
   * broiler flock is not sold as eggs and a heifer is not sold as litres. Any
   * purpose absent here falls back to `output`.
   */
  outputByPurpose?: Record<string, Word>;
  /** What a day's production record is called. */
  productionRecord: string;
  /** New stock arriving. */
  intake: string;
  /** Reproduction. */
  breeding: string;
  /** Finished stock leaving. */
  offtake: string;
}

export interface ModuleMetric {
  key: string;
  label: string;
  /** Which direction is good — mortality rising is not the same as eggs rising. */
  goodWhen: 'up' | 'down' | 'neutral';
  hint?: string;
}

export interface ModuleNavItem {
  slug: string;
  label: string;
  icon: React.ComponentType<IconProps>;
  /** One line for the sidebar's hover — what you would come here for. */
  hint?: string;
}

/**
 * A number a worker types into the daily record.
 *
 * Which numbers exist is a species question — poultry counts whole, cracked and
 * dirty eggs; snails weigh a harvest. Declaring them here rather than in the
 * form is what lets one entry screen serve every module.
 */
export interface DailyField {
  key: string;
  label: string;
  /** Shown after the input. Blank for a plain count. */
  unit?: string;
  /** Steppers move by this much; sized to what a person actually records. */
  step: number;
  hint?: string;
}

/**
 * A feed item, with the populations it suits.
 *
 * Feeding a flock is a programme, not a single product: broiler starter for the
 * first three weeks, finisher after that, layer mash only once a bird is in
 * lay. Encoding that here means the daily round can offer the right feed
 * already selected, instead of making a worker pick it four times a morning and
 * eventually mis-picking it.
 *
 * Both bounds are inclusive and in days since placement. No `suits` means the
 * item is appropriate to anything in the module.
 */
export interface FeedType {
  name: string;
  /** Purposes or lifecycle stages this suits. */
  suits?: string[];
  fromDay?: number;
  toDay?: number;
}

export interface SpeciesModule {
  key: ModuleKey;
  /** Product name, as it would appear on an invoice. */
  productName: string;
  /** Short label for navigation and the switcher. */
  label: string;
  icon: React.ComponentType<IconProps>;
  /**
   * Whether this organisation has it. Hard-coded for now; this will come from
   * the organisation's subscription record once tenancy exists. It is modelled
   * here so the interface is already subscription-shaped rather than needing
   * to be retrofitted.
   */
  subscribed: boolean;
  /**
   * Which nav slug is this module's register — the list of its populations.
   * Poultry calls it "flocks", snails call it "cohorts", and the same
   * component renders both.
   */
  registerSlug: string;
  terms: Terminology;
  /**
   * Exactly four. Four sits as two even rows on a phone; three leaves a lone
   * tile stranded on the second row.
   */
  metrics: ModuleMetric[];
  nav: ModuleNavItem[];
  /** What the daily production record captures for this species. */
  productionFields: DailyField[];
  /** What a worker can attribute a death to. Species-specific by nature. */
  mortalityCauses: string[];
  /** Feed items that can be issued to this species. */
  feedTypes: FeedType[];
  /** Breeds or species the farm keeps. Suggestions, not a closed list. */
  breeds: string[];
  /** What a population is being kept for. */
  purposes: string[];
}

/**
 * The feed that suits a population right now.
 *
 * Narrowest match wins: an item naming both a purpose and an age window beats
 * one naming only a purpose, which beats a general item. Falls back to the
 * first item rather than nothing, so a population with no matching rule still
 * gets a sensible default instead of an empty select.
 */
export function defaultFeedFor(
  module: SpeciesModule,
  group: { purpose: string; stage: string; ageDays: number },
): string {
  const applies = (feed: FeedType) => {
    if (feed.suits && !feed.suits.includes(group.purpose) && !feed.suits.includes(group.stage)) {
      return false;
    }
    if (feed.fromDay !== undefined && group.ageDays < feed.fromDay) return false;
    if (feed.toDay !== undefined && group.ageDays > feed.toDay) return false;
    return true;
  };

  const score = (feed: FeedType) =>
    (feed.suits ? 2 : 0) + (feed.fromDay !== undefined || feed.toDay !== undefined ? 1 : 0);

  const matches = module.feedTypes.filter(applies).sort((a, b) => score(b) - score(a));
  return matches[0]?.name ?? module.feedTypes[0]?.name ?? '';
}

/* -------------------------------------------------------------------------- */

const POULTRY: SpeciesModule = {
  key: 'poultry',
  productName: 'PoultryPro',
  label: 'Poultry',
  icon: IconBird,
  subscribed: true,
  registerSlug: 'flocks',
  terms: {
    group: { one: 'flock', many: 'flocks' },
    animal: { one: 'bird', many: 'birds' },
    housing: { one: 'house', many: 'houses' },
    /*
     * The spec's own lifecycle forks after Grower — a meat bird moves to
     * Market-ready, an egg bird moves to Pullet, Point-of-lay, then Layer —
     * and `stages` cannot express a fork, only a sequence. Two things fixed
     * here rather than one: "Pullet" was missing entirely (present only in
     * `purposes`, so a pullet never got a stage of its own), and "Spent" was
     * never a term the spec used — end-of-lay is an EXIT from Layer (a cull
     * or a sale), not a further stage, the same way a snail's Grower exits to
     * Breeder or Market-ready without a stage after either. `nextStage()`'s
     * naive "the one after this" will sometimes suggest the wrong branch (a
     * broiler at Grower gets offered Market-ready correctly; a pullet at
     * Grower would too, and has to be corrected in the dropdown) — accepted
     * for the same reason it already is on the snail side: every real stage
     * name is reachable and correct once picked, a single wrong default
     * suggestion is a smaller cost than a second data model for branching
     * lifecycles.
     */
    stages: ['Chick', 'Grower', 'Market-ready', 'Pullet', 'Point-of-lay', 'Layer'],
    output: { one: 'egg', many: 'eggs' },
    outputByPurpose: {
      Broiler: { one: 'bird', many: 'meat birds' },
      Cockerel: { one: 'bird', many: 'meat birds' },
      Pullet: { one: 'bird', many: 'birds' },
    },
    productionRecord: 'Egg collection',
    intake: 'Placement',
    breeding: 'Hatching',
    offtake: 'Sale & culling',
  },
  metrics: [
    { key: 'population', label: 'Live birds', goodWhen: 'neutral', hint: 'across all flocks' },
    { key: 'eggs', label: 'Eggs today', goodWhen: 'up', hint: 'vs yesterday' },
    { key: 'mortality', label: 'Mortality rate', goodWhen: 'down', hint: '30-day rolling' },
    { key: 'feed', label: 'Feed used today', goodWhen: 'neutral', hint: 'all flocks' },
  ],
  nav: [
    { slug: 'flocks', label: 'Flocks', icon: IconClipboard, hint: 'Every flock, its stage and how many birds' },
    { slug: 'records', label: 'Daily round', icon: IconFarm, hint: 'Eggs, feed and mortality — one entry per flock' },
    { slug: 'production', label: 'Eggs', icon: IconEgg, hint: 'What has been collected, whole, cracked and dirty' },
    { slug: 'feeding', label: 'Feeding', icon: IconFeed, hint: 'What has gone out, and what it cost' },
    { slug: 'health', label: 'Health', icon: IconCheckCircle, hint: 'Treatments and mortality, by cause' },
    {
      slug: 'performance',
      label: 'How they are doing',
      icon: IconChart,
      hint: 'Lay rate and mortality against the breed standard',
    },
  ],
  productionFields: [
    { key: 'whole', label: 'Whole eggs', step: 10, hint: 'Saleable' },
    { key: 'cracked', label: 'Cracked', step: 1 },
    { key: 'dirty', label: 'Dirty', step: 1 },
  ],
  mortalityCauses: [
    'Heat stress',
    'Disease',
    'Predation',
    'Injury',
    'Culled',
    'Unknown',
  ],
  feedTypes: [
    // A broiler's feed changes with its age, which is why the age window
    // matters and a purpose alone is not enough.
    { name: 'Broiler starter', suits: ['Broiler'], toDay: 21 },
    { name: 'Broiler finisher', suits: ['Broiler'], fromDay: 22 },
    { name: 'Chick mash', suits: ['Chick'], toDay: 42 },
    { name: 'Grower mash', suits: ['Pullet', 'Grower'] },
    { name: 'Layer mash', suits: ['Layer', 'Point-of-lay'] },
  ],
  breeds: ['ISA Brown', 'Lohmann Brown', 'Cobb 500', 'Ross 308', 'Noiler', 'Local breed'],
  purposes: ['Layer', 'Broiler', 'Pullet', 'Cockerel', 'Breeder'],
};

const SNAIL: SpeciesModule = {
  key: 'snail',
  productName: 'SnailPro',
  label: 'Snails',
  icon: IconSnail,
  subscribed: true,
  registerSlug: 'cohorts',
  terms: {
    group: { one: 'cohort', many: 'cohorts' },
    animal: { one: 'snail', many: 'snails' },
    housing: { one: 'pen', many: 'pens' },
    /*
     * Market-ready added: the spec's own age tracker treats it and Breeder as
     * parallel outcomes of Grower, not a further stage after it, and names an
     * account for it (130204) that has sat unmapped since the accounting pass
     * — see the comment on `SNAIL_STAGE_ACCOUNTS` in
     * `packages/database/src/seed-biological-assets.ts`. This does not change
     * the existing decision that a harvest can still happen directly out of
     * Grower without a stage transition first — it makes the classification
     * reachable and correctly posted for a farm that does record it, without
     * requiring every farm to.
     */
    stages: ['Egg', 'Hatchling', 'Juvenile', 'Grower', 'Market-ready', 'Breeder'],
    output: { one: 'harvest', many: 'harvests' },
    productionRecord: 'Harvest record',
    intake: 'Stocking',
    breeding: 'Breeding cycle',
    offtake: 'Harvest',
  },
  metrics: [
    { key: 'population', label: 'Live snails', goodWhen: 'neutral', hint: 'across all cohorts' },
    { key: 'hatchRate', label: 'Hatch rate', goodWhen: 'up', hint: 'last completed cycle' },
    { key: 'mortality', label: 'Mortality rate', goodWhen: 'down', hint: '30-day rolling' },
    { key: 'feed', label: 'Feed used today', goodWhen: 'neutral', hint: 'all cohorts' },
  ],
  nav: [
    { slug: 'cohorts', label: 'Cohorts', icon: IconClipboard, hint: 'Every cohort, its stage and how many snails' },
    { slug: 'records', label: 'Daily round', icon: IconFarm, hint: 'Feed and mortality — one entry per cohort' },
    { slug: 'breeding', label: 'Breeding', icon: IconEgg, hint: 'Breeder colonies, clutches and hatch rate' },
    { slug: 'growth', label: 'Growth', icon: IconChart, hint: 'Population by lifecycle stage' },
    { slug: 'feeding', label: 'Feeding', icon: IconFeed, hint: 'What has gone out, and what it cost' },
    { slug: 'harvest', label: 'Harvest', icon: IconBox, hint: 'What has been picked, and its grade' },
  ],
  productionFields: [
    { key: 'harvestKg', label: 'Harvested', unit: 'kg', step: 1, hint: 'Table size' },
    { key: 'harvestCount', label: 'Snails harvested', step: 10 },
    { key: 'eggsLaid', label: 'Egg clutches found', step: 1 },
  ],
  mortalityCauses: [
    'Desiccation',
    'Disease',
    'Predation',
    'Overcrowding',
    'Escaped',
    'Unknown',
  ],
  feedTypes: [
    { name: 'Snail feed concentrate' },
    { name: 'Pawpaw leaves' },
    { name: 'Cabbage' },
    /*
     * Deliberately carries no `suits`, despite being what a breeder colony
     * needs most. Calcium is given IN ADDITION to feed, for shell and egg
     * formation — not instead of it. Matching it to breeders would make it the
     * default selection on those pens, and a worker accepting the default would
     * record a supplement issue where they meant a feed issue. The result is
     * feed consumption that reads far too low on exactly the colonies that eat
     * the most.
     */
    { name: 'Calcium supplement' },
  ],
  breeds: ['Archachatina marginata', 'Achatina achatina', 'Lissachatina fulica'],
  purposes: ['Breeder cohort', 'Growers', 'Juveniles'],
};

/*
 * Not subscribed. Present so the extension path is demonstrably real — each is
 * a complete entry, not a placeholder name — and so the switcher can offer
 * them. None is reachable until the organisation subscribes.
 */

const FISH: SpeciesModule = {
  key: 'fish',
  productName: 'FishPro',
  label: 'Fish',
  icon: IconFarm,
  subscribed: false,
  registerSlug: 'stocks',
  terms: {
    group: { one: 'stock', many: 'stocks' },
    animal: { one: 'fish', many: 'fish' },
    housing: { one: 'pond', many: 'ponds' },
    stages: ['Fry', 'Fingerling', 'Juvenile', 'Grow-out', 'Table size'],
    output: { one: 'harvest', many: 'harvests' },
    productionRecord: 'Harvest record',
    intake: 'Stocking',
    breeding: 'Spawning',
    offtake: 'Harvest',
  },
  metrics: [
    { key: 'population', label: 'Fish stocked', goodWhen: 'neutral' },
    { key: 'biomass', label: 'Estimated biomass', goodWhen: 'up' },
    { key: 'mortality', label: 'Mortality rate', goodWhen: 'down' },
    { key: 'feed', label: 'Feed used today', goodWhen: 'neutral' },
  ],
  nav: [],
  productionFields: [
    { key: 'harvestKg', label: 'Harvested', unit: 'kg', step: 5 },
    { key: 'sampleWeight', label: 'Sample weight', unit: 'g', step: 10 },
  ],
  mortalityCauses: ['Disease', 'Water quality', 'Predation', 'Handling', 'Unknown'],
  feedTypes: [{ name: 'Floating pellets' }, { name: 'Sinking pellets' }, { name: 'Starter crumble' }],
  breeds: ['Catfish (Clarias)', 'Tilapia'],
  purposes: ['Grow-out', 'Broodstock', 'Fingerling'],
};

const DAIRY: SpeciesModule = {
  key: 'dairy',
  productName: 'DairyPro',
  label: 'Dairy',
  icon: IconFarm,
  subscribed: false,
  registerSlug: 'herds',
  terms: {
    group: { one: 'herd', many: 'herds' },
    animal: { one: 'cow', many: 'cattle' },
    housing: { one: 'shed', many: 'sheds' },
    stages: ['Calf', 'Heifer', 'In milk', 'Dry', 'Cull'],
    output: { one: 'litre', many: 'litres' },
    outputByPurpose: {
      Dry: { one: 'animal', many: 'animals' },
      Heifer: { one: 'animal', many: 'animals' },
    },
    productionRecord: 'Milking record',
    intake: 'Acquisition',
    breeding: 'Calving',
    offtake: 'Sale & culling',
  },
  metrics: [
    { key: 'population', label: 'Milking herd', goodWhen: 'neutral' },
    { key: 'yield', label: 'Yield today', goodWhen: 'up' },
    { key: 'mortality', label: 'Mortality rate', goodWhen: 'down' },
    { key: 'feed', label: 'Feed used today', goodWhen: 'neutral' },
  ],
  nav: [],
  productionFields: [
    { key: 'litres', label: 'Milk collected', unit: 'L', step: 5 },
    { key: 'rejected', label: 'Rejected', unit: 'L', step: 1 },
  ],
  mortalityCauses: ['Disease', 'Calving complication', 'Injury', 'Culled', 'Unknown'],
  feedTypes: [{ name: 'Dairy meal' }, { name: 'Silage' }, { name: 'Hay' }, { name: 'Mineral lick' }],
  breeds: ['Friesian', 'Jersey', 'White Fulani'],
  purposes: ['Milking', 'Dry', 'Heifer'],
};

const PIG: SpeciesModule = {
  key: 'pig',
  productName: 'PigPro',
  label: 'Pigs',
  icon: IconFarm,
  subscribed: false,
  registerSlug: 'batches',
  terms: {
    group: { one: 'batch', many: 'batches' },
    animal: { one: 'pig', many: 'pigs' },
    housing: { one: 'pen', many: 'pens' },
    stages: ['Piglet', 'Weaner', 'Grower', 'Finisher', 'Sow'],
    output: { one: 'carcass', many: 'carcasses' },
    productionRecord: 'Weight record',
    intake: 'Placement',
    breeding: 'Farrowing',
    offtake: 'Sale',
  },
  metrics: [
    { key: 'population', label: 'Live pigs', goodWhen: 'neutral' },
    { key: 'weight', label: 'Average weight', goodWhen: 'up' },
    { key: 'mortality', label: 'Mortality rate', goodWhen: 'down' },
    { key: 'feed', label: 'Feed used today', goodWhen: 'neutral' },
  ],
  nav: [],
  productionFields: [
    { key: 'sampleWeight', label: 'Sample weight', unit: 'kg', step: 1 },
  ],
  mortalityCauses: ['Disease', 'Farrowing loss', 'Injury', 'Culled', 'Unknown'],
  feedTypes: [{ name: 'Creep feed' }, { name: 'Grower mash' }, { name: 'Sow feed' }],
  breeds: ['Large White', 'Landrace', 'Duroc'],
  purposes: ['Fattening', 'Breeding sow', 'Weaner'],
};

const GOAT: SpeciesModule = {
  key: 'goat',
  productName: 'GoatPro',
  label: 'Goats',
  icon: IconFarm,
  subscribed: false,
  registerSlug: 'flocks',
  terms: {
    group: { one: 'flock', many: 'flocks' },
    animal: { one: 'goat', many: 'goats' },
    housing: { one: 'pen', many: 'pens' },
    stages: ['Kid', 'Weaner', 'Grower', 'Breeding doe', 'Cull'],
    output: { one: 'carcass', many: 'carcasses' },
    productionRecord: 'Weight record',
    intake: 'Acquisition',
    breeding: 'Kidding',
    offtake: 'Sale',
  },
  metrics: [
    { key: 'population', label: 'Live goats', goodWhen: 'neutral' },
    { key: 'weight', label: 'Average weight', goodWhen: 'up' },
    { key: 'mortality', label: 'Mortality rate', goodWhen: 'down' },
    { key: 'feed', label: 'Feed used today', goodWhen: 'neutral' },
  ],
  nav: [],
  productionFields: [
    { key: 'sampleWeight', label: 'Sample weight', unit: 'kg', step: 1 },
  ],
  mortalityCauses: ['Disease', 'Kidding complication', 'Predation', 'Culled', 'Unknown'],
  feedTypes: [{ name: 'Concentrate' }, { name: 'Browse' }, { name: 'Hay' }, { name: 'Mineral lick' }],
  breeds: ['West African Dwarf', 'Red Sokoto', 'Kalahari'],
  purposes: ['Meat', 'Breeding', 'Weaner'],
};

const RABBIT: SpeciesModule = {
  key: 'rabbit',
  productName: 'RabbitPro',
  label: 'Rabbits',
  icon: IconFarm,
  subscribed: false,
  registerSlug: 'colonies',
  terms: {
    group: { one: 'colony', many: 'colonies' },
    animal: { one: 'rabbit', many: 'rabbits' },
    housing: { one: 'hutch', many: 'hutches' },
    stages: ['Kit', 'Weaner', 'Grower', 'Breeding doe', 'Cull'],
    output: { one: 'carcass', many: 'carcasses' },
    productionRecord: 'Weight record',
    intake: 'Stocking',
    breeding: 'Kindling',
    offtake: 'Sale',
  },
  metrics: [
    { key: 'population', label: 'Live rabbits', goodWhen: 'neutral' },
    { key: 'litters', label: 'Litters this month', goodWhen: 'up' },
    { key: 'mortality', label: 'Mortality rate', goodWhen: 'down' },
    { key: 'feed', label: 'Feed used today', goodWhen: 'neutral' },
  ],
  nav: [],
  productionFields: [
    { key: 'sampleWeight', label: 'Sample weight', unit: 'g', step: 50 },
  ],
  mortalityCauses: ['Disease', 'Kindling loss', 'Heat stress', 'Culled', 'Unknown'],
  feedTypes: [{ name: 'Rabbit pellets' }, { name: 'Forage' }, { name: 'Hay' }],
  breeds: ['New Zealand White', 'Chinchilla', 'Californian'],
  purposes: ['Meat', 'Breeding', 'Weaner'],
};

export const MODULES: SpeciesModule[] = [POULTRY, SNAIL, FISH, DAIRY, PIG, GOAT, RABBIT];

export const DEFAULT_MODULE: ModuleKey = 'poultry';

export function getModule(key: string | undefined | null): SpeciesModule | null {
  return MODULES.find((module) => module.key === key) ?? null;
}

/**
 * The modules this farm actually has.
 *
 * `enabled` comes from the farm's own configuration. Without it this fell back
 * to a boolean compiled into the registry, which meant a farm keeping only
 * snails was shown PoultryPro in its sidebar, its alerts and its dashboard with
 * no way to turn it off — the subscription was a fact about the source code
 * rather than about the customer.
 *
 * The `subscribed` flag on each module is still honoured as the outer bound:
 * it marks what the product actually implements, so configuration cannot switch
 * on a module that has no screens behind it.
 */
export function subscribedModules(enabled?: readonly ModuleKey[]): SpeciesModule[] {
  const available = MODULES.filter((module) => module.subscribed);
  if (!enabled || enabled.length === 0) return available;
  return available.filter((module) => enabled.includes(module.key));
}

/** Capitalised for use at the start of a sentence or as a heading. */
export function title(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
