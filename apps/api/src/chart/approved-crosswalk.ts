import { Species } from './chart';

/**
 * Where each old account's balance goes on the approved five-digit chart.
 *
 * The source is docs/approved-coa-crosswalk-review.csv (the six-digit chart's
 * 68 accounts, a Finance-unapproved recommendation) and chart.ts's role map
 * (the four-digit chart's accounts). Where the app already posts a purpose to
 * one approved account, the balance goes there, so what was posted before and
 * what is posted after sit together. Where the crosswalk offers several, the
 * rule says how the choice is made — by the item, the cohort's stage, the sign
 * of the balance — or names the default and the alternatives a person may
 * choose instead (`overrides` on the cutover).
 *
 * Nothing here moves money: ApprovedCutoverService reads it, shows the result
 * in a preview, and refuses to run without Finance's sign-off.
 */

export type ProductClass = 'LIVE_POULTRY' | 'EGGS' | 'PROCESSED_POULTRY' | 'LIVE_SNAIL' | 'PROCESSED_SNAIL' | 'GENERAL';

/** What a sold or stocked item is, and the approved accounts that follow from it. */
export const APPROVED_PRODUCT_CLASSES: Record<ProductClass, { label: string; revenue: string; costOfSales: string; inventory: string }> = {
  LIVE_POULTRY: { label: 'Live birds', revenue: '40310', costOfSales: '50310', inventory: '12420' },
  EGGS: { label: 'Eggs', revenue: '40330', costOfSales: '50330', inventory: '12420' },
  PROCESSED_POULTRY: { label: 'Processed poultry', revenue: '40320', costOfSales: '50320', inventory: '12420' },
  LIVE_SNAIL: { label: 'Live snails', revenue: '40210', costOfSales: '50210', inventory: '12410' },
  PROCESSED_SNAIL: { label: 'Processed snail products', revenue: '40220', costOfSales: '50220', inventory: '12410' },
  // Anything sold that is not one of the farm's own products (a vaccine, packaging): the workbook's default accounts.
  GENERAL: { label: 'Other goods (general)', revenue: '40000', costOfSales: '50000', inventory: '12400' },
};

/** Raw material, feed, packaging or consumable: the four approved inventory controls. */
export type StockClass = 'RAW' | 'FEED' | 'PACKAGING' | 'CONSUMABLE';
export const APPROVED_STOCK_ACCOUNTS: Record<StockClass, string> = {
  RAW: '12000',
  FEED: '12100',
  PACKAGING: '12200',
  CONSUMABLE: '12300',
};

export type CrosswalkRule =
  /** One account, no judgement. */
  | { kind: 'one'; to: string }
  /** The crosswalk offers several; this is the default and the rest may be chosen. Always shown as an assumption. */
  | { kind: 'pick'; to: string; alternatives: string[]; why: string }
  /** 12000 / 12100 / 12200 / 12300 by what the item is. */
  | { kind: 'stock' }
  /** By what the item is: its inventory, revenue or cost-of-sales account. */
  | { kind: 'product'; part: 'inventory' | 'revenue' | 'costOfSales' }
  /** Poultry: the cohort's stage decides 16032 or 16042. Snail cost in the old rearing account is expensed. */
  | { kind: 'rearing'; speciesKnown?: Species }
  /** Credit balance to the gain, debit to the loss. */
  | { kind: 'fairValue' }
  /** The species of the pen or farm decides the biological loss account. */
  | { kind: 'productionLoss' }
  /** Snail biological asset account: immature or mature by the stage the account holds. */
  | { kind: 'snailAsset' }
  /** No approved account exists; the cutover refuses while the account holds a balance. */
  | { kind: 'blocked'; why: string };

const one = (to: string): CrosswalkRule => ({ kind: 'one', to });
const pick = (to: string, alternatives: string[], why: string): CrosswalkRule => ({ kind: 'pick', to, alternatives, why });

