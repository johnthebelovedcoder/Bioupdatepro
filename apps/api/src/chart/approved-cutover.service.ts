import { Injectable, Logger } from '@nestjs/common';
import { AccountType, AuditAction, PeriodStatus, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { PostingControlProvisioningService } from '../posting-control/posting-control-provisioning.service';
import { RearingCostService } from '../biological-assets/rearing-cost.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';
import {
  APPROVED_PROCUREMENT_DEFAULTS,
  APPROVED_SALES_DEFAULTS,
  chartVersionOf,
  poultryStageAccountNumber,
  snailStageAccountNumber,
  Species,
  UnresolvedApprovedAccount,
} from './chart';
import {
  APPROVED_PRODUCT_CLASSES,
  APPROVED_STOCK_ACCOUNTS,
  CROSSWALK,
  crosswalkTargets,
  CrosswalkRule,
  ProductClass,
  PRODUCTION_LOSS_BY_SPECIES,
  proposeProductClass,
  proposeStockClass,
  SNAIL_REARING_EXPENSE,
  StockClass,
} from './approved-crosswalk';

/**
 * The balance cutover from the four- or six-digit chart to the approved
 * five-digit chart (docs/target-coa-decision.md).
 *
 * WHAT IT DOES. Every balance on an old account, as it stands the day before
 * the cutover, is moved to its approved account by a journal dated the cutover
 * (the first day of an open month). Each line keeps the branch, farm, pen,
 * customer, supplier and item it was posted with, so a customer's or an item's
 * history still adds up afterwards. Then every setting that names an old
 * account — items, sales and purchasing settings, salary components, bank
 * accounts, tax mappings, stage accounts, posting keys — is pointed at the
 * approved one, the old accounts are made inactive, and the company is
 * switched to APPROVED. All in one transaction: a half-moved chart is worse
 * than an unmoved one. The posting keys the approved chart relinks are then
 * loaded (idempotent, and safe to repeat if it fails).
 *
 * WHERE THINGS GO: approved-crosswalk.ts. Splits are made by what the item is
 * (stock, products, revenue, cost of sales), by the cohort's stage (poultry
 * rearing cost: 16032 immature, 16042 mature — each cohort's earlier cost is
 * restated into the account of its stage that day), by the species of the pen
 * (biological loss) and by the sign of the balance (fair value). Where the
 * crosswalk leaves a choice the balance cannot settle, the preview names the
 * default and the person may choose another with `overrides`.
 *
 * FINANCE SIGN-OFF. The crosswalk is a recommendation, not Finance's decision
 * (docs/approved-coa-crosswalk-review.csv). The cutover refuses to run until
 * someone gives the name and reference of the approval, and records both.
 */

export interface ApprovedCutoverOptions {
  /** What each sold or stocked item is. Items left out take the proposal from their name, then `defaultClass`. */
  itemClasses?: Record<string, ProductClass>;
  /** For an item nothing else classifies, and for sales lines with no item. */
  defaultClass?: ProductClass;
  /** Raw material, feed, packaging or consumable, by item; the rest take the proposal from their name. */
  stockClasses?: Record<string, StockClass>;
  /** For rearing cost and losses whose species cannot be told. */
  defaultSpecies?: Species;
  /** Source account number → approved account number, for any account, replacing the crosswalk's rule. */
  overrides?: Record<string, string>;
}

export interface FinanceApproval {
  approvedBy: string;
  reference: string;
}

export interface CutoverMove {
  to: string;
  amountKobo: string;
  basis: string;
  assumed: boolean;
}

export interface ApprovedCutoverPreview {
  cutoverDate: string;
  chartVersion: string;
  canRun: boolean;
  blockers: string[];
  warnings: string[];
  accounts: Array<{ from: string; name: string; balanceKobo: string; moves: CutoverMove[] }>;
  items: Array<{ itemId: string; code: string; description: string; productClass: ProductClass | null; proposedProduct: ProductClass | null; stockClass: StockClass | null }>;
  /** Poultry cohorts whose earlier rearing cost is restated into the account of their stage. */
  cohorts: Array<{ groupId: string; code: string; stage: string; account: string; rearingCostKobo: string }>;
  /** Old accounts that will be retired, with or without a balance. */
  retiring: number;
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

interface Part extends Group {
  to: string;
  basis: string;
  assumed: boolean;
}

interface Plan {
  preview: ApprovedCutoverPreview;
  parts: Part[];
  period: { id: string; financialYearId: string } | null;
  productClasses: Map<string, ProductClass>;
  stockClasses: Map<string, StockClass>;
  homes: Array<{ groupId: string; account: string }>;
  fallbackCostCentreId: string | null;
}

const PERIOD_ACCOUNTS: AccountType[] = [AccountType.REVENUE, AccountType.EXPENSE];

/** The snail biological asset accounts by number, for a company with no stage rows to read them from. */
const SNAIL_ASSET_FALLBACK: Record<string, string> = {
  '130200': '16041',
  '130201': '16031',
  '130202': '16031',
  '130203': '16031',
  '130204': '16041',
};

@Injectable()
export class ApprovedCutoverService {
  private readonly logger = new Logger(ApprovedCutoverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly provisioning: PostingControlProvisioningService,
    private readonly rearing: RearingCostService,
  ) {}

  /** The first day of the earliest open month that has not started yet. */
  async suggestedCutover(companyId: string, today = new Date()): Promise<Date | null> {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { financialYear: { companyId }, status: PeriodStatus.OPEN, startDate: { gt: today } },
      orderBy: { startDate: 'asc' },
    });
    return period?.startDate ?? null;
  }

  async preview(companyId: string, cutoverDate: Date, options: ApprovedCutoverOptions = {}): Promise<ApprovedCutoverPreview> {
    return (await this.plan(this.prisma, companyId, cutoverDate, options)).preview;
  }

  async run(params: {
    companyId: string;
    cutoverDate: Date;
    options?: ApprovedCutoverOptions;
    approval: FinanceApproval;
    actor: WorkflowActor;
  }) {
    const { companyId, cutoverDate, actor } = params;
    const options = params.options ?? {};
    const approval = { approvedBy: params.approval?.approvedBy?.trim() ?? '', reference: params.approval?.reference?.trim() ?? '' };
    if (!approval.approvedBy || !approval.reference) {
      throw new AccountingRuleViolation(
        'Approved chart cutover',
        'Finance has not approved the account crosswalk yet. Give who approved it and the reference of the approval (docs/approved-coa-crosswalk-review.csv); both are recorded.',
        {},
      );
    }

    // The approved accounts must exist before anything can move into them.
    // Idempotent, and harmless if the cutover then refuses.
    await this.provisioning.provision(companyId, actor.userId);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const plan = await this.plan(tx, companyId, cutoverDate, options);
        if (!plan.preview.canRun) {
          throw new AccountingRuleViolation('Approved chart cutover', `The cutover cannot run: ${plan.preview.blockers.join(' | ')}`, {
            blockers: plan.preview.blockers,
          });
        }
        const period = plan.period!;
        const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { baseCurrencyId: true } });
        const accounts = await this.accountIds(tx, companyId);
        const id = (number: string) => {
          const found = accounts.get(number);
          if (!found) throw new AccountingRuleViolation('Approved chart cutover', `Account ${number} does not exist for this company.`, {});
          return found;
        };

        // --- 1. One journal per branch (a journal's lines share its branch) -
        const journals: string[] = [];
        const byBranch = new Map<string, Part[]>();
        for (const part of plan.parts) byBranch.set(part.branchId, [...(byBranch.get(part.branchId) ?? []), part]);
        for (const [branchId, parts] of byBranch) {
          const header = {
            companyId,
            branchId,
            financialYearId: period.financialYearId,
            financialPeriodId: period.id,
            currencyId: company.baseCurrencyId,
            exchangeRate: '1.00000000',
          };
          const lines = parts.flatMap((part) => {
            const dimensions = {
              ...header,
              departmentId: part.departmentId,
              costCentreId: part.costCentreId,
              farmId: part.farmId,
              penHouseId: part.penHouseId,
              projectId: part.projectId,
              customerId: part.customerId,
              supplierId: part.supplierId,
              employeeId: part.employeeId,
              itemId: part.itemId,
            };
            // The approved account may require a cost centre the old one never did.
            const targetDimensions = dimensions.costCentreId ? dimensions : { ...dimensions, costCentreId: plan.fallbackCostCentreId };
            const amount = kobo(part.netKobo > 0n ? part.netKobo : -part.netKobo);
            const debitBalance = part.netKobo > 0n;
            return [
              { glAccountId: part.glAccountId, description: `Approved chart cutover — ${part.accountNumber} to ${part.to}`, dimensions, ...(debitBalance ? { credit: amount } : { debit: amount }) },
              { glAccountId: id(part.to), description: `Approved chart cutover — from ${part.accountNumber}`, dimensions: targetDimensions, ...(debitBalance ? { debit: amount } : { credit: amount }) },
            ];
          });
          const branch = await tx.branch.findUniqueOrThrow({ where: { id: branchId }, select: { code: true } });
          const posted = await this.posting.post(
            {
              sourceModule: 'chart',
              sourceDocumentType: 'ApprovedChartCutover',
              sourceDocumentId: companyId,
              journalNumber: `COA5-${branch.code}-${cutoverDate.toISOString().slice(0, 10)}`,
              journalDate: cutoverDate,
              narration: 'Approved chart cutover: balances moved to the five-digit chart',
              ...header,
              idempotencyKey: `approved-chart-cutover:${companyId}:${branchId}`,
              actor,
              lines,
            },
            tx,
          );
          journals.push(posted.journalEntryId);
        }

        // --- 2. Point every setting at the approved accounts ---------------
        const repointed = await this.repoint(tx, companyId, plan, options, id);

        // --- 3. Restate each poultry cohort's earlier rearing cost ---------
        for (const home of plan.homes) {
          await tx.livestockGroup.update({ where: { id: home.groupId }, data: { rearingHomeAccount: home.account } });
        }

        // --- 4. Retire the old accounts and switch --------------------------
        const retired = await tx.gLAccount.updateMany({
          where: { companyId, approvedStatement: null, active: true },
          data: { active: false },
        });
        await tx.company.update({ where: { id: companyId }, data: { chartVersion: 'APPROVED' } });

        await this.audit.write(
          {
            transactionId: companyId,
            module: 'chart',
            entityType: 'Company',
            entityId: companyId,
            status: 'APPROVED',
            action: AuditAction.UPDATE,
            userId: actor.userId,
            comments:
              `Moved to the approved five-digit chart from ${cutoverDate.toISOString().slice(0, 10)} ` +
              `(crosswalk approved by ${approval.approvedBy}, ref ${approval.reference}): ` +
              `${plan.parts.length} balances moved in ${journals.length} journal(s), ${repointed} settings repointed, ` +
              `${retired.count} old accounts retired, ${plan.homes.length} poultry cohorts restated.`,
            metadata: {
              journals,
              repointed,
              retired: retired.count,
              approval,
              cohorts: plan.homes.length,
              itemClasses: Object.fromEntries(plan.productClasses),
              overrides: options.overrides ?? {},
            },
          },
          tx,
        );
        return { journals, moved: plan.parts.length, repointed, retired: retired.count, cohorts: plan.homes.length, preview: plan.preview };
      },
      { timeout: 180_000 },
    );

    // The company is on the approved chart now: link the posting keys and
    // sales and procurement defaults it carries. Idempotent — run it again if
    // this fails; nothing above depends on it.
    const provisioned = await this.provisioning.provision(companyId, actor.userId);
    this.logger.log(`Company ${companyId} moved to the approved chart (${result.journals.length} journals).`);
    return { ...result, provisioned };
  }

  /* --- The plan: what moves where ----------------------------------------- */

  private async plan(client: Prisma.TransactionClient, companyId: string, cutoverDate: Date, options: ApprovedCutoverOptions): Promise<Plan> {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const version = await chartVersionOf(client, companyId);
    if (version === 'APPROVED') blockers.push('This company is already on the approved five-digit chart.');
    const overrides = options.overrides ?? {};

    // --- The month the cutover opens ---------------------------------------
    const period = await client.financialPeriod.findFirst({
      where: { financialYear: { companyId }, startDate: cutoverDate },
      include: { financialYear: true },
    });
    if (!period) blockers.push(`No financial period starts on ${day(cutoverDate)}. The cutover must be the first day of a month that is set up.`);
    else if (period.status !== PeriodStatus.OPEN) blockers.push(`${period.name} is ${period.status.toLowerCase()}; the cutover month must be open.`);

    // --- Source accounts: everything the approved workbook did not load ----
    const allAccounts = await client.gLAccount.findMany({
      where: { companyId },
      select: { id: true, accountNumber: true, name: true, accountType: true, approvedStatement: true, active: true, requiresCostCentre: true },
    });
    const sources = allAccounts.filter((a) => a.approvedStatement === null);
    const sourceById = new Map(sources.map((a) => [a.id, a]));
    const targetByNumber = new Map(allAccounts.filter((a) => a.approvedStatement !== null).map((a) => [a.accountNumber, a]));
    const sourceIds = sources.map((a) => a.id);

    // --- The approved accounts any rule can reach must be loaded and active -
    const wanted = new Set([...crosswalkTargets(), ...Object.values(overrides)]);
    const missing = [...wanted].filter((n) => !targetByNumber.get(n)?.active);
    if (missing.length > 0) blockers.push(`These approved accounts are not loaded or not active for this company: ${missing.sort().join(', ')}. Load the approved chart first.`);
    for (const [from, to] of Object.entries(overrides)) {
      if (!targetByNumber.has(to)) blockers.push(`Override ${from} → ${to}: ${to} is not an account on the approved chart.`);
    }

    // --- Nothing may already sit on an old account on or after the cutover --
    const late = await client.journalLine.count({
      where: { companyId, glAccountId: { in: sourceIds }, journalEntry: { status: 'POSTED', journalDate: { gte: cutoverDate } } },
    });
    if (late > 0) blockers.push(`${late} line(s) on the old accounts are dated on or after ${day(cutoverDate)}. Pick a later cutover, or reverse them.`);

    // --- Revenue and expense of an earlier, unclosed year have nowhere to go -
    const yearStart = period?.financialYear.startDate ?? cutoverDate;
    const periodIds = sources.filter((a) => PERIOD_ACCOUNTS.includes(a.accountType)).map((a) => a.id);
    const earlier = await client.journalLine.groupBy({
      by: ['glAccountId'],
      where: { companyId, glAccountId: { in: periodIds }, journalEntry: { status: 'POSTED', journalDate: { lt: yearStart } } },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const unclosed = earlier.filter((row) => (row._sum.debitKobo ?? 0n) !== (row._sum.creditKobo ?? 0n));
    if (unclosed.length > 0) {
      blockers.push(
        `Income or expense from before ${day(yearStart)} is still open on ${unclosed.map((row) => sourceById.get(row.glAccountId)!.accountNumber).join(', ')}. Close the earlier financial year first.`,
      );
    }

    // --- Balances, per account and dimension set ---------------------------
    // Balance-sheet accounts: everything before the cutover. Income and
    // expense: this financial year only.
    const lines = await client.journalLine.groupBy({
      by: ['glAccountId', 'branchId', 'departmentId', 'costCentreId', 'farmId', 'penHouseId', 'projectId', 'customerId', 'supplierId', 'employeeId', 'itemId'],
      where: {
        companyId,
        glAccountId: { in: sourceIds },
        journalEntry: { status: 'POSTED', journalDate: { lt: cutoverDate } },
        OR: [{ glAccount: { accountType: { notIn: PERIOD_ACCOUNTS } } }, { journalEntry: { journalDate: { gte: yearStart } } }],
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    const groups: Group[] = lines
      .map((row) => ({
        glAccountId: row.glAccountId,
        accountNumber: sourceById.get(row.glAccountId)!.accountNumber,
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

    const ruleOf = (number: string): CrosswalkRule | null => {
      const chosen = overrides[number];
      if (chosen) return { kind: 'one', to: chosen };
      return CROSSWALK[number] ?? null;
    };

    // --- What each item is --------------------------------------------------
    const productKinds = new Set(sources.filter((a) => ruleOf(a.accountNumber)?.kind === 'product').map((a) => a.id));
    const stockKinds = new Set(sources.filter((a) => ruleOf(a.accountNumber)?.kind === 'stock').map((a) => a.id));
    const itemIds = new Set(groups.map((g) => g.itemId).filter((i): i is string => !!i));
    const accountScope = [...productKinds, ...stockKinds];
    const items = await client.item.findMany({
      where: {
        companyId,
        OR: [
          { id: { in: [...itemIds] } },
          { inventoryGlAccountId: { in: accountScope } },
          { revenueGlAccountId: { in: accountScope } },
          { costOfSalesGlAccountId: { in: accountScope } },
        ],
      },
      select: { id: true, code: true, description: true, isBiologicalFeed: true, inventoryGlAccountId: true, revenueGlAccountId: true, costOfSalesGlAccountId: true },
    });
    const itemById = new Map(items.map((i) => [i.id, i]));
    const fallbackClass = options.defaultClass ?? 'LIVE_POULTRY';
    const productClasses = new Map<string, ProductClass>();
    const stockClasses = new Map<string, StockClass>();
    const itemRows: ApprovedCutoverPreview['items'] = [];
    for (const item of items) {
      const isProduct =
        productKinds.has(item.inventoryGlAccountId ?? '') ||
        productKinds.has(item.revenueGlAccountId ?? '') ||
        productKinds.has(item.costOfSalesGlAccountId ?? '') ||
        groups.some((g) => g.itemId === item.id && productKinds.has(g.glAccountId));
      const isStock = stockKinds.has(item.inventoryGlAccountId ?? '') || groups.some((g) => g.itemId === item.id && stockKinds.has(g.glAccountId));
      if (!isProduct && !isStock) continue;
      const proposedProduct = proposeProductClass(item.description, item.code);
      const productClass = isProduct ? (options.itemClasses?.[item.id] ?? proposedProduct ?? fallbackClass) : null;
      if (productClass) productClasses.set(item.id, productClass);
      const stockClass = isStock ? (options.stockClasses?.[item.id] ?? proposeStockClass(item.description, item.code, item.isBiologicalFeed)) : null;
      if (stockClass) stockClasses.set(item.id, stockClass);
      itemRows.push({ itemId: item.id, code: item.code, description: item.description, productClass, proposedProduct, stockClass });
    }

    // --- Stock lines that carry no item ------------------------------------
    // Shared by what the stock ledger holds for the items on that account, so
    // each approved inventory control ties to its own items afterwards.
    const stockSources = sources.filter((a) => ruleOf(a.accountNumber)?.kind === 'stock').map((a) => a.id);
    const stockHeld = await client.item.findMany({
      where: { companyId, inventoryGlAccountId: { in: stockSources } },
      select: { id: true, code: true, description: true, isBiologicalFeed: true, inventoryGlAccountId: true },
    });
    const stockMoves = await client.stockMovement.groupBy({
      by: ['itemId', 'direction'],
      where: { companyId, itemId: { in: stockHeld.map((i) => i.id) } },
      _sum: { valueKobo: true },
    });
    const stockValue = new Map<string, bigint>();
    for (const m of stockMoves) stockValue.set(m.itemId, (stockValue.get(m.itemId) ?? 0n) + (m.direction === 'IN' ? 1n : -1n) * (m._sum.valueKobo ?? 0n));
    const stockWeights = new Map<string, Array<{ account: string; weight: bigint }>>();
    for (const item of stockHeld) {
      const value = stockValue.get(item.id) ?? 0n;
      if (value <= 0n) continue;
      const cls = options.stockClasses?.[item.id] ?? stockClasses.get(item.id) ?? proposeStockClass(item.description, item.code, item.isBiologicalFeed);
      const account = APPROVED_STOCK_ACCOUNTS[cls];
      const list = stockWeights.get(item.inventoryGlAccountId!) ?? [];
      const existing = list.find((w) => w.account === account);
      if (existing) existing.weight += value;
      else list.push({ account, weight: value });
      stockWeights.set(item.inventoryGlAccountId!, list);
    }

    // --- Species by pen, then by farm --------------------------------------
    const populations = await client.livestockGroup.findMany({
      where: { companyId },
      select: { id: true, code: true, branchId: true, penHouseId: true, farmId: true, speciesKey: true, stage: true, status: true, population: true },
    });
    const speciesOfPen = new Map<string, Set<Species>>();
    const speciesOfFarm = new Map<string, Set<Species>>();
    const speciesName = (key: string): Species => (key.trim().toLowerCase() === 'snail' ? 'snail' : 'poultry');
    for (const p of populations) {
      const s = speciesName(p.speciesKey);
      if (p.penHouseId) speciesOfPen.set(p.penHouseId, (speciesOfPen.get(p.penHouseId) ?? new Set()).add(s));
      speciesOfFarm.set(p.farmId, (speciesOfFarm.get(p.farmId) ?? new Set()).add(s));
    }
    const fallbackSpecies = options.defaultSpecies ?? 'poultry';
    const speciesOf = (g: Group): { species: Species; assumed: boolean; basis: string } => {
      for (const [key, map, what] of [[g.penHouseId, speciesOfPen, 'pen'], [g.farmId, speciesOfFarm, 'farm']] as const) {
        const found = key ? map.get(key) : undefined;
        if (found?.size === 1) {
          const [species] = [...found];
          return { species: species!, assumed: false, basis: `${species} ${what}` };
        }
      }
      return { species: fallbackSpecies, assumed: true, basis: `species not known — ${fallbackSpecies} assumed` };
    };

    // --- Poultry cohorts: the account of each one's stage -------------------
    // A cohort's earlier rearing cost is what the old chart held for it; the
    // approved chart holds it by stage. Each cohort goes to the account of
    // its stage today (the cutover is the first day of the month), and a
    // balance on the old rearing account is shared among the cohorts of its
    // pen (or farm) in proportion to the cost each one carries.
    const poultry = populations.filter((p) => speciesName(p.speciesKey) === 'poultry' && p.status === 'ACTIVE');
    const cohortAccount = new Map<string, string>();
    for (const cohort of poultry) {
      try {
        cohortAccount.set(cohort.id, poultryStageAccountNumber(cohort.stage));
      } catch (e) {
        if (!(e instanceof UnresolvedApprovedAccount)) throw e;
        blockers.push(`Poultry cohort ${cohort.code} is at stage "${cohort.stage}", which is not classed as immature or mature (POULTRY_STAGE_MATURITY).`);
      }
    }
    const cohortCost = new Map<string, bigint>();
    for (const cohort of poultry) cohortCost.set(cohort.id, await this.rearing.remaining(cohort.id, client));

    const rearingShares = (g: Group): Array<{ account: string; weight: bigint }> => {
      const here = poultry.filter((p) => (g.penHouseId && p.penHouseId === g.penHouseId) || (!g.penHouseId && g.farmId && p.farmId === g.farmId));
      const farm = poultry.filter((p) => g.farmId && p.farmId === g.farmId);
      // A balance posted with no pen or farm is shared across the branch's poultry cohorts.
      const pool = here.length > 0 ? here : farm.length > 0 ? farm : poultry.filter((p) => p.branchId === g.branchId);
      const byAccount = new Map<string, bigint>();
      for (const p of pool) {
        const account = cohortAccount.get(p.id);
        if (!account) continue;
        byAccount.set(account, (byAccount.get(account) ?? 0n) + (cohortCost.get(p.id) ?? 0n));
      }
      let shares = [...byAccount].map(([account, weight]) => ({ account, weight }));
      if (shares.every((s) => s.weight === 0n)) {
        // No cost recorded against them: share by head count instead.
        const heads = new Map<string, bigint>();
        for (const p of pool) {
          const account = cohortAccount.get(p.id);
          if (account) heads.set(account, (heads.get(account) ?? 0n) + BigInt(Math.max(p.population, 0)));
        }
        shares = [...heads].map(([account, weight]) => ({ account, weight }));
      }
      if (shares.every((s) => s.weight === 0n)) {
        // Neither cost nor animals left (a flock harvested or sold): the stage of the cohorts that are there decides.
        shares = [...new Set(pool.map((p) => cohortAccount.get(p.id)).filter((a): a is string => !!a))].map((account) => ({ account, weight: 1n }));
      }
      return shares.filter((s) => s.weight > 0n);
    };

    // --- Snail asset accounts: the stage rows say which stage each holds ----
    const stageRows = await client.biologicalAssetStageAccount.findMany({
      where: { companyId, speciesKey: 'snail' },
      select: { stage: true, glAccountId: true },
    });
    const snailAssetTarget = (number: string, accountId: string): { to: string; basis: string; assumed: boolean } | null => {
      const stages = stageRows.filter((r) => r.glAccountId === accountId).map((r) => r.stage);
      const targets = new Set<string>();
      for (const stage of stages) {
        try {
          targets.add(snailStageAccountNumber(stage));
        } catch (e) {
          if (!(e instanceof UnresolvedApprovedAccount)) throw e;
          blockers.push(`Snail stage "${stage}" (held in ${number}) is not classed as immature or mature (SNAIL_STAGE_MATURITY).`);
        }
      }
      if (targets.size === 1) return { to: [...targets][0]!, basis: `${stages.join(', ')} stage`, assumed: false };
      if (targets.size > 1) {
        blockers.push(`${number} holds both immature and mature snail stages; choose where it goes with an override.`);
        return null;
      }
      const fallback = SNAIL_ASSET_FALLBACK[number];
      return fallback ? { to: fallback, basis: 'stage account by number', assumed: true } : null;
    };

    // --- Where each group goes ----------------------------------------------
    const classOf = (g: Group) => {
      const chosen = g.itemId ? productClasses.get(g.itemId) : undefined;
      return chosen
        ? { cls: chosen, assumed: false, basis: APPROVED_PRODUCT_CLASSES[chosen].label }
        : { cls: fallbackClass, assumed: true, basis: `no item — ${APPROVED_PRODUCT_CLASSES[fallbackClass].label} assumed` };
    };

    const parts: Part[] = [];
    const unmapped = new Set<string>();
    const blocked = new Map<string, string>();
    for (const g of groups) {
      const rule = ruleOf(g.accountNumber);
      if (!rule) {
        unmapped.add(g.accountNumber);
        continue;
      }
      const add = (to: string, basis: string, assumed: boolean, amount = g.netKobo) => parts.push({ ...g, netKobo: amount, to, basis, assumed });
      switch (rule.kind) {
        case 'one':
          add(rule.to, overrides[g.accountNumber] ? 'chosen by the person running the cutover' : 'same purpose', false);
          break;
        case 'pick':
          add(rule.to, `${rule.why} — ${rule.to} assumed`, true);
          break;
        case 'stock': {
          const cls = (g.itemId ? stockClasses.get(g.itemId) : undefined) ?? null;
          const weights = stockWeights.get(g.glAccountId);
          if (cls) add(APPROVED_STOCK_ACCOUNTS[cls], `${cls.toLowerCase()} item`, false);
          else if (weights && weights.length > 0) {
            for (const part of allocate(g.netKobo, weights)) add(part.account, 'no item on the line — shared by the stock ledger’s value of each item type', false, part.amount);
          } else add(APPROVED_STOCK_ACCOUNTS.RAW, 'no item — raw materials assumed', true);
          break;
        }
        case 'product': {
          const c = classOf(g);
          add(APPROVED_PRODUCT_CLASSES[c.cls][rule.part], c.basis, c.assumed);
          break;
        }
        case 'fairValue':
          add(g.netKobo < 0n ? '42000' : '42100', g.netKobo < 0n ? 'fair-value gain' : 'fair-value loss', false);
          break;
        case 'productionLoss': {
          const s = speciesOf(g);
          add(PRODUCTION_LOSS_BY_SPECIES[s.species], s.basis, s.assumed);
          break;
        }
        case 'snailAsset': {
          const t = snailAssetTarget(g.accountNumber, g.glAccountId);
          if (t) add(t.to, t.basis, t.assumed);
          else unmapped.add(g.accountNumber);
          break;
        }
        case 'rearing': {
          const s = rule.speciesKnown ? { species: rule.speciesKnown, assumed: false, basis: 'poultry asset' } : speciesOf(g);
          if (s.species === 'snail') {
            add(SNAIL_REARING_EXPENSE, 'snail cost is expensed on the approved chart', s.assumed);
            break;
          }
          const shares = rearingShares(g);
          if (shares.length === 0) {
            add('16032', `${s.basis}; no cohort found for this pen — immature assumed`, true);
            break;
          }
          for (const part of allocate(g.netKobo, shares)) {
            const place = g.penHouseId ? 'pen' : g.farmId ? 'farm' : 'branch';
            add(part.account, `${s.basis}; share of the cohorts in this ${place} at ${part.account === '16032' ? 'an immature' : 'a mature'} stage`, s.assumed || !g.penHouseId, part.amount);
          }
          break;
        }
        case 'blocked':
          blocked.set(g.accountNumber, rule.why);
          break;
      }
    }
    for (const [number, why] of blocked) blockers.push(`${number}: ${why}`);
    if (unmapped.size > 0) {
      blockers.push(`No approved account is named for ${[...unmapped].sort().join(', ')}, which hold a balance. Choose where each goes with an override.`);
    }

    // --- Cost centre: the approved account may require one the old did not -
    const fallbackCentre = await client.costCentre.findFirst({
      where: { companyId, active: true, postingAllowed: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true },
    });
    const needsCentre = parts.filter((p) => !p.costCentreId && targetByNumber.get(p.to)?.requiresCostCentre);
    if (needsCentre.length > 0) {
      if (!fallbackCentre) {
        blockers.push(`${needsCentre.length} balance(s) go to accounts that need a cost centre and the company has no active cost centre that allows posting.`);
      } else {
        warnings.push(`${needsCentre.length} balance(s) had no cost centre and go to accounts that require one; they take cost centre ${fallbackCentre.code}.`);
      }
    }

    // --- Summary -------------------------------------------------------------
    const byAccount = new Map<string, { from: string; name: string; balance: bigint; moves: Map<string, { to: string; amount: bigint; basis: string; assumed: boolean }> }>();
    for (const p of parts) {
      const account = sourceById.get(p.glAccountId)!;
      const row = byAccount.get(p.accountNumber) ?? { from: p.accountNumber, name: account.name, balance: 0n, moves: new Map() };
      row.balance += p.netKobo;
      const key = `${p.to}|${p.basis}`;
      const move = row.moves.get(key) ?? { to: p.to, amount: 0n, basis: p.basis, assumed: p.assumed };
      move.amount += p.netKobo;
      row.moves.set(key, move);
      byAccount.set(p.accountNumber, row);
    }
    for (const row of byAccount.values()) {
      for (const m of row.moves.values()) if (m.assumed && m.amount !== 0n) warnings.push(`${naira(m.amount)} from ${row.from} goes to ${m.to} on an assumption (${m.basis}). Check it, or choose another account with an override.`);
    }
    const homes = poultry.filter((p) => cohortAccount.has(p.id)).map((p) => ({ groupId: p.id, account: cohortAccount.get(p.id)! }));
    const rearingAccounts = new Set(Object.entries(CROSSWALK).filter(([, r]) => r.kind === 'rearing').map(([n]) => n));
    const touchesRearing = parts.some((p) => rearingAccounts.has(p.accountNumber));
    const cohorts = touchesRearing
      ? poultry
          .filter((p) => cohortAccount.has(p.id))
          .map((p) => ({ groupId: p.id, code: p.code, stage: p.stage, account: cohortAccount.get(p.id)!, rearingCostKobo: (cohortCost.get(p.id) ?? 0n).toString() }))
      : [];

    return {
      preview: {
        cutoverDate: day(cutoverDate),
        chartVersion: version,
        canRun: blockers.length === 0,
        blockers: [...new Set(blockers)],
        warnings,
        accounts: [...byAccount.values()]
          .sort((a, b) => a.from.localeCompare(b.from))
          .map((r) => ({
            from: r.from,
            name: r.name,
            balanceKobo: r.balance.toString(),
            moves: [...r.moves.values()].map((m) => ({ to: m.to, amountKobo: m.amount.toString(), basis: m.basis, assumed: m.assumed })),
          })),
        items: itemRows.sort((a, b) => a.code.localeCompare(b.code)),
        cohorts,
        retiring: sources.filter((a) => a.active).length,
      },
      parts,
      period: period ? { id: period.id, financialYearId: period.financialYearId } : null,
      productClasses,
      stockClasses,
      homes: touchesRearing ? homes : [],
      fallbackCostCentreId: fallbackCentre?.id ?? null,
    };
  }

  /* --- Settings that name an account -------------------------------------- */

  /** Where a setting (not a balance) pointing at an old account now points; null where no single account can be named. */
  private generalTarget(number: string, options: ApprovedCutoverOptions): string | null {
    const rule = options.overrides?.[number] ? ({ kind: 'one', to: options.overrides[number]! } as CrosswalkRule) : CROSSWALK[number];
    if (!rule) return null;
    const fallback = APPROVED_PRODUCT_CLASSES[options.defaultClass ?? 'LIVE_POULTRY'];
    switch (rule.kind) {
      case 'one':
      case 'pick':
        return rule.to;
      case 'stock':
        return APPROVED_STOCK_ACCOUNTS.RAW;
      case 'product':
        return fallback[rule.part];
      case 'rearing':
        return '16032';
      case 'fairValue':
        return '42000';
      case 'productionLoss':
        return PRODUCTION_LOSS_BY_SPECIES[options.defaultSpecies ?? 'poultry'];
      case 'snailAsset':
        return SNAIL_ASSET_FALLBACK[number] ?? null;
      case 'blocked':
        return null;
    }
  }

  private async repoint(tx: Prisma.TransactionClient, companyId: string, plan: Plan, options: ApprovedCutoverOptions, id: (number: string) => string): Promise<number> {
    const sources = await tx.gLAccount.findMany({ where: { companyId, approvedStatement: null }, select: { id: true, accountNumber: true } });
    const pairs = sources
      .map((a) => ({ from: a.id, number: a.accountNumber, target: this.generalTarget(a.accountNumber, options) }))
      .filter((p): p is { from: string; number: string; target: string } => p.target !== null)
      .map((p) => ({ from: p.from, number: p.number, to: id(p.target) }));
    const numberOf = new Map(sources.map((a) => [a.id, a.accountNumber]));
    const toNumber = new Map(pairs.map((p) => [p.from, p]));
    let count = 0;

    // --- Items, by what each is — then anything left by the general map -----
    const items = await tx.item.findMany({
      where: {
        companyId,
        OR: ['inventoryGlAccountId', 'revenueGlAccountId', 'costOfSalesGlAccountId', 'expenseGlAccountId'].map((field) => ({ [field]: { in: pairs.map((p) => p.from) } })),
      },
      select: { id: true, inventoryGlAccountId: true, revenueGlAccountId: true, costOfSalesGlAccountId: true, expenseGlAccountId: true },
    });
    for (const item of items) {
      const product = plan.productClasses.get(item.id);
      const stock = plan.stockClasses.get(item.id);
      const map = (current: string | null, kind: 'inventory' | 'revenue' | 'costOfSales' | 'expense'): string | undefined => {
        if (!current) return undefined;
        const number = numberOf.get(current);
        const rule = number ? CROSSWALK[number] : undefined;
        if (!number || !toNumber.has(current)) return undefined;
        if (options.overrides?.[number]) return toNumber.get(current)!.to;
        if (rule?.kind === 'stock' && stock) return id(APPROVED_STOCK_ACCOUNTS[stock]);
        if (rule?.kind === 'product' && product && kind !== 'expense') return id(APPROVED_PRODUCT_CLASSES[product][kind]);
        return toNumber.get(current)!.to;
      };
      await tx.item.update({
        where: { id: item.id },
        data: {
          inventoryGlAccountId: map(item.inventoryGlAccountId, 'inventory'),
          revenueGlAccountId: map(item.revenueGlAccountId, 'revenue'),
          costOfSalesGlAccountId: map(item.costOfSalesGlAccountId, 'costOfSales'),
          expenseGlAccountId: map(item.expenseGlAccountId, 'expense'),
        },
      });
      count++;
    }
    // A classified product with no revenue or cost-of-sales account of its own takes its class's.
    for (const cls of new Set(plan.productClasses.values())) {
      const own = [...plan.productClasses].filter(([, c]) => c === cls).map(([itemId]) => itemId);
      const updated = await tx.item.updateMany({
        where: { companyId, id: { in: own }, OR: [{ revenueGlAccountId: null }, { costOfSalesGlAccountId: null }] },
        data: { revenueGlAccountId: id(APPROVED_PRODUCT_CLASSES[cls].revenue), costOfSalesGlAccountId: id(APPROVED_PRODUCT_CLASSES[cls].costOfSales) },
      });
      count += updated.count;
    }

    // --- Everything else that names an account -------------------------------
    const salesDefault = (n: string) => id(n);
    for (const { from, to } of pairs) {
      const results = await Promise.all([
        tx.salesConfiguration.updateMany({ where: { companyId, revenueGlAccountId: from }, data: { revenueGlAccountId: salesDefault(APPROVED_SALES_DEFAULTS.revenue) } }),
        tx.salesConfiguration.updateMany({ where: { companyId, costOfSalesGlAccountId: from }, data: { costOfSalesGlAccountId: salesDefault(APPROVED_SALES_DEFAULTS.costOfSales) } }),
        tx.salesConfiguration.updateMany({ where: { companyId, inventoryGlAccountId: from }, data: { inventoryGlAccountId: salesDefault(APPROVED_SALES_DEFAULTS.inventory) } }),
        tx.salesConfiguration.updateMany({ where: { companyId, receivableGlAccountId: from }, data: { receivableGlAccountId: salesDefault(APPROVED_SALES_DEFAULTS.receivable) } }),
        tx.salesConfiguration.updateMany({ where: { companyId, whtReceivableGlAccountId: from }, data: { whtReceivableGlAccountId: salesDefault(APPROVED_SALES_DEFAULTS.whtReceivable) } }),
        tx.procurementConfiguration.updateMany({ where: { companyId, grniGlAccountId: from }, data: { grniGlAccountId: salesDefault(APPROVED_PROCUREMENT_DEFAULTS.grni) } }),
        tx.procurementConfiguration.updateMany({ where: { companyId, payablesGlAccountId: from }, data: { payablesGlAccountId: salesDefault(APPROVED_PROCUREMENT_DEFAULTS.payables) } }),
        tx.procurementConfiguration.updateMany({ where: { companyId, whtPayableGlAccountId: from }, data: { whtPayableGlAccountId: salesDefault(APPROVED_PROCUREMENT_DEFAULTS.whtPayable) } }),
        tx.salaryComponent.updateMany({ where: { companyId, expenseGlAccountId: from }, data: { expenseGlAccountId: to } }),
        tx.salaryComponent.updateMany({ where: { companyId, payableGlAccountId: from }, data: { payableGlAccountId: to } }),
        tx.bankAccount.updateMany({ where: { companyId, glAccountId: from }, data: { glAccountId: to } }),
        tx.taxGLMapping.updateMany({ where: { companyId, glAccountId: from }, data: { glAccountId: to } }),
        tx.recurringJournalLine.updateMany({ where: { recurringJournal: { companyId }, glAccountId: from }, data: { glAccountId: to } }),
        tx.costPoolSource.updateMany({ where: { pool: { companyId }, glAccountId: from }, data: { glAccountId: to } }),
        tx.postingKey.updateMany({ where: { companyId, glAccountId: from }, data: { glAccountId: to } }),
      ]);
      count += results.reduce((s, r) => s + r.count, 0);
    }

    // --- Biological asset stage accounts: by stage, not by account ----------
    const stageRows = await tx.biologicalAssetStageAccount.findMany({ where: { companyId, glAccountId: { in: pairs.map((p) => p.from) } } });
    for (const row of stageRows) {
      const to = biologicalStageTarget(row.speciesKey, row.stage);
      if (!to) continue;
      await tx.biologicalAssetStageAccount.update({ where: { id: row.id }, data: { glAccountId: id(to) } });
      count++;
    }
    return count;
  }

  private async accountIds(client: Prisma.TransactionClient, companyId: string) {
    const all = await client.gLAccount.findMany({ where: { companyId }, select: { id: true, accountNumber: true } });
    return new Map(all.map((a) => [a.accountNumber, a.id]));
  }
}

function biologicalStageTarget(speciesKey: string, stage: string): string | null {
  try {
    return speciesKey.trim().toLowerCase() === 'snail' ? snailStageAccountNumber(stage) : poultryStageAccountNumber(stage);
  } catch (e) {
    if (e instanceof UnresolvedApprovedAccount) return null;
    throw e;
  }
}

/** Share a signed amount across accounts in proportion to their weights, to the kobo, largest remainder first. */
export function allocate(amount: bigint, shares: Array<{ account: string; weight: bigint }>): Array<{ account: string; amount: bigint }> {
  const sign = amount < 0n ? -1n : 1n;
  const abs = amount < 0n ? -amount : amount;
  const total = shares.reduce((s, x) => s + x.weight, 0n);
  const rows = shares.map((x) => ({ account: x.account, amount: (abs * x.weight) / total, remainder: (abs * x.weight) % total }));
  let left = abs - rows.reduce((s, r) => s + r.amount, 0n);
  for (const r of [...rows].sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : 0))) {
    if (left === 0n) break;
    r.amount += 1n;
    left -= 1n;
  }
  return rows.filter((r) => r.amount > 0n).map((r) => ({ account: r.account, amount: sign * r.amount }));
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const naira = (k: bigint) => {
  const abs = k < 0n ? -k : k;
  return `${k < 0n ? '-' : ''}NGN ${(abs / 100n).toLocaleString('en-NG')}.${(abs % 100n).toString().padStart(2, '0')}`;
};
