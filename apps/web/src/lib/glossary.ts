/**
 * The farm and accounting vocabulary, in plain words — the client's
 * FARMING_GLOSSARY and BIO_TERMINOLOGY_SCREEN_MAP (workbook v8.9.8), each term
 * tied to where it appears in this application and what the application
 * holds it to.
 *
 * `rule` states only what the application actually enforces; a term the
 * application does not yet record on its own says so in `rule` rather than
 * borrowing the workbook's control. `where` is null when there is no one
 * screen for it.
 */
export type GlossaryGroup = 'Both' | 'Snails' | 'Poultry' | 'Accounting';

export interface GlossaryEntry {
  term: string;
  group: GlossaryGroup;
  meaning: string;
  rule: string;
  where: { label: string; href: string } | null;
}

const flocks = { label: 'Poultry → Flocks', href: '/m/poultry/flocks' };
const cohorts = { label: 'Snails → Cohorts', href: '/m/snail/cohorts' };
const round = { label: 'Daily round', href: '/m/poultry/records' };
const breeds = { label: 'Admin → Breeds', href: '/admin/breeds' };

export const GLOSSARY: GlossaryEntry[] = [
  // --- Both species ---------------------------------------------------------
  {
    term: 'Batch (cohort or flock)',
    group: 'Both',
    meaning: 'Animals kept and accounted for together: a cohort of snails or a flock of birds, placed at the same time, of the same kind, in the same house. Its code identifies it everywhere — rounds, sales, processing and the ledger.',
    rule: 'A code is used once per company. Opening number, plus what came in, less deaths, sales and harvests, is what is alive — and it can never go below nothing.',
    where: flocks,
  },
  {
    term: 'Placement',
    group: 'Both',
    meaning: 'Putting animals into a house to start a batch — bought-in chicks or snails, or hatchlings from your own breeding.',
    rule: 'A house cannot take more than its capacity; the screen says how many would fit.',
    where: { label: 'Houses', href: '/pens' },
  },
  {
    term: 'Source',
    group: 'Both',
    meaning: 'Where the animals came from: the hatchery or seller, or your own breeding.',
    rule: 'Recorded on placement. Hatchlings from your own breeding cycle are placed from that cycle.',
    where: flocks,
  },
  {
    term: 'Acquisition date and cost',
    group: 'Both',
    meaning: 'The day the animals became the farm’s, and what they cost with transport. Distinct from when they hatched.',
    rule: 'The cost goes onto the books as a biological asset, against goods received not invoiced, the moment the batch is placed.',
    where: flocks,
  },
  {
    term: 'Hatch date and age basis',
    group: 'Both',
    meaning: 'When the animals hatched — exact if you saw it, estimated for bought-in stock. Age is counted from it (from placement when there is none).',
    rule: 'The screen shows whether the age is exact or estimated.',
    where: flocks,
  },
  {
    term: 'Age',
    group: 'Both',
    meaning: 'Days, weeks or months since hatch — to today for a live batch, to its closing date for one that is finished.',
    rule: 'Worked out, never typed. A closed batch stops ageing on the day it closed.',
    where: flocks,
  },
  {
    term: 'Stage',
    group: 'Both',
    meaning: 'Where the animals are in life: chick, grower, layer… or hatchling, juvenile, market-ready. The stage recorded is the one a supervisor moved them to.',
    rule: 'A move to a stage the batch is too young for, by its breed’s ages, is refused with the age it has and the age the stage needs.',
    where: flocks,
  },
  {
    term: 'Suggested stage',
    group: 'Both',
    meaning: 'The stage the batch’s age says it should have reached, from its breed’s stage ages.',
    rule: 'Shown beside the recorded stage; nothing moves until someone moves it.',
    where: breeds,
  },
  {
    term: 'Species and breed',
    group: 'Both',
    meaning: 'What the animals are: the snail species (e.g. Archachatina marginata) or the poultry breed or strain (e.g. Ross 308), with the ages its stages start at, its target weights and its feed per head.',
    rule: 'Set up once per farm; placement suggests the breeds set up. The workbook’s approved species list is not preloaded yet.',
    where: breeds,
  },
  {
    term: 'Production type',
    group: 'Poultry',
    meaning: 'What a flock is kept for: meat (broilers), eggs (layers) or hatching eggs (breeders).',
    rule: 'Recorded as the flock’s purpose on placement.',
    where: flocks,
  },
  {
    term: 'Current number',
    group: 'Both',
    meaning: 'How many are alive now: placed, plus transfers in and hatchings, less deaths, transfers out, sales and harvests.',
    rule: 'Built from the events, never typed. No death, sale or harvest may take more than are there.',
    where: flocks,
  },
  {
    term: 'Mortality',
    group: 'Both',
    meaning: 'Animals that died, recorded on the daily round with the cause and what was done with them. The mortality rate is deaths as a share of the number placed.',
    rule: 'A death record is history: it is not edited. Deaths above 2% of the batch in a day are abnormal and go for approval before they post.',
    where: round,
  },
  {
    term: 'Cause of death',
    group: 'Both',
    meaning: 'Why they died — disease, heat, predator, handling, unknown — chosen on the round.',
    rule: 'Picked on the round, more than one if need be; the health page breaks mortality down by it.',
    where: { label: 'Poultry → Health', href: '/m/poultry/health' },
  },
  {
    term: 'Normal and abnormal loss',
    group: 'Both',
    meaning: 'Normal loss is the expected, unavoidable part — a few deaths a day, the weight lost in processing within the recipe’s yield. Abnormal loss is beyond that and is investigated.',
    rule: 'Deaths are written off at the batch’s carrying value as they are recorded; above 2% in a day they are abnormal and wait for approval. In processing, loss within the recipe’s yield stays in the product’s cost; beyond it is abnormal and written off.',
    where: { label: 'Losses', href: '/finance/losses' },
  },
  {
    term: 'Weighing',
    group: 'Both',
    meaning: 'A sample weighed on a date: how many, what they weighed together, and so the average weight.',
    rule: 'A weighing is history — never changed or deleted. It counts once someone other than who took it approves it.',
    where: flocks,
  },
  {
    term: 'Current weight',
    group: 'Both',
    meaning: 'The latest approved weighing — the one the batch’s figures use.',
    rule: 'Exactly one weighing is current: the latest approved.',
    where: flocks,
  },
  {
    term: 'Biomass',
    group: 'Both',
    meaning: 'The total live weight of a batch: how many are alive × their current average weight.',
    rule: 'Worked out from the current number and the current weight.',
    where: flocks,
  },
  {
    term: 'Closing date',
    group: 'Both',
    meaning: 'The day a batch was finished — all sold, processed, moved or written off.',
    rule: 'A batch with animals left cannot be closed unless they are written off.',
    where: flocks,
  },
  {
    term: 'Farm, house and pen',
    group: 'Both',
    meaning: 'Where the animals are kept. A house (or pen, or snailery) has a capacity.',
    rule: 'Capacity cannot be set below what the house holds now.',
    where: { label: 'Houses', href: '/pens' },
  },
  {
    term: 'Parent batch',
    group: 'Both',
    meaning: 'The breeders a batch was hatched from.',
    rule: 'Kept through the breeding cycle and hatch, and followed by traceability back from any sale.',
    where: { label: 'Traceability', href: '/inventory/trace' },
  },
  {
    term: 'Responsible supervisor',
    group: 'Both',
    meaning: 'The person accountable for a batch’s records and approvals.',
    rule: 'Not recorded on the batch yet; who recorded and who approved each event is.',
    where: null,
  },
  // --- Snails ---------------------------------------------------------------
  {
    term: 'Hatch rate',
    group: 'Snails',
    meaning: 'Snails hatched as a share of the eggs set.',
    rule: 'A hatch must account for every egg set — hatched or not — so it can never exceed 100%.',
    where: { label: 'Snails → Breeding', href: '/m/snail/breeding' },
  },
  {
    term: 'Market-ready',
    group: 'Snails',
    meaning: 'Snails of the age, weight and shell to sell or process.',
    rule: 'A stage like any other: moved into by a supervisor, and refused if the cohort is too young.',
    where: cohorts,
  },
  {
    term: 'Processing yield',
    group: 'Both',
    meaning: 'What came out of processing as a share of what went in — meat (or dressed birds) and by-products, by weight.',
    rule: 'What goes in must equal what comes out plus the loss; a processing order will not close while anything is left in work in progress.',
    where: { label: 'Production', href: '/production' },
  },
  // --- Poultry --------------------------------------------------------------
  {
    term: 'FCR',
    group: 'Poultry',
    meaning: 'Feed conversion ratio — kilograms of feed for each kilogram of weight gained. Lower is better.',
    rule: 'Feed issued ÷ live-weight gain between the first and the current approved weighings.',
    where: { label: 'KPIs', href: '/ledger/kpis' },
  },
  {
    term: 'Hen-day',
    group: 'Poultry',
    meaning: 'Eggs laid as a share of the hens alive that day.',
    rule: 'Counted against the hens alive each day, not the number placed.',
    where: { label: 'KPIs', href: '/ledger/kpis' },
  },
  {
    term: 'Dressed yield',
    group: 'Poultry',
    meaning: 'Dressed carcass weight as a share of the live weight processed.',
    rule: 'The plant records what arrived, dead on arrival and condemned before processing is costed.',
    where: { label: 'Production', href: '/production' },
  },
  {
    term: 'Condemnation',
    group: 'Poultry',
    meaning: 'Birds rejected by the vet or inspector at the processing plant.',
    rule: 'A condemnation needs its reason and who inspected; it is abnormal loss.',
    where: { label: 'Production', href: '/production' },
  },
  {
    term: 'Cull',
    group: 'Poultry',
    meaning: 'A bird taken out of production for health, performance or welfare.',
    rule: 'Recorded as a disposal with the reason; its carrying value leaves the books.',
    where: null,
  },
  {
    term: 'Withdrawal period',
    group: 'Both',
    meaning: 'After some treatments, eggs or meat cannot be sold for a number of days, taken from the product label.',
    rule: 'Birds and table eggs cannot leave for food until it has run.',
    where: { label: 'Poultry → Health', href: '/m/poultry/health' },
  },
  // --- Accounting -----------------------------------------------------------
  {
    term: 'Biological asset',
    group: 'Accounting',
    meaning: 'Living animals the farm owns, on the balance sheet at cost until valued, then at fair value less costs to sell (IAS 41).',
    rule: 'The animals counted and the ledger must reconcile: opening, plus rearing cost, less deaths and sales, plus fair-value gains, is what is held.',
    where: { label: 'Biological assets', href: '/agripro/biological-assets' },
  },
  {
    term: 'Fair-value gain',
    group: 'Accounting',
    meaning: 'The increase in what the animals are worth, from a valuation at the market price less costs to sell.',
    rule: 'A valuation needs its evidence and an approver before it posts.',
    where: { label: 'Valuations', href: '/agripro/valuations' },
  },
  {
    term: 'Work in progress (WIP)',
    group: 'Accounting',
    meaning: 'Cost gathered on a processing or feed-mill order that is not finished yet.',
    rule: 'Must be exactly zero before the order closes.',
    where: { label: 'Production', href: '/production' },
  },
  {
    term: 'Standard cost',
    group: 'Accounting',
    meaning: 'The approved expected cost of making something — the one basis for WIP, finished goods and cost of sales.',
    rule: 'Prepared by one person and released by another; locked for the year at the first posting.',
    where: { label: 'Standard costs', href: '/production/standard-costs' },
  },
  {
    term: 'Variance',
    group: 'Accounting',
    meaning: 'The difference between what production actually cost and its standard.',
    rule: 'Always shown; one beyond the year’s tolerance settles only with a reason.',
    where: { label: 'Standard costs', href: '/production/standard-costs' },
  },
  {
    term: 'Recovery',
    group: 'Accounting',
    meaning: 'The credit made when standard conversion cost is charged into WIP, cleared when the order settles against what was actually spent.',
    rule: 'Must clear to zero at settlement; what is left is the variance.',
    where: { label: 'Cost pools', href: '/production/cost-pools' },
  },
  {
    term: 'Joint cost',
    group: 'Accounting',
    meaning: 'Cost shared by products made together — meat and shell, dressed birds and offal — split by their sales value.',
    rule: 'Split only from approved prices, by the one released method.',
    where: { label: 'Joint cost', href: '/production/joint-cost' },
  },
  {
    term: 'Genealogy',
    group: 'Accounting',
    meaning: 'The trail from a sale back to the harvest, the batch, its breeders, the feed and packaging, and their receipts.',
    rule: 'Every step carries its document, so the trail runs both ways.',
    where: { label: 'Traceability', href: '/inventory/trace' },
  },
];