/** Every source account the cutover can move, keyed by its number on the four- or six-digit chart. */
export const CROSSWALK: Record<string, CrosswalkRule> = {
  // ---- Four-digit chart ----------------------------------------------------
  '1101': one('10100'),
  '1201': one('11000'),
  '1301': { kind: 'stock' },
  '1302': one('12200'),
  '1305': { kind: 'product', part: 'inventory' },
  '1401': { kind: 'product', part: 'inventory' },
  '1402': { kind: 'blocked', why: 'Finished-goods capitalised variance has no approved account: Finance must choose one (docs/target-coa-role-crosswalk.md).' },
  '1403': { kind: 'blocked', why: 'WIP capitalised variance has no approved account: Finance must choose one (docs/target-coa-role-crosswalk.md).' },
  '1501': { kind: 'rearing' },
  '1601': one('11300'),
  '1602': one('11400'),
  '1701': pick('15200', ['15100', '15200', '15300', '15400'], 'asset class is not recorded on the balance'),
  '1702': pick('15600', ['15500', '15600', '15700'], 'asset class is not recorded on the balance'),
  '2101': one('20700'),
  '2102': one('20700'),
  '2103': one('20700'),
  '2104': one('20200'),
  '2105': one('20200'),
  '2110': one('20600'),
  '2120': one('20400'),
  '2130': one('20500'),
  '2140': one('20300'),
  '2201': one('20100'),
  '3200': one('30200'),
  '4101': { kind: 'product', part: 'revenue' },
  '5001': { kind: 'product', part: 'costOfSales' },
  '5101': one('52000'),
  '5102': one('52000'),
  '5103': one('52000'),
  '5104': one('52000'),
  '5205': { kind: 'blocked', why: 'Payroll/Overhead Clearing has no place on the approved chart: clear it first.' },
  '5305': { kind: 'productionLoss' },
  '5401': one('56000'),
  '5501': one('52400'),
  '5502': { kind: 'blocked', why: 'Impairment loss has no approved account: Finance must choose one (docs/target-coa-role-crosswalk.md).' },

  // ---- Six-digit chart (docs/approved-coa-crosswalk-review.csv) -------------
  '110100': one('10100'),
  '120100': one('11000'),
  '125100': one('11300'),
  '125200': one('11400'),
  '130100': { kind: 'stock' },
  '130110': one('12100'),
  '130199': one('12500'),
  '130200': { kind: 'snailAsset' },
  '130201': { kind: 'snailAsset' },
  '130202': { kind: 'snailAsset' },
  '130203': { kind: 'snailAsset' },
  '130204': { kind: 'snailAsset' },
  '130210': { kind: 'rearing', speciesKnown: 'poultry' },
  // The app keeps eggs in 12420 and eggs in incubation in 13020 on the approved chart
  // (eggAccountsFor); the crosswalk recommends 16031/16032/12400 — Finance to confirm.
  '130215': one('12420'),
  '130216': one('13020'),
  '130400': one('13000'),
  '130410': one('13110'),
  '130420': one('13120'),
  '130430': one('13200'),
  '130510': one('12410'),
  '130520': one('12420'),
  '130590': { kind: 'blocked', why: 'Finished-goods capitalised variance has no approved account: Finance must choose one (docs/target-coa-role-crosswalk.md).' },
  '130595': { kind: 'blocked', why: 'WIP capitalised variance has no approved account: Finance must choose one (docs/target-coa-role-crosswalk.md).' },
  '140100': pick('15200', ['15100', '15200', '15300', '15400'], 'asset class is not recorded on the balance'),
  '149100': pick('15600', ['15500', '15600', '15700'], 'asset class is not recorded on the balance'),
  '210100': one('20100'),
  '210200': one('20300'),
  '219810': pick('54000', ['54000', '54100', '54200'], 'the single snail recovery account does not record which resource was recovered'),
  '219820': pick('54000', ['54000', '54100', '54200'], 'the single poultry recovery account does not record which resource was recovered'),
  '219830': one('54300'),
  '220100': one('20700'),
  '221100': one('20600'),
  '222100': one('20700'),
  '223100': one('20700'),
  '224100': one('20200'),
  '225100': one('20500'),
  '226100': one('20400'),
  '227100': one('20900'),
  '230100': one('20200'),
  '310100': one('30000'),
  '320100': one('30200'),
  '410100': one('40210'),
  '410200': one('40220'),
  '410300': { kind: 'product', part: 'revenue' },
  '410400': one('40320'),
  '420100': { kind: 'fairValue' },
  '420200': { kind: 'fairValue' },
  '510100': one('50210'),
  '510200': one('50220'),
  '510300': { kind: 'product', part: 'costOfSales' },
  '510400': one('50320'),
  '520100': pick('53500', ['53000', '53100', '53200', '53300', '53400', '53500', '53600'], 'the variance type is not recorded on the balance'),
  '520300': pick('53500', ['53000', '53100', '53200', '53300', '53400', '53500', '53600'], 'the variance type is not recorded on the balance'),
  '520500': pick('53600', ['53000', '53100', '53200', '53300', '53400', '53500', '53600'], 'the variance type is not recorded on the balance'),
  '611000': pick('52610', ['52510', '52610'], 'snail feed and medication were expensed together'),
  '612000': pick('52010', ['52010', '52200', '52300', '56000'], 'snail labour and facility cost were expensed together'),
  '613000': pick('52020', ['52020', '52200', '52300', '56000'], 'poultry labour and overhead were expensed together'),
  '620100': one('52000'),
  '620200': one('52000'),
  '620300': one('52000'),
  '621100': one('52110'),
  '621200': pick('52200', ['52100', '52200', '52300', '52400'], 'snail processing overhead was expensed as one'),
  '622100': pick('52120', ['52120', '52200', '52300', '52400'], 'poultry conversion cost was expensed as one'),
  '623100': pick('52700', ['52700'], 'feed mill overhead'),
  '630100': one('52400'),
  '630200': { kind: 'blocked', why: 'Impairment loss has no approved account: Finance must choose one (docs/target-coa-role-crosswalk.md).' },
  '640100': one('51200'),
  '640200': pick('51200', ['51110', '51120', '51200'], 'abnormal production loss may be biological or processing'),
  '640300': one('51110'),
  '640400': one('51200'),
  '640500': one('51120'),
  '640600': one('51200'),
  '650100': one('58000'),
  '690100': one('56000'),
};

