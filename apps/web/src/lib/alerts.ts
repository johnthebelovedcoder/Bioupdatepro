import 'server-only';
import { getFarmConfig } from './farm-config.server';
import { getInventory } from './demo-trade';
import { getSalesInvoices } from './demo-trade';
import { getFeeding, getHealth } from './operations';
import { getGroups, getGroupDetail } from './operations';
import { getVarianceFindings } from './variance';
import { formatNaira, toKobo } from './money';
import { standardAt, standardFor, type FarmConfig } from './farm-config';
import { defaultFeedFor, getModule, subscribedModules, type ModuleKey } from './modules';
import { canSee, sectionForPath, type Section } from './permissions';

/**
 * What needs attention, and what to do about it.
 *
 * Every alert carries a VERB and somewhere to go. That is the whole point of
 * this module: the product previously told a farmer "layer mash is below the
 * reorder level" and then left them to work out what to do and where. An
 * observation with no action is a notification, and people stop reading
 * notifications.
 *
 * Every threshold comes from the farm's own settings. Nothing here decides on a
 * farm's behalf how many days of feed is too few.
 */

/**
 * When another day of feed stops paying for itself.
 *
 * This used to be a bare age test — past day 38, say the bird is ready — with
 * the sentence "past this point feed costs more than the weight it adds"
 * attached to it. That sentence was an assertion, not a result: nothing in the
 * product had compared the two. On the demo farm's own numbers it is also
 * wrong. A 31-day Cobb 500 eats about 133 g a day, which at ₦660/kg costs about
 * ₦88, and puts on about 86 g, which at ₦3,200/kg is worth about ₦274. Selling
 * on that advice would throw away three times the feed cost in weight, every
 * day, for the rest of the batch.
 *
 * So it is computed. The value of tomorrow's growth against the cost of
 * tomorrow's feed, using this farm's own market price and its own feed cost.
 * The crossover is found by walking forward through the breed standard rather
 * than only testing today, because knowing a batch is ready in nine days is
 * what lets somebody line up a buyer — being told on the morning it happens is
 * most of a week too late.
 *
 * Returns null where it cannot be worked out. No weight curve, no feed intake
 * curve, or no price for the feed means there is no answer, and an age-based
 * guess dressed up as a calculation is what this replaced.
 */
function sellAdvice(
  config: FarmConfig,
  group: { code: string; breed: string; purpose: string; ageDays: number },
  stock: Array<{ name: string; unit: string; unitCostKobo: string }>,
): { readyNow: boolean; crossoverAge: number; detail: string } | null {
  const standard = standardFor(config, group);
  if (!standard?.weight?.length || !standard.feedIntake?.length) return null;

  const module = getModule('poultry');
  if (!module) return null;

  const feedName = defaultFeedFor(module, {
    purpose: group.purpose,
    stage: 'Grower',
    ageDays: group.ageDays,
  });
  const feed = stock.find((item) => item.name === feedName && item.unit === 'kg');
  if (!feed) return null;

  const feedCostPerKg = toKobo(feed.unitCostKobo);
  const marketPerKg = toKobo(config.sales.marketPricePerKgKobo);
  if (feedCostPerKg <= 0n || marketPerKg <= 0n) return null;

  // The published curve is the limit of what can honestly be said. Beyond its
  // last point `standardAt` clamps, so growth reads as zero — which is not a
  // measurement, and the wording below says where the curve ended.
  const lastAge = standard.weight[standard.weight.length - 1]!.age;

  const dayPays = (age: number): { gainG: number; intakeG: number; pays: boolean } | null => {
    const here = standardAt(standard.weight!, age);
    const next = standardAt(standard.weight!, age + 1);
    const intake = standardAt(standard.feedIntake!, age);
    if (here === null || next === null || intake === null) return null;

    const gainG = Math.max(0, next - here);
    // Kobo throughout, scaled by 1,000 so grams stay integral.
    const valueOfGain = (BigInt(Math.round(gainG)) * marketPerKg) / 1000n;
    const costOfFeed = (BigInt(Math.round(intake)) * feedCostPerKg) / 1000n;
    return { gainG, intakeG: intake, pays: valueOfGain > costOfFeed };
  };

  const today = dayPays(group.ageDays);
  if (!today) return null;

  if (!today.pays) {
    return {
      readyNow: true,
      crossoverAge: group.ageDays,
      detail:
        group.ageDays >= lastAge
          ? `Day ${group.ageDays}. The ${standard.breed} growth curve ends at day ${lastAge}, so there is no basis for feeding on.`
          : `Day ${group.ageDays}. Another day's feed costs about ${formatNaira(
              (BigInt(Math.round(today.intakeG)) * feedCostPerKg) / 1000n,
            )} and adds about ${formatNaira(
              (BigInt(Math.round(today.gainG)) * marketPerKg) / 1000n,
            )} of weight.`,
    };
  }

  // Still paying. Look ahead for the day it stops, so a buyer can be arranged.
  for (let age = group.ageDays + 1; age <= lastAge; age += 1) {
    const day = dayPays(age);
    if (day && !day.pays) {
      const daysAway = age - group.ageDays;
      if (daysAway > 14) return null;
      return {
        readyNow: false,
        crossoverAge: age,
        detail: `About ${daysAway} day${daysAway === 1 ? '' : 's'} away. Today a day's feed costs about ${formatNaira(
          (BigInt(Math.round(today.intakeG)) * feedCostPerKg) / 1000n,
        )} and adds about ${formatNaira(
          (BigInt(Math.round(today.gainG)) * marketPerKg) / 1000n,
        )}, so keep feeding for now.`,
      };
    }
  }

  return null;
}

