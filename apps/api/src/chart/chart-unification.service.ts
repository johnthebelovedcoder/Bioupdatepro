import { Injectable, Logger } from '@nestjs/common';
import { AccountType, AuditAction, PeriodStatus, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { PostingControlProvisioningService } from '../posting-control/posting-control-provisioning.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';
import { chartVersionOf, ROLE_ACCOUNTS, Species } from './chart';

/**
 * Moving a farm from the four-digit chart to the client's six-digit one.
 *
 * WHAT IT DOES. Every balance on an old account, as it stands the day before
 * the cutover, is moved to its new account by a journal dated the cutover
 * (the first day of an open month). Each line keeps the branch, farm, pen,
 * customer, supplier and item it was posted with, so a customer's or an
 * item's history still adds up afterwards. Then every setting that points at
 * an old account — items, sales and purchasing settings, salary components,
 * bank accounts, tax mappings — is pointed at the new one, the old accounts
 * are made inactive, and the company is switched to SPEC. All in one
 * transaction: a half-moved chart is worse than an unmoved one.
 *
 * WHERE THINGS GO (decisions of 2026-09-25, docs/chart-unification-mapping.csv):
 *   one-to-one accounts          by ROLE_ACCOUNTS (1101 → 110100, …)
 *   1301 Raw materials           feed items → 130110, everything else → 130100
 *   1401/1305 Finished goods     by what each item is (PRODUCT_ACCOUNTS)
 *   4101 Revenue, 5001 COGS      by what each item is; this year's only
 *   1501 Rearing cost            poultry → 130210 (held in the flock);
 *                                snails → 611000 (expensed, as the spec does)
 *   5305 Production loss         poultry → 640500, snails → 640300
 *   5205 Clearing                has no home: the cutover refuses while it
 *                                holds a balance
 * A line whose item or species cannot be told goes to the `fallback` target
 * and is shown in the preview, so nothing is moved anywhere silently.
 */

export type ProductClass = 'LIVE_POULTRY' | 'EGGS' | 'PROCESSED_POULTRY' | 'LIVE_SNAIL' | 'PROCESSED_SNAIL';

export const PRODUCT_CLASSES: Record<ProductClass, { label: string; revenue: string; costOfSales: string; inventory: string }> = {
  LIVE_POULTRY: { label: 'Live birds', revenue: '410300', costOfSales: '510300', inventory: '130520' },
  EGGS: { label: 'Eggs', revenue: '410300', costOfSales: '510300', inventory: '130215' },
  PROCESSED_POULTRY: { label: 'Processed poultry', revenue: '410400', costOfSales: '510400', inventory: '130520' },
  LIVE_SNAIL: { label: 'Live snails', revenue: '410100', costOfSales: '510100', inventory: '130510' },
  PROCESSED_SNAIL: { label: 'Processed snail products', revenue: '410200', costOfSales: '510200', inventory: '130510' },
};

/** A guess from the item's name — the person running the cutover confirms or changes it. */
export function proposeClass(description: string, code = ''): ProductClass | null {
  const text = `${code} ${description}`.toLowerCase();
  const processed = /process|dress|frozen|slime|meat|shell|smoked|fillet|pack/.test(text);
  if (/snail/.test(text)) return processed ? 'PROCESSED_SNAIL' : 'LIVE_SNAIL';
  if (/\beggs?\b|crate/.test(text)) return 'EGGS';
  if (/bird|broiler|layer|cockerel|chicken|poultry|hen|turkey|pullet|chick/.test(text)) {
    return processed ? 'PROCESSED_POULTRY' : 'LIVE_POULTRY';
  }
  return null;
}

/** Old accounts whose balance is split rather than moved whole. */
const SPLIT = {
  rawMaterials: '1301',
  finishedGoods: ['1401', '1305'],
  revenue: '4101',
  costOfSales: '5001',
  rearing: '1501',
  loss: '5305',
} as const;
const CLEARING = '5205';

const BY_SPECIES = {
  rearing: { poultry: '130210', snail: '611000' },
  loss: { poultry: '640500', snail: '640300' },
} satisfies Record<string, Record<Species, string>>;

/** One-to-one moves: every old number to its single new number. */
function simpleMoves(): Map<string, string> {
  const map = new Map<string, string>();
  for (const [legacy, spec] of Object.values(ROLE_ACCOUNTS)) {
    // 1301 is both raw materials and feed on the old chart: split by item below.
    if (legacy === SPLIT.rawMaterials) continue;
    map.set(legacy, spec);
  }
  return map;
}

/** Every old account the cutover may move or retire. */
export const LEGACY_NUMBERS = [
  ...new Set([
    ...Object.values(ROLE_ACCOUNTS).map(([legacy]) => legacy),
    SPLIT.rawMaterials,
    ...SPLIT.finishedGoods,
    SPLIT.revenue,
    SPLIT.costOfSales,
    SPLIT.rearing,
    SPLIT.loss,
    CLEARING,
  ]),
];

export interface UnificationOptions {
  /** What each sold or stocked item is. Items left out take the proposal from their name, then `defaultClass`. */
  itemClasses?: Record<string, ProductClass>;
  /** For an item nothing else classifies, and for sales lines with no item. */
  defaultClass?: ProductClass;
  /** For rearing cost and losses whose species cannot be told. */
  defaultSpecies?: Species;
}

export interface Move {
  to: string;
  amountKobo: bigint;
  /** Why this part goes here — shown in the preview. */
  basis: string;
  /** True when the item or species could not be told and a default was used. */
  assumed: boolean;
}

export interface UnificationPreview {
  cutoverDate: string;
  chartVersion: string;
  canRun: boolean;
  blockers: string[];
  warnings: string[];
  accounts: Array<{ from: string; name: string; balanceKobo: string; moves: Array<Omit<Move, 'amountKobo'> & { amountKobo: string }> }>;
  items: Array<{ itemId: string; code: string; description: string; proposed: ProductClass | null; chosen: ProductClass; feed: boolean }>;
  /** Accounts that are neither old nor six-digit and hold a balance — left as they are. */
  untouched: Array<{ accountNumber: string; name: string; balanceKobo: string }>;
}

type Dims = {
  branchId: string;
  departmentId: string | null;
  costCentreId: string | null;
  farmId: string | null;
  penHouseId: string | null;
  projectId: string | null;
  customerId: string | null;
  supplierId: string | null;
  employeeId: string | null;
  itemId: string | null;
};

interface Group extends Dims {
  glAccountId: string;
  accountNumber: string;
  netKobo: bigint;
}

interface Plan {
  preview: UnificationPreview;
  groups: Array<Group & { to: string }>;
  period: { id: string; financialYearId: string } | null;
  classes: Map<string, ProductClass>;
}

const PERIOD_ACCOUNTS: AccountType[] = [AccountType.REVENUE, AccountType.EXPENSE];

@Injectable()
export class ChartUnificationService {
  private readonly logger = new Logger(ChartUnificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly provisioning: PostingControlProvisioningService,
  ) {}

  /** The first day of the earliest open month that has not started yet — or of the current one if none is set up. */
  async suggestedCutover(companyId: string, today = new Date()): Promise<Date | null> {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { financialYear: { companyId }, status: PeriodStatus.OPEN, startDate: { gt: today } },
      orderBy: { startDate: 'asc' },
    });
    return period?.startDate ?? null;
  }

  async preview(companyId: string, cutoverDate: Date, options: UnificationOptions = {}): Promise<UnificationPreview> {
    return (await this.plan(this.prisma, companyId, cutoverDate, options)).preview;
  }

  async run(params: { companyId: string; cutoverDate: Date; options?: UnificationOptions; actor: WorkflowActor }) {
    const { companyId, cutoverDate, actor } = params;
    const options = params.options ?? {};

    // The six-digit accounts must exist before anything can move into them.
    // Idempotent, and harmless if the cutover then refuses.
    await this.provisioning.provision(companyId, actor.userId);

    return this.prisma.$transaction(
      async (tx) => {
        const plan = await this.plan(tx, companyId, cutoverDate, options);
        if (!plan.preview.canRun) {
          throw new AccountingRuleViolation('Chart unification', `The cutover cannot run: ${plan.preview.blockers.join(' | ')}`, {
            blockers: plan.preview.blockers,
          });
        }
        const period = plan.period!;
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { baseCurrencyId: true } });
        const accounts = await this.accountIds(tx, companyId);
        const id = (number: string) => {
          const found = accounts.get(number);
          if (!found) throw new AccountingRuleViolation('Chart unification', `Account ${number} does not exist for this company.`, {});
          return found;
        };

        // --- 1. One journal per branch (a journal's lines share its branch) -
        const journals: string[] = [];
        const byBranch = new Map<string, Plan['groups']>();
        for (const group of plan.groups) {
          byBranch.set(group.branchId, [...(byBranch.get(group.branchId) ?? []), group]);
        }
        for (const [branchId, groups] of byBranch) {
          const header = {
            companyId,
            branchId,
            financialYearId: period.financialYearId,
            financialPeriodId: period.id,
            currencyId: company.baseCurrencyId,
            exchangeRate: '1.00000000',
          };
          const lines = groups.flatMap((group) => {
            const dimensions = {
              ...header,
              departmentId: group.departmentId,
              costCentreId: group.costCentreId,
              farmId: group.farmId,
              penHouseId: group.penHouseId,
              projectId: group.projectId,
              customerId: group.customerId,
              supplierId: group.supplierId,
              employeeId: group.employeeId,
              itemId: group.itemId,
            };
            const amount = kobo(group.netKobo > 0n ? group.netKobo : -group.netKobo);
            const debitBalance = group.netKobo > 0n;
            return [
              { glAccountId: group.glAccountId, description: `Chart unification — ${group.accountNumber} to ${group.to}`, dimensions, ...(debitBalance ? { credit: amount } : { debit: amount }) },
              { glAccountId: id(group.to), description: `Chart unification — from ${group.accountNumber}`, dimensions, ...(debitBalance ? { debit: amount } : { credit: amount }) },
            ];
          });
          const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId }, select: { code: true } });
          const posted = await this.posting.post(
            {
              sourceModule: 'chart',
              sourceDocumentType: 'ChartUnification',
              sourceDocumentId: companyId,
              journalNumber: `COA-${branch.code}-${cutoverDate.toISOString().slice(0, 10)}`,
              journalDate: cutoverDate,
              narration: 'Chart unification: balances moved from the four-digit chart to the six-digit chart',
              ...header,
              idempotencyKey: `chart-unification:${companyId}:${branchId}`,
              actor,
              lines,
            },
            tx,
          );
          journals.push(posted.journalEntryId);
        }

        // --- 2. Point every setting at the new accounts --------------------
        const repointed = await this.repoint(tx, companyId, plan.classes, options, id);

        // --- 3. Retire the old accounts and switch --------------------------
        const retired = await tx.gLAccount.updateMany({
          where: { companyId, accountNumber: { in: LEGACY_NUMBERS }, active: true },
          data: { active: false },
        });
        await tx.company.update({ where: { id: companyId }, data: { chartVersion: 'SPEC' } });

        await this.audit.write(
          {
            transactionId: companyId,
            module: 'chart',
            entityType: 'Company',
            entityId: companyId,
            status: 'SPEC',
            action: AuditAction.UPDATE,
            userId: actor.userId,
            comments:
              `Moved to the six-digit chart from ${cutoverDate.toISOString().slice(0, 10)}: ` +
              `${plan.groups.length} balances moved in ${journals.length} journal(s), ` +
              `${repointed} settings repointed, ${retired.count} old accounts retired.`,
            metadata: {
              journals,
              repointed,
              retired: retired.count,
              itemClasses: Object.fromEntries(plan.classes),
            },
          },
          tx,
        );
        this.logger.log(`Company ${companyId} moved to the six-digit chart (${journals.length} journals).`);
        return { journals, moved: plan.groups.length, repointed, retired: retired.count, preview: plan.preview };
      },
      { timeout: 120_000 },
    );
  }

  /* --- The plan: what moves where ----------------------------------------- */

  private async plan(
    client: Prisma.TransactionClient,
    companyId: string,
    cutoverDate: Date,
    options: UnificationOptions,
  ): Promise<Plan> {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const version = await chartVersionOf(client, companyId);
    if (version === 'SPEC') blockers.push('This company is already on the six-digit chart.');

    // --- The month the cutover opens ---------------------------------------
    const period = await client.financialPeriod.findFirst({
      where: { financialYear: { companyId }, startDate: cutoverDate },
      include: { financialYear: true },
    });
    if (!period) {
      blockers.push(`No financial period starts on ${day(cutoverDate)}. The cutover must be the first day of a month that is set up.`);
    } else if (period.status !== PeriodStatus.OPEN) {
      blockers.push(`${period.name} is ${period.status.toLowerCase()}; the cutover month must be open.`);
    }

    const legacy = await client.gLAccount.findMany({
      where: { companyId, accountNumber: { in: LEGACY_NUMBERS } },
      select: { id: true, accountNumber: true, name: true, accountType: true },
    });
    const legacyById = new Map(legacy.map((a) => [a.id, a]));
    const legacyIds = legacy.map((a) => a.id);

    // --- Nothing may already sit on an old account on or after the cutover --
    const late = await client.journalLine.count({
      where: { companyId, glAccountId: { in: legacyIds }, journalEntry: { status: 'POSTED', journalDate: { gte: cutoverDate } } },
    });
    if (late > 0) {
      blockers.push(`${late} line(s) on the old accounts are dated on or after ${day(cutoverDate)}. Pick a later cutover, or reverse them.`);
    }

    // --- Revenue and expense of an earlier, unclosed year have nowhere to go -
    const yearStart = period?.financialYear.startDate ?? cutoverDate;
    const periodIds = legacy.filter((a) => PERIOD_ACCOUNTS.includes(a.accountType)).map((a) => a.id);
    const earlier = await client.journalLine.groupBy({
      by: ['glAccountId'],
      where: { companyId, glAccountId: { in: periodIds }, journalEntry: { status: 'POSTED', journalDate: { lt: yearStart } } },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const unclosed = earlier.filter((row) => (row._sum.debitKobo ?? 0n) !== (row._sum.creditKobo ?? 0n));
    if (unclosed.length > 0) {
      blockers.push(
        `Income or expense from before ${day(yearStart)} is still open on ` +
          unclosed.map((row) => legacyById.get(row.glAccountId)!.accountNumber).join(', ') +
          '. Close the earlier financial year first.',
      );
    }

    // --- Balances, per account and dimension set ---------------------------
    // Balance-sheet accounts: everything before the cutover (a hard year-end
    // close zeroes and restates, so the running total is the balance).
    // Income and expense: this financial year only.
    const lines = await client.journalLine.groupBy({
      by: ['glAccountId', 'branchId', 'departmentId', 'costCentreId', 'farmId', 'penHouseId', 'projectId', 'customerId', 'supplierId', 'employeeId', 'itemId'],
      where: {
        companyId,
        glAccountId: { in: legacyIds },
        journalEntry: { status: 'POSTED', journalDate: { lt: cutoverDate } },
        OR: [
          { glAccount: { accountType: { notIn: PERIOD_ACCOUNTS } } },
          { journalEntry: { journalDate: { gte: yearStart } } },
        ],
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const groups: Group[] = lines
      .map((row) => ({
        glAccountId: row.glAccountId,
        accountNumber: legacyById.get(row.glAccountId)!.accountNumber,
        branchId: row.branchId,
        departmentId: row.departmentId,
        costCentreId: row.costCentreId,
        farmId: row.farmId,
        penHouseId: row.penHouseId,
        projectId: row.projectId,
        customerId: row.customerId,
        supplierId: row.supplierId,
        employeeId: row.employeeId,
        itemId: row.itemId,
        netKobo: (row._sum.debitKobo ?? 0n) - (row._sum.creditKobo ?? 0n),
      }))
      .filter((g) => g.netKobo !== 0n);

    const clearing = groups.filter((g) => g.accountNumber === CLEARING).reduce((s, g) => s + g.netKobo, 0n);
    if (clearing !== 0n) {
      blockers.push(`5205 Payroll/Overhead Clearing holds ${naira(clearing)}. It has no place on the new chart: clear it first.`);
    }

    // --- What each item is --------------------------------------------------
    const itemIds = new Set(groups.map((g) => g.itemId).filter((i): i is string => !!i));
    const legacyIdsByNumber = new Map(legacy.map((a) => [a.accountNumber, a.id]));
    const saleAccountIds = [...SPLIT.finishedGoods, SPLIT.revenue, SPLIT.costOfSales]
      .map((n) => legacyIdsByNumber.get(n))
      .filter((i): i is string => !!i);
    const items = await client.item.findMany({
      where: {
        companyId,
        OR: [
          { id: { in: [...itemIds] } },
          { inventoryGlAccountId: { in: saleAccountIds } },
          { revenueGlAccountId: { in: saleAccountIds } },
          { costOfSalesGlAccountId: { in: saleAccountIds } },
        ],
      },
      select: { id: true, code: true, description: true, isBiologicalFeed: true, inventoryGlAccountId: true, revenueGlAccountId: true },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));
    const fallbackClass = options.defaultClass ?? 'LIVE_POULTRY';
    const classes = new Map<string, ProductClass>();
    const itemRows: UnificationPreview['items'] = [];
    for (const item of items) {
      const sold =
        saleAccountIds.includes(item.inventoryGlAccountId ?? '') ||
        saleAccountIds.includes(item.revenueGlAccountId ?? '') ||
        groups.some((g) => g.itemId === item.id && saleAccountIds.includes(g.glAccountId));
      if (!sold) continue;
      const proposed = proposeClass(item.description, item.code);
      const chosen = options.itemClasses?.[item.id] ?? proposed ?? fallbackClass;
      classes.set(item.id, chosen);
      itemRows.push({ itemId: item.id, code: item.code, description: item.description, proposed, chosen, feed: item.isBiologicalFeed });
    }

    // --- Species by pen, then by farm --------------------------------------
    const populations = await client.livestockGroup.findMany({
      where: { companyId },
      select: { penHouseId: true, farmId: true, speciesKey: true },
    });
    const speciesOfPen = new Map<string, Set<Species>>();
    const speciesOfFarm = new Map<string, Set<Species>>();
    for (const p of populations) {
      const s: Species = p.speciesKey === 'snail' ? 'snail' : 'poultry';
      if (p.penHouseId) speciesOfPen.set(p.penHouseId, (speciesOfPen.get(p.penHouseId) ?? new Set()).add(s));
      speciesOfFarm.set(p.farmId, (speciesOfFarm.get(p.farmId) ?? new Set()).add(s));
    }
    const fallbackSpecies = options.defaultSpecies ?? 'poultry';
    const speciesOf = (g: Group): { species: Species; assumed: boolean; basis: string } => {
      for (const [key, map, what] of [
        [g.penHouseId, speciesOfPen, 'pen'],
        [g.farmId, speciesOfFarm, 'farm'],
      ] as const) {
        const found = key ? map.get(key) : undefined;
        if (found?.size === 1) {
          const [species] = [...found];
          return { species: species!, assumed: false, basis: `${species} ${what}` };
        }
      }
      return { species: fallbackSpecies, assumed: true, basis: `species not known — ${fallbackSpecies} assumed` };
    };

    // --- Where each group goes ----------------------------------------------
    const simple = simpleMoves();
    const classOf = (g: Group) => {
      const chosen = g.itemId ? classes.get(g.itemId) : undefined;
      return chosen
        ? { cls: chosen, assumed: false, basis: PRODUCT_CLASSES[chosen].label }
        : { cls: fallbackClass, assumed: true, basis: `no item — ${PRODUCT_CLASSES[fallbackClass].label} assumed` };
    };
    const target = (g: Group): { to: string; basis: string; assumed: boolean } | null => {
      const n = g.accountNumber;
      if (n === CLEARING) return null;
      if (n === SPLIT.rawMaterials) {
        const item = g.itemId ? itemById.get(g.itemId) : undefined;
        if (!item) return { to: '130100', basis: 'no item — raw materials assumed', assumed: true };
        return item.isBiologicalFeed
          ? { to: '130110', basis: 'feed item', assumed: false }
          : { to: '130100', basis: 'raw material item', assumed: false };
      }
      if ((SPLIT.finishedGoods as readonly string[]).includes(n)) {
        const c = classOf(g);
        return { to: PRODUCT_CLASSES[c.cls].inventory, basis: c.basis, assumed: c.assumed };
      }
      if (n === SPLIT.revenue || n === SPLIT.costOfSales) {
        const c = classOf(g);
        const accounts = PRODUCT_CLASSES[c.cls];
        return { to: n === SPLIT.revenue ? accounts.revenue : accounts.costOfSales, basis: c.basis, assumed: c.assumed };
      }
      if (n === SPLIT.rearing || n === SPLIT.loss) {
        const s = speciesOf(g);
        const map = n === SPLIT.rearing ? BY_SPECIES.rearing : BY_SPECIES.loss;
        return { to: map[s.species], basis: s.basis, assumed: s.assumed };
      }
      const to = simple.get(n);
      return to ? { to, basis: 'same purpose', assumed: false } : null;
    };

    const planned: Plan['groups'] = [];
    const byAccount = new Map<string, { from: string; name: string; balance: bigint; moves: Map<string, Move> }>();
    for (const g of groups) {
      const t = target(g);
      if (!t) continue;
      planned.push({ ...g, to: t.to });
      const account = legacyById.get(g.glAccountId)!;
      const row = byAccount.get(g.accountNumber) ?? { from: g.accountNumber, name: account.name, balance: 0n, moves: new Map() };
      row.balance += g.netKobo;
      const key = `${t.to}|${t.basis}`;
      const move = row.moves.get(key) ?? { to: t.to, amountKobo: 0n, basis: t.basis, assumed: t.assumed };
      move.amountKobo += g.netKobo;
      row.moves.set(key, move);
      byAccount.set(g.accountNumber, row);
    }
    const assumedTotal = planned.length
      ? [...byAccount.values()].flatMap((r) => [...r.moves.values()]).filter((m) => m.assumed)
      : [];
    for (const m of assumedTotal) {
      warnings.push(`${naira(m.amountKobo)} goes to ${m.to} on an assumption (${m.basis}). Check it before running.`);
    }

    // --- Accounts that are neither old nor six-digit ------------------------
    const others = await client.journalLine.groupBy({
      by: ['glAccountId'],
      where: {
        companyId,
        glAccountId: { notIn: legacyIds },
        journalEntry: { status: 'POSTED', journalDate: { lt: cutoverDate } },
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const otherAccounts = await client.gLAccount.findMany({
      where: { companyId, id: { in: others.map((o) => o.glAccountId) } },
      select: { id: true, accountNumber: true, name: true },
    });
    const untouched = others
      .map((o) => ({ account: otherAccounts.find((a) => a.id === o.glAccountId)!, net: (o._sum.debitKobo ?? 0n) - (o._sum.creditKobo ?? 0n) }))
      .filter((o) => o.net !== 0n && !/^\d{6}$/.test(o.account.accountNumber))
      .map((o) => ({ accountNumber: o.account.accountNumber, name: o.account.name, balanceKobo: o.net.toString() }));
    if (untouched.length > 0) {
      warnings.push(`${untouched.length} account(s) outside both charts keep their balances: ${untouched.map((u) => u.accountNumber).join(', ')}.`);
    }

    return {
      preview: {
        cutoverDate: day(cutoverDate),
        chartVersion: version,
        canRun: blockers.length === 0,
        blockers,
        warnings,
        accounts: [...byAccount.values()]
          .sort((a, b) => a.from.localeCompare(b.from))
          .map((r) => ({
            from: r.from,
            name: r.name,
            balanceKobo: r.balance.toString(),
            moves: [...r.moves.values()].map((m) => ({ ...m, amountKobo: m.amountKobo.toString() })),
          })),
        items: itemRows.sort((a, b) => a.code.localeCompare(b.code)),
        untouched,
      },
      groups: planned,
      period: period ? { id: period.id, financialYearId: period.financialYearId } : null,
      classes,
    };
  }

  /* --- Settings that name an account -------------------------------------- */

  private async repoint(
    tx: Prisma.TransactionClient,
    companyId: string,
    classes: Map<string, ProductClass>,
    options: UnificationOptions,
    id: (number: string) => string,
  ): Promise<number> {
    const legacy = await tx.gLAccount.findMany({
      where: { companyId, accountNumber: { in: LEGACY_NUMBERS } },
      select: { id: true, accountNumber: true },
    });
    const fallback = PRODUCT_CLASSES[options.defaultClass ?? 'LIVE_POULTRY'];
    const fallbackSpecies = options.defaultSpecies ?? 'poultry';
    // Where a setting (not a balance) pointing at each old account now points.
    const general = new Map<string, string>(simpleMoves());
    general.set(SPLIT.rawMaterials, '130100');
    for (const n of SPLIT.finishedGoods) general.set(n, fallback.inventory);
    general.set(SPLIT.revenue, fallback.revenue);
    general.set(SPLIT.costOfSales, fallback.costOfSales);
    general.set(SPLIT.rearing, BY_SPECIES.rearing[fallbackSpecies]);
    general.set(SPLIT.loss, BY_SPECIES.loss[fallbackSpecies]);
    const pairs = legacy
      .filter((a) => general.has(a.accountNumber))
      .map((a) => ({ from: a.id, number: a.accountNumber, to: id(general.get(a.accountNumber)!) }));
    const numberOf = new Map(legacy.map((a) => [a.id, a.accountNumber]));

    let count = 0;

    // Items first, by what each is — then anything left by the general map.
    const items = await tx.item.findMany({
      where: {
        companyId,
        OR: [
          { inventoryGlAccountId: { in: pairs.map((p) => p.from) } },
          { revenueGlAccountId: { in: pairs.map((p) => p.from) } },
          { costOfSalesGlAccountId: { in: pairs.map((p) => p.from) } },
          { expenseGlAccountId: { in: pairs.map((p) => p.from) } },
        ],
      },
      select: { id: true, isBiologicalFeed: true, inventoryGlAccountId: true, revenueGlAccountId: true, costOfSalesGlAccountId: true, expenseGlAccountId: true },
    });
    for (const item of items) {
      const cls = classes.get(item.id);
      const map = (current: string | null, kind: 'inventory' | 'revenue' | 'costOfSales' | 'expense'): string | null | undefined => {
        if (!current) return undefined;
        const number = numberOf.get(current);
        if (!number || !general.has(number)) return undefined;
        if (kind === 'inventory' && number === SPLIT.rawMaterials) return id(item.isBiologicalFeed ? '130110' : '130100');
        if (cls && kind !== 'expense' && (SPLIT.finishedGoods as readonly string[]).concat(SPLIT.revenue, SPLIT.costOfSales).includes(number)) {
          return id(PRODUCT_CLASSES[cls][kind]);
        }
        return id(general.get(number)!);
      };
      const data = {
        inventoryGlAccountId: map(item.inventoryGlAccountId, 'inventory'),
        revenueGlAccountId: map(item.revenueGlAccountId, 'revenue'),
        costOfSalesGlAccountId: map(item.costOfSalesGlAccountId, 'costOfSales'),
        expenseGlAccountId: map(item.expenseGlAccountId, 'expense'),
      };
      // A classified item gets its own revenue and cost of sales even if it
      // only borrowed the sales settings' accounts before.
      if (cls) {
        data.revenueGlAccountId ??= id(PRODUCT_CLASSES[cls].revenue);
        data.costOfSalesGlAccountId ??= id(PRODUCT_CLASSES[cls].costOfSales);
      }
      await tx.item.update({ where: { id: item.id }, data });
      count++;
    }
    for (const cls of new Set(classes.values())) {
      const own = [...classes].filter(([, c]) => c === cls).map(([itemId]) => itemId);
      const updated = await tx.item.updateMany({
        where: { companyId, id: { in: own }, OR: [{ revenueGlAccountId: null }, { costOfSalesGlAccountId: null }] },
        data: { revenueGlAccountId: id(PRODUCT_CLASSES[cls].revenue), costOfSalesGlAccountId: id(PRODUCT_CLASSES[cls].costOfSales) },
      });
      count += updated.count;
    }

    // Everything else that names an account: one field at a time.
    for (const { from, to } of pairs) {
      const results = await Promise.all([
        tx.salesConfiguration.updateMany({ where: { companyId, revenueGlAccountId: from }, data: { revenueGlAccountId: to } }),
        tx.salesConfiguration.updateMany({ where: { companyId, costOfSalesGlAccountId: from }, data: { costOfSalesGlAccountId: to } }),
        tx.salesConfiguration.updateMany({ where: { companyId, inventoryGlAccountId: from }, data: { inventoryGlAccountId: to } }),
        tx.salesConfiguration.updateMany({ where: { companyId, receivableGlAccountId: from }, data: { receivableGlAccountId: to } }),
        tx.salesConfiguration.updateMany({ where: { companyId, whtReceivableGlAccountId: from }, data: { whtReceivableGlAccountId: to } }),
        tx.procurementConfiguration.updateMany({ where: { companyId, grniGlAccountId: from }, data: { grniGlAccountId: to } }),
        tx.procurementConfiguration.updateMany({ where: { companyId, payablesGlAccountId: from }, data: { payablesGlAccountId: to } }),
        tx.procurementConfiguration.updateMany({ where: { companyId, whtPayableGlAccountId: from }, data: { whtPayableGlAccountId: to } }),
        tx.salaryComponent.updateMany({ where: { companyId, expenseGlAccountId: from }, data: { expenseGlAccountId: to } }),
        tx.salaryComponent.updateMany({ where: { companyId, payableGlAccountId: from }, data: { payableGlAccountId: to } }),
        tx.bankAccount.updateMany({ where: { companyId, glAccountId: from }, data: { glAccountId: to } }),
        tx.taxGLMapping.updateMany({ where: { companyId, glAccountId: from }, data: { glAccountId: to } }),
        tx.biologicalAssetStageAccount.updateMany({ where: { companyId, glAccountId: from }, data: { glAccountId: to } }),
        tx.recurringJournalLine.updateMany({ where: { recurringJournal: { companyId }, glAccountId: from }, data: { glAccountId: to } }),
      ]);
      count += results.reduce((s, r) => s + r.count, 0);
    }
    return count;
  }

  private async accountIds(client: Prisma.TransactionClient, companyId: string) {
    const all = await client.gLAccount.findMany({ where: { companyId }, select: { id: true, accountNumber: true } });
    return new Map(all.map((a) => [a.accountNumber, a.id]));
  }
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const naira = (k: bigint) => {
  const abs = k < 0n ? -k : k;
  return `${k < 0n ? '-' : ''}NGN ${(abs / 100n).toLocaleString('en-NG')}.${(abs % 100n).toString().padStart(2, '0')}`;
};