/** Where a pen's or farm's species decides a biological loss: 5305 → 51120 poultry / 51110 snail. */
export const PRODUCTION_LOSS_BY_SPECIES: Record<Species, string> = { poultry: '51120', snail: '51110' };

/** Snail cost held in the old rearing account is expensed on the approved chart, as snail feed and treatment are. */
export const SNAIL_REARING_EXPENSE = '52610';

/** A guess from the item's name — the person running the cutover confirms or changes it. */
export function proposeProductClass(description: string, code = ''): ProductClass | null {
  const text = `${code} ${description}`.toLowerCase();
  const processed = /process|dress|frozen|slime|meat|shell|smoked|fillet|pack/.test(text);
  if (/snail/.test(text)) return processed ? 'PROCESSED_SNAIL' : 'LIVE_SNAIL';
  if (/\beggs?\b|crate/.test(text)) return 'EGGS';
  if (/bird|broiler|layer|cockerel|chicken|poultry|hen|turkey|pullet|chick/.test(text)) {
    return processed ? 'PROCESSED_POULTRY' : 'LIVE_POULTRY';
  }
  return null;
}

/** Packaging or consumable from the item's name; feed comes from its own flag. Null when the name says nothing. */
export function proposeStockClass(description: string, code = '', isBiologicalFeed = false): StockClass {
  if (isBiologicalFeed) return 'FEED';
  const text = `${code} ${description}`.toLowerCase();
  if (/packag|carton|crate|sack|bag\b|box|label|wrap/.test(text)) return 'PACKAGING';
  if (/consumable|cleaning|detergent|disinfect|glove|fuel|spare/.test(text)) return 'CONSUMABLE';
  return 'RAW';
}

/** Every approved account any rule can send a balance to — they must exist before the cutover runs. */
export function crosswalkTargets(): string[] {
  const targets = new Set<string>();
  for (const rule of Object.values(CROSSWALK)) {
    if (rule.kind === 'one' || rule.kind === 'pick') {
      targets.add(rule.to);
      if (rule.kind === 'pick') rule.alternatives.forEach((a) => targets.add(a));
    }
  }
  Object.values(APPROVED_STOCK_ACCOUNTS).forEach((a) => targets.add(a));
  for (const c of Object.values(APPROVED_PRODUCT_CLASSES)) [c.revenue, c.costOfSales, c.inventory].forEach((a) => targets.add(a));
  Object.values(PRODUCTION_LOSS_BY_SPECIES).forEach((a) => targets.add(a));
  ['16031', '16041', '16032', '16042', '42000', '42100', SNAIL_REARING_EXPENSE].forEach((a) => targets.add(a));
  return [...targets];
}