export type Severity = 'critical' | 'warning' | 'info';

export interface Alert {
  id: string;
  kind: string;
  /**
   * Which species module this belongs to, where it belongs to one.
   *
   * Null for the alerts that are about the business rather than the livestock —
   * money owed, stock below reorder. Set so the interface can say which module
   * an alert came from instead of showing a broiler batch under a snail
   * heading, which reads like a bug even when the figure is right.
   */
  moduleKey?: ModuleKey | null;
  severity: Severity;
  title: string;
  detail: string;
  /**
   * Where the answer is — or null when this person cannot go there.
   *
   * It used to be "never omitted", and that was right while every reader could
   * reach every screen. Now a supervisor can be told the feed is running out
   * without being offered a purchasing screen that would turn them away.
   */
  action: { label: string; href: string } | null;
  /** Sorted on this: smaller is more urgent. */
  rank: number;
}

/* -------------------------------------------------------------------------- */

export interface FeedRunway {
  item: string;
  onHand: number;
  unit: string;
  /** Average use per day over the window the farm configured. */
  dailyUse: number;
  /** How many days the stock lasts at that rate. Null when nothing is used. */
  daysLeft: number | null;
  /** The last day an order can be placed and still arrive in time. */
  orderBy: Date | null;
  severity: Severity | null;
}

/**
 * How long the feed lasts.
 *
 * "You have 240 kg left" is not actionable. "That is six days, and it takes
 * three days to arrive, so order by Thursday" is. Feed is 60–70% of a poultry
 * farm's cost and running out is not a small problem — it costs production
 * immediately and takes weeks to recover.
 */
export async function getFeedRunway(config: FarmConfig): Promise<FeedRunway[]> {
  // Consumption across the modules this farm actually has. Naming poultry and
  // snail here meant a farm with neither still had their feed measured, and a
  // farm with a third module would have had its own feed ignored.
  const [inventory, ...feeding] = await Promise.all([
    getInventory(),
    ...subscribedModules(config.modules).map((module) =>
      getFeeding(module.key, config.feed.consumptionWindowDays),
    ),
  ]);

  const used = new Map<string, number>();
  for (const row of feeding.flat()) {
    used.set(row.feedType, (used.get(row.feedType) ?? 0) + row.kg);
  }

  const today = new Date();

  return inventory
    .filter((item) => item.category === 'Feed')
    .map((item) => {
      const total = used.get(item.name) ?? 0;
      const dailyUse = total / Math.max(1, config.feed.consumptionWindowDays);
      const daysLeft = dailyUse > 0 ? item.onHand / dailyUse : null;

      // The last day an order still arrives before the stock is gone.
      const orderBy =
        daysLeft === null
          ? null
          : new Date(
              today.getTime() +
                Math.max(0, daysLeft - config.feed.supplierLeadDays) * 86_400_000,
            );

      const severity: Severity | null =
        daysLeft === null
          ? null
          : daysLeft <= config.feed.runwayCriticalDays
            ? 'critical'
            : daysLeft <= config.feed.supplierLeadDays + config.feed.runwayBufferDays
              ? 'warning'
              : null;

      return {
        item: item.name,
        onHand: item.onHand,
        unit: item.unit,
        dailyUse: Number(dailyUse.toFixed(1)),
        daysLeft: daysLeft === null ? null : Number(daysLeft.toFixed(1)),
        orderBy,
        severity,
      };
    })
    .sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
}

/* -------------------------------------------------------------------------- */

/**
 * Everything that needs a decision today, most urgent first.
 *
 * Only alert kinds the farm has switched on are produced — a farm that does not
 * want to hear about overdue invoices does not get told about them, and the
 * setting is honoured here rather than filtered out in the interface.
 */
/**
 * Which part of the product an alert belongs to.
 *
 * Derived from the kind rather than set at each of the nine places an alert is
 * pushed, so a new alert cannot be added without a section by simply forgetting
 * one — the mapping is exhaustive and the default is the most restrictive.
 */
function sectionForKind(kind: string): Section {
  switch (kind) {
    case 'paymentOverdue':
    case 'sellWindow':
    // Variance findings are priced — "worth about ₦258,240" — so they are
    // money, whatever operational thing they describe.
    case 'varianceDetected':
      return 'money';
    case 'lowStock':
      return 'inventory';
    case 'feedRunway':
    case 'mortalitySpike':
    case 'vaccinationDue':
    case 'dailyRoundMissing':
      return 'livestock';
    default:
      return 'money';
  }
}

/**
 * What needs attention, filtered to what this person may see.
 *
 * Without `roles` nothing is filtered, which is the behaviour every existing
 * caller had. With them, an alert whose section the person cannot reach is not
 * shown at all — because the alert list was leaking exactly what the screens
 * withheld: a production supervisor with no access to the money section was
 * still being told "₦161,000 is overdue from 2 customers" on the dashboard.
 * A figure hidden on one screen and printed on another is not hidden.
 */
export async function getAlerts(roles?: readonly string[]): Promise<Alert[]> {
  const config = await getFarmConfig();
  const enabled = new Set(
    config.alerts.filter((rule) => rule.enabled).map((rule) => rule.kind),
  );

  const alerts: Alert[] = [];

  /* --- Feed running out ------------------------------------------------- */
  if (enabled.has('feedRunway')) {
    const runway = await getFeedRunway(config);
    for (const feed of runway) {
      if (!feed.severity || feed.daysLeft === null) continue;
      const days = Math.floor(feed.daysLeft);
      // "0 days" is technically true below one day and reads as a rounding
      // error rather than an emergency. Say what it means.
      const howLong = days < 1 ? 'less than a day' : `about ${days} day${days === 1 ? '' : 's'}`;
      alerts.push({
        id: `runway-${feed.item}`,
        kind: 'feedRunway',
        severity: feed.severity,
        title:
          feed.severity === 'critical'
            ? days < 1
              ? `${feed.item} runs out today`
              : `${feed.item} runs out in ${days} day${days === 1 ? '' : 's'}`
            : `${feed.item} is running low`,
        detail:
          feed.orderBy && feed.severity !== 'critical'
            ? `${feed.onHand.toLocaleString('en-NG')} ${feed.unit} left, ${howLong} at ${feed.dailyUse} ${feed.unit} a day. Order by ${feed.orderBy.toLocaleDateString('en-NG', { weekday: 'long' })}.`
            : `${feed.onHand.toLocaleString('en-NG')} ${feed.unit} left, ${howLong} at ${feed.dailyUse} ${feed.unit} a day. It takes ${config.feed.supplierLeadDays} days to arrive.`,
        action: {
          label: 'Order feed',
          href: `/procurement/new?item=${encodeURIComponent(feed.item)}`,
        },
        rank: feed.severity === 'critical' ? 0 : 20 + days,
      });
    }
  }

  /* --- Other stock below reorder ---------------------------------------- */
  if (enabled.has('lowStock')) {
    const inventory = await getInventory();
    for (const item of inventory) {
      if (item.category === 'Feed') continue; // covered by the runway above
      if (item.onHand > item.reorderLevel) continue;
      alerts.push({
        id: `low-${item.code}`,
        kind: 'lowStock',
        severity: 'warning',
        title: `${item.name} is below the reorder level`,
        detail: `${item.onHand.toLocaleString('en-NG')} ${item.unit} left, reorder at ${item.reorderLevel.toLocaleString('en-NG')}.`,
        action: {
          label: 'Order more',
          href: `/procurement/new?item=${encodeURIComponent(item.code)}`,
        },
        rank: 40,
      });
    }
  }

  /* --- Deaths above the normal ------------------------------------------ */
  if (enabled.has('mortalitySpike') && config.variance.enabled) {
    const [poultry, snails] = await Promise.all([getGroups('poultry'), getGroups('snail')]);
    for (const group of [...poultry, ...snails]) {
      if (group.status !== 'ACTIVE') continue;
      if (group.population < config.variance.minimumPopulation) continue;

      /*
       * Today against this population's OWN recent days, at the multiple the
       * farm set.
       *
       * This previously used a hard-coded 5% lifetime rate and ignored
       * `mortalitySpikeMultiple` completely — so the setting said one thing and
       * the alert did another, which is worse than having no setting at all.
       * Lifetime rate is also the wrong measure: a batch that lost birds in
       * week one looks permanently bad, and one dying today looks fine until
       * the average catches up.
       */
      const detail = await getGroupDetail(
        group.species === 'SNAIL' ? 'snail' : 'poultry',
        group.id,
      );
      if (!detail || detail.mortalitySeries.length < 4) continue;

      const series = detail.mortalitySeries;
      const latest = series[series.length - 1]?.value ?? 0;
      const earlier = series.slice(0, -1);
      const baseline =
        earlier.reduce((sum, point) => sum + point.value, 0) / Math.max(1, earlier.length);

      // A baseline near zero makes any death an infinite multiple. Require a
      // real number of deaths before calling it a spike.
      if (baseline < 1 || latest < 3) continue;
      const multiple = latest / baseline;
      if (multiple < config.variance.mortalitySpikeMultiple) continue;

      alerts.push({
        id: `mortality-${group.id}`,
        kind: 'mortalitySpike',
        severity: multiple >= config.variance.mortalitySpikeMultiple * 1.6 ? 'critical' : 'warning',
        title: `${group.code} lost ${latest} ${group.species === 'SNAIL' ? 'snails' : 'birds'} today — ${multiple.toFixed(1)}× its normal`,
        detail: `Normally about ${baseline.toFixed(1)} a day over the past fortnight. ${group.mortalityRate.toFixed(1)}% lost since it started.`,
        action: {
          label: 'Look at it',
          href: `/m/${group.species === 'SNAIL' ? 'snail' : 'poultry'}/${group.species === 'SNAIL' ? 'cohorts' : 'flocks'}/${group.id}`,
        },
        rank: group.mortalityRate > 8 ? 5 : 30,
      });
    }
  }

  /* --- Vaccinations ------------------------------------------------------ */
  if (enabled.has('vaccinationDue')) {
    /*
     * Every subscribed module, not just poultry.
     *
     * Hard-coding the species here did two wrong things at once: a snail farmer
     * never saw their own health events, and a poultry batch appeared on screen
     * while SnailPro was the module in the sidebar. Each alert now says which
     * module it belongs to, so nothing looks like it wandered in from another
     * farm.
     */
    for (const module of subscribedModules(config.modules)) {
      if (!module.nav.some((entry) => entry.slug === 'health')) continue;

      const health = await getHealth(module.key);
      const overdue = health.filter((event) => event.status === 'OVERDUE');
      const due = health.filter((event) => event.status === 'DUE');

      if (overdue.length > 0) {
        alerts.push({
          id: `vacc-overdue-${module.key}`,
          kind: 'vaccinationDue',
          moduleKey: module.key,
          severity: 'critical',
          title: `${overdue.length} vaccination${overdue.length === 1 ? ' is' : 's are'} overdue`,
          detail: overdue
            .slice(0, 3)
            .map((event) => `${event.name} · ${event.groupCode}`)
            .join(', '),
          // "Mark done" promised something the health screen could not do until
          // it gained a record form. The label now matches what happens next.
          action: { label: 'Record it', href: `/m/${module.key}/health` },
          rank: 10,
        });
      }
      if (due.length > 0) {
        alerts.push({
          id: `vacc-due-${module.key}`,
          kind: 'vaccinationDue',
          moduleKey: module.key,
          severity: 'info',
          title: `${due.length} vaccination${due.length === 1 ? '' : 's'} coming up`,
          detail: due
            .slice(0, 3)
            .map((event) => `${event.name} · ${event.groupCode}`)
            .join(', '),
          action: { label: 'See schedule', href: `/m/${module.key}/health` },
          rank: 60,
        });
      }
    }
  }

  /* --- Money owed -------------------------------------------------------- */
  if (enabled.has('paymentOverdue')) {
    const invoices = await getSalesInvoices();
    const overdue = invoices.filter((invoice) => invoice.status === 'OVERDUE');
    if (overdue.length > 0) {
      const total = overdue.reduce(
        (sum, invoice) => sum + toKobo(invoice.outstandingKobo),
        0n,
      );
      alerts.push({
        id: 'ar-overdue',
        kind: 'paymentOverdue',
        severity: 'warning',
        title: `${formatNaira(total)} is overdue from ${overdue.length} customer${overdue.length === 1 ? '' : 's'}`,
        detail: overdue.map((invoice) => invoice.customer).join(', '),
        action: { label: 'See who owes', href: '/sales' },
        rank: 35,
      });
    }
  }

  /* --- Time to sell ------------------------------------------------------ */
  if (enabled.has('sellWindow') && config.sales.sellAdviceEnabled) {
    /*
     * Sell advice needs a weight curve and a feed-intake curve, which today
     * only the poultry breed standards carry — so in practice this still only
     * fires for meat birds. It is gated on the farm HAVING poultry rather than
     * on poultry existing in the codebase, so a snail-only farm is not told
     * about a broiler batch it cannot see.
     */
    const hasPoultry = subscribedModules(config.modules).some((m) => m.key === 'poultry');
    const [poultry, stock] = hasPoultry
      ? await Promise.all([getGroups('poultry'), getInventory()])
      : [[], []];

    for (const group of poultry) {
      if (group.status !== 'ACTIVE' || group.purpose !== 'Broiler') continue;

      const advice = sellAdvice(config, group, stock);
      if (!advice) continue;

      alerts.push({
        id: `sell-${group.id}`,
        kind: 'sellWindow',
        moduleKey: 'poultry',
        severity: advice.readyNow ? 'warning' : 'info',
        title: advice.readyNow
          ? `${group.code} is ready to sell`
          : `${group.code} will be ready to sell around day ${advice.crossoverAge}`,
        detail: advice.detail,
        action: { label: 'Record a sale', href: '/sales/new' },
        rank: advice.readyNow ? 40 : 55,
      });
    }
  }

  /* --- Figures that do not add up ---------------------------------------- */
  if (enabled.has('varianceDetected')) {
    const findings = await getVarianceFindings();
    for (const finding of findings) {
      alerts.push({
        id: `variance-${finding.id}`,
        kind: 'varianceDetected',
        moduleKey: finding.moduleKey ?? null,
        severity: finding.severity,
        title: finding.headline,
        detail: finding.gapValueKobo
          ? `${finding.basis} Worth about ${formatNaira(finding.gapValueKobo)}.`
          : finding.basis,
        action: { label: 'Look into it', href: '/finance/losses' },
        rank: finding.severity === 'critical' ? 2 : 25,
      });
    }
  }

  /*
   * A farm with no animals gets no warnings about animals.
   *
   * AgriPro Core is sold on its own — books, buying, selling, payroll, no
   * livestock — and until this filter existed such a customer opened their
   * dashboard to "Gumboro vaccine is below the reorder level" and "how long the
   * feed lasts". Every alert whose section is `livestock` belongs to a species
   * module, so the same mapping that decides who may see an alert decides
   * whether it applies at all.
   */
  const hasSpecies = subscribedModules(config.modules).length > 0;
  const applicable = hasSpecies
    ? alerts
    : alerts.filter((alert) => sectionForKind(alert.kind) !== 'livestock');

  const ordered = applicable.sort((a, b) => a.rank - b.rank);
  if (!roles) return ordered;

  return ordered
    .filter((alert) => canSee(roles, sectionForKind(alert.kind)))
    .map((alert) => {
      /*
       * An alert may be visible while its answer is not.
       *
       * A supervisor should know the feed runs out today — they are the one
       * feeding the animals — but ordering it is not their job, and a button
       * that lands on "That screen is not yours" is worse than no button. The
       * warning stays; the action goes.
       */
      if (!alert.action) return alert;
      if (canSee(roles, sectionForPath(alert.action.href))) return alert;
      return { ...alert, action: null };
    });
}
