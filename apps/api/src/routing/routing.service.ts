import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, JournalStatus, PeriodStatus, ProductionOrderCycle, ProductionOrderStatus, RoutingResourceType } from '@bioassetpro/database';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { allocateKobo, Kobo } from '../common/money';

/** Long enough for a create plus its audit record on a cold connection pool — same margin every other master-data write in this codebase uses. */
const TRANSACTION_OPTIONS = { timeout: 20_000 };

/**
 * Routing and activity-based costing — BOM_Routing, ABC_Pools_Drivers,
 * MFG_ABC_Spec (US-897-014/015).
 *
 * Additive and standalone by design: `snapshotRouting()` is a separate call,
 * not wired into `ProductionOrderService`'s own creation flow, so this never
 * touches the already-Built, already-live-verified standard/actual
 * conversion-cost absorption those stories post through (PCR-053/054/055
 * etc). It gives the more granular, per-operation costing view these two
 * stories actually ask for, computed and reported alongside the GL rather
 * than replacing it.
 */
@Injectable()
export class RoutingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Cost pools — the ABC side (US-897-015)                              */
  /* ------------------------------------------------------------------ */

  async createCostPool(params: {
    companyId: string;
    code: string;
    name: string;
    driverName: string;
    actorId: string;
  }) {
    const pool = await this.prisma.costPool.create({
      data: {
        companyId: params.companyId,
        code: params.code,
        name: params.name,
        driverName: params.driverName,
      },
    });

    await this.audit.write({
      transactionId: pool.id,
      module: 'routing',
      entityType: 'CostPool',
      entityId: pool.id,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: params.actorId,
      comments: `Created cost pool ${pool.code} — ${pool.name}, driven by ${pool.driverName}.`,
    });

    return pool;
  }

  /**
   * Set a pool's cost and practical capacity, effective from a date —
   * closing the previous rate the day before, the same discipline
   * `ItemService.setStandardCost()` already uses for standard cost, so a
   * production order costed last month still resolves the rate that
   * applied then.
   *
   * `ratePerUnitKobo` is computed here, never taken from the caller — the
   * story's own formula is "reconciled pool cost ÷ practical capacity",
   * and a rate typed in by hand could silently drift from the two numbers
   * it is supposed to be derived from.
   */
  async setCostPoolRate(params: {
    companyId: string;
    poolId: string;
    poolCost: Kobo;
    practicalCapacity: string;
    effectiveFrom: Date;
    sourceReference?: string | null;
    actorId: string;
  }) {
    const pool = await this.prisma.costPool.findFirstOrThrow({
      where: { id: params.poolId, companyId: params.companyId },
    });

    const capacity = Number(params.practicalCapacity);
    if (!(capacity > 0)) {
      throw new AccountingRuleViolation(
        'ABC_Pools_Drivers — practical capacity',
        `Practical capacity must be greater than zero — a pool with no capacity has no rate to divide into.`,
        { poolId: pool.id },
      );
    }
    const ratePerUnitKobo = BigInt(Math.round(Number(params.poolCost) / capacity));

    const day = new Date(
      Date.UTC(
        params.effectiveFrom.getUTCFullYear(),
        params.effectiveFrom.getUTCMonth(),
        params.effectiveFrom.getUTCDate(),
      ),
    );
    const previousDay = new Date(day);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);

    return this.prisma.$transaction(async (tx) => {
      await tx.costPoolRate.updateMany({
        where: { poolId: pool.id, effectiveTo: null, effectiveFrom: { lt: day } },
        data: { effectiveTo: previousDay },
      });

      const created = await tx.costPoolRate.create({
        data: {
          poolId: pool.id,
          poolCostKobo: params.poolCost,
          practicalCapacity: params.practicalCapacity,
          ratePerUnitKobo,
          effectiveFrom: day,
          sourceReference: params.sourceReference ?? null,
        },
      });

      await this.audit.write(
        {
          transactionId: pool.id,
          module: 'routing',
          entityType: 'CostPoolRate',
          entityId: created.id,
          status: 'ACTIVE',
          action: AuditAction.CREATE,
          userId: params.actorId,
          comments:
            `${pool.code}: pool cost ${params.poolCost} kobo over ${params.practicalCapacity} ` +
            `capacity from ${day.toISOString().slice(0, 10)} — rate ${ratePerUnitKobo} kobo/unit.`,
          metadata: {
            poolCostKobo: String(params.poolCost),
            practicalCapacity: params.practicalCapacity,
            ratePerUnitKobo: ratePerUnitKobo.toString(),
          },
        },
        tx,
      );

      return created;
    }, TRANSACTION_OPTIONS);
  }

  /* ------------------------------------------------------------------ */
  /* Routing operations — the labour/machine side (US-897-014)           */
  /* ------------------------------------------------------------------ */

  /** One recipe version's routing, in sequence — the master data `snapshotRouting()` freezes onto an order. */
  async listRoutingOperations(companyId: string, recipeVersionId: string) {
    return this.prisma.routingOperation.findMany({
      where: { companyId, recipeVersionId, active: true },
      include: { costCentre: true, costPool: true },
      orderBy: { sequence: 'asc' },
    });
  }

  async createRoutingOperation(params: {
    companyId: string;
    recipeVersionId: string;
    costCentreId: string;
    costPoolId: string;
    operationName: string;
    resourceType: RoutingResourceType;
    setupHours?: string;
    runHoursPerUnit?: string;
    actorId: string;
  }) {
    // Ownership check on the recipe version the same way RecipeService.addComponent
    // does — a body-supplied recipeVersionId naming another company's version must
    // not be addable to just because the id happens to exist somewhere in the DB.
    await this.prisma.productRecipeVersion.findFirstOrThrow({
      where: { id: params.recipeVersionId, recipe: { companyId: params.companyId } },
      select: { id: true },
    });

    const last = await this.prisma.routingOperation.findFirst({
      where: { recipeVersionId: params.recipeVersionId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });

    const operation = await this.prisma.routingOperation.create({
      data: {
        companyId: params.companyId,
        recipeVersionId: params.recipeVersionId,
        costCentreId: params.costCentreId,
        costPoolId: params.costPoolId,
        sequence: (last?.sequence ?? 0) + 1,
        operationName: params.operationName,
        resourceType: params.resourceType,
        setupHours: params.setupHours ?? '0',
        runHoursPerUnit: params.runHoursPerUnit ?? '0',
      },
    });

    await this.audit.write({
      transactionId: operation.id,
      module: 'routing',
      entityType: 'RoutingOperation',
      entityId: operation.id,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: params.actorId,
      comments: `Added routing operation "${operation.operationName}" (${operation.resourceType}) at sequence ${operation.sequence}.`,
    });

    return operation;
  }

  /**
   * Snapshots every active routing operation for the order's recipe version
   * onto real `ProductionOrderRoutingLine` rows — frozen against later
   * routing or rate changes, the same discipline `ProductionOrderComponent`
   * already gives the packaging BOM.
   *
   * Refuses rather than guesses when an operation's cost pool has no
   * currently-effective rate — the same "recorded but unposted until an
   * account/rate exists" discipline every other resolver in this codebase
   * uses.
   */
  async snapshotRouting(productionOrderId: string, asOf: Date = new Date()) {
    const order = await this.prisma.productionOrder.findUniqueOrThrow({
      where: { id: productionOrderId },
    });

    const existing = await this.prisma.productionOrderRoutingLine.count({
      where: { productionOrderId: order.id },
    });
    if (existing > 0) {
      return { snapshotted: false, reason: 'Routing already snapshotted for this order.' };
    }

    const operations = await this.prisma.routingOperation.findMany({
      where: { companyId: order.companyId, recipeVersionId: order.recipeVersionId, active: true },
      orderBy: { sequence: 'asc' },
      include: { costPool: true },
    });
    if (operations.length === 0) {
      return { snapshotted: false, reason: 'No routing exists for this recipe version.' };
    }

    const lines: { operationName: string; standardHours: string; standardCostKobo: string }[] = [];

    for (const op of operations) {
      const rate = await this.prisma.costPoolRate.findFirst({
        where: {
          poolId: op.costPoolId,
          effectiveFrom: { lte: asOf },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (!rate) {
        throw new AccountingRuleViolation(
          'ABC_Pools_Drivers — approved rate required',
          `Cost pool "${op.costPool.name}" has no effective rate as of ${asOf.toISOString().slice(0, 10)}; ` +
            `operation "${op.operationName}" cannot snapshot.`,
          { costPoolId: op.costPoolId, operationId: op.id },
        );
      }

      const standardHours =
        Number(op.setupHours) + Number(op.runHoursPerUnit) * Number(order.plannedOutputQuantity);
      const standardCostKobo = BigInt(Math.round(standardHours * Number(rate.ratePerUnitKobo)));

      await this.prisma.productionOrderRoutingLine.create({
        data: {
          productionOrderId: order.id,
          routingOperationId: op.id,
          standardHours: standardHours.toFixed(6),
          ratePerHourKobo: rate.ratePerUnitKobo,
          standardCostKobo,
        },
      });

      lines.push({
        operationName: op.operationName,
        standardHours: standardHours.toFixed(2),
        standardCostKobo: standardCostKobo.toString(),
      });
    }

    return { snapshotted: true, lines };
  }

  async listRoutingLines(productionOrderId: string) {
    return this.prisma.productionOrderRoutingLine.findMany({
      where: { productionOrderId },
      include: { routingOperation: { include: { costCentre: true, costPool: true } } },
      orderBy: { routingOperation: { sequence: 'asc' } },
    });
  }

  /**
   * The ledger accounts a pool's cost comes from (AC-MFG-004), replacing what
   * was set before. A cost centre narrows an account to that centre's cost.
   */
  async setPoolSources(params: { companyId: string; poolId: string; sources: Array<{ glAccountId: string; costCentreId?: string | null; resourceType?: RoutingResourceType }>; actorId: string }) {
    const pool = await this.prisma.costPool.findFirst({ where: { id: params.poolId, companyId: params.companyId } });
    if (!pool) throw new NotFoundException('No such cost pool.');
    const accountIds = [...new Set(params.sources.map((s) => s.glAccountId))];
    const accounts = await this.prisma.gLAccount.findMany({ where: { companyId: params.companyId, id: { in: accountIds }, isPostingAccount: true } });
    if (accounts.length !== accountIds.length) throw new BadRequestException('Every source must be a posting account of this company.');
    const centreIds = [...new Set(params.sources.map((s) => s.costCentreId).filter((id): id is string => !!id))];
    if (centreIds.length) {
      const centres = await this.prisma.costCentre.count({ where: { companyId: params.companyId, id: { in: centreIds } } });
      if (centres !== centreIds.length) throw new BadRequestException('A cost centre is not this company\'s.');
    }
    const unique = new Map(params.sources.map((s) => [`${s.glAccountId}|${s.costCentreId ?? ''}`, s]));
    await this.prisma.$transaction([
      this.prisma.costPoolSource.deleteMany({ where: { poolId: pool.id, pool: { companyId: params.companyId } } }),
      this.prisma.costPoolSource.createMany({
        data: [...unique.values()].map((s) => ({ poolId: pool.id, glAccountId: s.glAccountId, costCentreId: s.costCentreId ?? null, resourceType: s.resourceType ?? RoutingResourceType.OVERHEAD })),
      }),
    ]);
    await this.audit.write({
      transactionId: pool.id,
      module: 'costing',
      entityType: 'CostPoolSource',
      entityId: pool.id,
      status: 'ACTIVE',
      action: AuditAction.UPDATE,
      userId: params.actorId,
      newValue: { sources: [...unique.values()] },
      comments: `Ledger sources for pool ${pool.code}.`,
    });
    return { poolId: pool.id, sources: unique.size };
  }

  /**
   * Freeze actual source-account costs across every Feed Mill order converted
   * in a soft-closed period. Source accounts are allocated by actual routing
   * hours (and source cost centre when configured); orders never re-enter the
   * same payroll, AP, depreciation or GL amounts by hand.
   */
  async allocateFeedMillActualCosts(params: { companyId: string; financialPeriodId: string; actorId: string }) {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: params.financialPeriodId, financialYear: { companyId: params.companyId } },
    });
    if (!period) throw new NotFoundException('No such financial period.');
    if (period.status !== PeriodStatus.SOFT_CLOSED) {
      throw new AccountingRuleViolation('Feed Mill actual-cost allocation', 'Soft-close the period first so its ledger source balances are stable.', { period: period.name });
    }
    const existing = await this.prisma.feedMillActualCostRun.findUnique({
      where: { companyId_financialPeriodId: { companyId: params.companyId, financialPeriodId: period.id } },
    });
    if (existing) {
      const allocations = await this.prisma.feedMillActualCostAllocation.findMany({ where: { runId: existing.id }, select: { productionOrderId: true } });
      return { runId: existing.id, alreadyAllocated: true, orders: new Set(allocations.map((a) => a.productionOrderId)).size, allocations: allocations.length };
    }

    const pools = await this.prisma.costPool.findMany({ where: { companyId: params.companyId, active: true, sources: { some: {} } }, include: { sources: true } });
    const sources = pools.flatMap((pool) => pool.sources.map((source) => ({ pool, source })));
    if (!sources.length) throw new AccountingRuleViolation('Feed Mill actual-cost allocation', 'Configure the shared cost-pool ledger sources before allocating actual costs.', {});
    const keys = sources.map(({ source }) => `${source.glAccountId}|${source.costCentreId ?? ''}`);
    if (new Set(keys).size !== keys.length) {
      throw new AccountingRuleViolation('Feed Mill actual-cost allocation', 'A GL account and cost centre cannot feed more than one cost pool; remove duplicate source assignments to avoid double allocation.', {});
    }

    const conversions = await this.prisma.productionOrder.findMany({
      where: {
        companyId: params.companyId,
        processingCycle: ProductionOrderCycle.FEED_MILL,
        status: ProductionOrderStatus.COMPLETED,
        conversionJournalEntry: { financialPeriodId: period.id },
      },
      include: { routingLines: { include: { routingOperation: { select: { costPoolId: true, costCentreId: true, resourceType: true } } } } },
      orderBy: { orderNumber: 'asc' },
    });
    if (!conversions.length) throw new AccountingRuleViolation('Feed Mill actual-cost allocation', `No completed Feed Mill orders were converted in ${period.name}.`, {});
    const incomplete = await this.prisma.productionOrder.count({
      where: { companyId: params.companyId, processingCycle: ProductionOrderCycle.FEED_MILL, status: ProductionOrderStatus.IN_PRODUCTION, conversionJournalEntry: { financialPeriodId: period.id } },
    });
    if (incomplete) throw new AccountingRuleViolation('Feed Mill actual-cost allocation', `${incomplete} Feed Mill order(s) in ${period.name} have not completed; finish them before freezing shared actual costs.`, { incomplete });
    if (conversions.some((order) => !order.routingLines.length || order.routingLines.some((line) => line.actualHours === null))) {
      throw new AccountingRuleViolation('Feed Mill actual-cost allocation', 'Every completed Feed Mill order needs confirmed actual routing hours before the pool can be allocated.', {});
    }

    const accountIds = [...new Set(sources.map(({ source }) => source.glAccountId))];
    const accounts = await this.prisma.gLAccount.findMany({ where: { companyId: params.companyId, id: { in: accountIds } }, select: { id: true, accountNumber: true, requiresCostCentre: true } });
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    if (accounts.length !== accountIds.length) throw new AccountingRuleViolation('Feed Mill actual-cost allocation', 'A configured pool source account is missing from this company.', {});
    const ledgerLines = await this.prisma.journalLine.findMany({
      where: { companyId: params.companyId, financialPeriodId: period.id, glAccountId: { in: accountIds }, journalEntry: { status: JournalStatus.POSTED } },
      select: { glAccountId: true, costCentreId: true, debitKobo: true, creditKobo: true },
    });
    const prepared: Array<{ productionOrderId: string; costPoolId: string; sourceGlAccountId: string; sourceCostCentreId: string | null; sourceCostCentreKey: string; resourceType: RoutingResourceType; driverHours: string; amountKobo: bigint }> = [];
    for (const { pool, source } of sources) {
      const account = accountById.get(source.glAccountId)!;
      if (account.requiresCostCentre && !source.costCentreId) throw new AccountingRuleViolation('Feed Mill actual-cost allocation', `${account.accountNumber} requires a cost centre in its pool source setup.`, { account: account.accountNumber });
      const balance = ledgerLines
        .filter((line) => line.glAccountId === source.glAccountId && (source.costCentreId ? line.costCentreId === source.costCentreId : true))
        .reduce((sum, line) => sum + line.debitKobo - line.creditKobo, 0n);
      if (balance < 0n) throw new AccountingRuleViolation('Feed Mill actual-cost allocation', `${account.accountNumber} has a credit balance for ${period.name}; review the source account setup before allocation.`, { account: account.accountNumber, balanceKobo: balance.toString() });
      if (balance === 0n) continue;
      const drivers = conversions.map((order) => {
        const matching = order.routingLines.filter((line) => line.routingOperation.costPoolId === pool.id && line.routingOperation.resourceType === source.resourceType && (!source.costCentreId || line.routingOperation.costCentreId === source.costCentreId));
        const hours = matching.reduce((sum, line) => sum.plus(line.actualHours!.toString()), new Decimal(0));
        return { order, hours };
      });
      const eligible = drivers.filter((driver) => driver.hours.gt(0));
      if (!eligible.length) throw new AccountingRuleViolation('Feed Mill actual-cost allocation', `${account.accountNumber} has actual cost but no matching Feed Mill driver hours in ${period.name}.`, { account: account.accountNumber, pool: pool.code });
      const shares = allocateKobo(balance as Kobo, eligible.map((driver) => driver.hours.toString()));
      eligible.forEach((driver, index) => {
        const amountKobo = BigInt(shares[index] ?? 0n);
        if (amountKobo > 0n) prepared.push({
          productionOrderId: driver.order.id, costPoolId: pool.id, sourceGlAccountId: source.glAccountId,
          sourceCostCentreId: source.costCentreId, sourceCostCentreKey: source.costCentreId ?? '',
          resourceType: source.resourceType, driverHours: driver.hours.toFixed(6), amountKobo,
        });
      });
    }
    if (!prepared.length) throw new AccountingRuleViolation('Feed Mill actual-cost allocation', 'No positive actual source costs were found for this period.', {});

    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.feedMillActualCostRun.create({ data: { companyId: params.companyId, financialPeriodId: period.id, preparedById: params.actorId } });
      await tx.feedMillActualCostAllocation.createMany({ data: prepared.map((line) => ({ runId: created.id, ...line })) });
      for (const order of conversions) {
        const orderLines = prepared.filter((line) => line.productionOrderId === order.id);
        const labour = orderLines.filter((line) => line.resourceType === RoutingResourceType.LABOUR).reduce((sum, line) => sum + line.amountKobo, 0n);
        const overhead = orderLines.filter((line) => line.resourceType !== RoutingResourceType.LABOUR).reduce((sum, line) => sum + line.amountKobo, 0n);
        await tx.productionOrder.update({ where: { id: order.id }, data: { actualLabourCostKobo: labour, actualOverheadCostKobo: overhead } });
      }
      return created;
    }, TRANSACTION_OPTIONS);
    await this.audit.write({
      transactionId: run.id, module: 'routing', entityType: 'FeedMillActualCostRun', entityId: run.id,
      status: 'ALLOCATED', action: AuditAction.POST, userId: params.actorId,
      comments: `Allocated shared Feed Mill actual source costs across ${conversions.length} completed order(s) for ${period.name}.`,
      metadata: { periodId: period.id, orderCount: conversions.length, allocationCount: prepared.length },
    });
    return { runId: run.id, alreadyAllocated: false, orders: conversions.length, allocations: prepared.length };
  }

  /** One-account recovery analysis by species, formula, batch and work centre. */
  async feedMillRecoveryAnalysis(params: { companyId: string; financialPeriodId: string }) {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: params.financialPeriodId, financialYear: { companyId: params.companyId } },
      select: { id: true, name: true, startDate: true, endDate: true },
    });
    if (!period) throw new NotFoundException('No such financial period.');
    const lines = await this.prisma.journalLine.findMany({
      where: {
        companyId: params.companyId,
        financialPeriodId: period.id,
        glAccount: { accountNumber: { in: ['219830', '54300'] } },
        journalEntry: { status: JournalStatus.POSTED },
      },
      include: {
        item: { select: { id: true, code: true, description: true } },
        costCentre: { select: { code: true, name: true } },
        glAccount: { select: { accountNumber: true, name: true } },
        journalEntry: { select: { sourceDocumentId: true, journalNumber: true, journalDate: true } },
      },
      orderBy: [{ journalEntry: { journalDate: 'asc' } }, { lineNumber: 'asc' }],
    });
    const batchIds = [...new Set(lines.flatMap((line) => line.journalEntry.sourceDocumentId ? [line.journalEntry.sourceDocumentId] : []))];
    const batches = await this.prisma.productionOrder.findMany({
      where: { companyId: params.companyId, id: { in: batchIds }, processingCycle: ProductionOrderCycle.FEED_MILL },
      select: { id: true, orderNumber: true, speciesKey: true },
    });
    const batchById = new Map(batches.map((batch) => [batch.id, batch]));
    const groups = new Map<string, {
      accountNumber: string; speciesKey: string | null; formulaCode: string | null; formulaName: string | null;
      batchId: string | null; batchNumber: string | null; workCentreCode: string | null; workCentreName: string | null;
      debits: bigint; credits: bigint; journals: Set<string>;
    }>();
    for (const line of lines) {
      const batchId = line.journalEntry.sourceDocumentId;
      const batch = batchId ? batchById.get(batchId) : undefined;
      const speciesKey = batch?.speciesKey ?? line.speciesKey;
      const key = [line.glAccount.accountNumber, speciesKey ?? '', line.itemId ?? '', batchId ?? '', line.costCentreId ?? ''].join('|');
      const row = groups.get(key) ?? {
        accountNumber: line.glAccount.accountNumber,
        speciesKey,
        formulaCode: line.item?.code ?? null,
        formulaName: line.item?.description ?? null,
        batchId,
        batchNumber: batch?.orderNumber ?? null,
        workCentreCode: line.costCentre?.code ?? null,
        workCentreName: line.costCentre?.name ?? null,
        debits: 0n,
        credits: 0n,
        journals: new Set<string>(),
      };
      row.debits += line.debitKobo;
      row.credits += line.creditKobo;
      row.journals.add(line.journalEntry.journalNumber);
      groups.set(key, row);
    }
    return {
      period: { id: period.id, name: period.name, startDate: period.startDate, endDate: period.endDate },
      account: 'one shared Feed Mill recovery account per chart (219830 legacy / 54300 approved COA)',
      rows: [...groups.values()].map((row) => ({
        accountNumber: row.accountNumber,
        speciesKey: row.speciesKey,
        formulaCode: row.formulaCode,
        formulaName: row.formulaName,
        batchId: row.batchId,
        batchNumber: row.batchNumber,
        workCentreCode: row.workCentreCode,
        workCentreName: row.workCentreName,
        debitsKobo: row.debits.toString(),
        creditsKobo: row.credits.toString(),
        recoveryBalanceKobo: (row.credits - row.debits).toString(),
        journalCount: row.journals.size,
      })),
    };
  }

  /**
   * AC-MFG-004 "Pool source GL = allocated + unused capacity": for each pool,
   * over its current rate's window to the day asked, the cost its source
   * accounts carry in the ledger, against what orders absorbed at the rate and
   * the cost of the capacity left unused. What remains is the pool's spending
   * variance, shown rather than hidden; and the rate's own pool cost is set
   * against the ledger so a rate out of line with its ledger is flagged.
   */
  async reconcilePools(companyId: string, asOf: Date = new Date()) {
    const pools = await this.prisma.costPool.findMany({
      where: { companyId, active: true },
      orderBy: { code: 'asc' },
      include: { sources: true },
    });
    const accountIds = [...new Set(pools.flatMap((p) => p.sources.map((s) => s.glAccountId)))];
    const accounts = await this.prisma.gLAccount.findMany({ where: { companyId, id: { in: accountIds } }, select: { id: true, accountNumber: true, name: true } });
    const rows = [];
    for (const pool of pools) {
      const rate = await this.prisma.costPoolRate.findFirst({
        where: { poolId: pool.id, effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }] },
        orderBy: { effectiveFrom: 'desc' },
      });
      const sources = pool.sources.map((s) => {
        const a = accounts.find((x) => x.id === s.glAccountId);
        return { glAccountId: s.glAccountId, costCentreId: s.costCentreId, resourceType: s.resourceType, account: a ? `${a.accountNumber} ${a.name}` : '' };
      });
      if (!rate) {
        rows.push({ poolId: pool.id, code: pool.code, name: pool.name, sources, hasRate: false as const, reconciled: false, note: 'No rate in force.' });
        continue;
      }
      const from = rate.effectiveFrom;
      const to = rate.effectiveTo && rate.effectiveTo < asOf ? rate.effectiveTo : asOf;
      let ledgerKobo = 0n;
      if (pool.sources.length) {
        const lines = await this.prisma.journalLine.findMany({
          where: {
            companyId,
            journalEntry: { status: JournalStatus.POSTED, journalDate: { gte: from, lte: to } },
            OR: pool.sources.map((s) => ({ glAccountId: s.glAccountId, ...(s.costCentreId ? { costCentreId: s.costCentreId } : {}) })),
          },
          select: { debitKobo: true, creditKobo: true },
        });
        ledgerKobo = lines.reduce((sum, l) => sum + l.debitKobo - l.creditKobo, 0n);
      }
      const absorbedLines = await this.prisma.productionOrderRoutingLine.findMany({
        where: {
          routingOperation: { costPoolId: pool.id },
          productionOrder: { companyId, createdAt: { gte: from, lte: new Date(to.getTime() + 86_400_000) } },
        },
        select: { absorbedCostKobo: true, standardCostKobo: true, actualHours: true, standardHours: true },
      });
      const absorbedKobo = absorbedLines.reduce((sum, l) => sum + (l.absorbedCostKobo ?? 0n), 0n);
      const plannedKobo = absorbedLines.filter((l) => l.absorbedCostKobo === null).reduce((sum, l) => sum + l.standardCostKobo, 0n);
      const unused = await this.unusedCapacity(pool.id, asOf);
      const unusedKobo = unused.hasRate ? BigInt(unused.unusedCapacityCostKobo) : 0n;
      const differenceKobo = ledgerKobo - absorbedKobo - unusedKobo;
      rows.push({
        poolId: pool.id,
        code: pool.code,
        name: pool.name,
        sources,
        hasRate: true as const,
        window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
        rate: { poolCostKobo: rate.poolCostKobo.toString(), practicalCapacity: rate.practicalCapacity.toString(), ratePerUnitKobo: rate.ratePerUnitKobo.toString() },
        ledgerKobo: ledgerKobo.toString(),
        absorbedKobo: absorbedKobo.toString(),
        /** Standard on orders not yet confirmed — to be absorbed. */
        notYetAbsorbedKobo: plannedKobo.toString(),
        unusedCapacityKobo: unusedKobo.toString(),
        /** Ledger less absorbed less unused capacity: the pool's spending variance. */
        differenceKobo: differenceKobo.toString(),
        /** The rate's pool cost less the ledger cost. */
        rateVsLedgerKobo: (rate.poolCostKobo - ledgerKobo).toString(),
        reconciled: pool.sources.length > 0,
        note: pool.sources.length === 0 ? 'No ledger accounts linked; the pool is not tied to the ledger.' : null,
      });
    }
    return rows;
  }

  async listCostPools(companyId: string, asOf: Date = new Date()) {
    const pools = await this.prisma.costPool.findMany({
      where: { companyId, active: true },
      orderBy: { code: 'asc' },
    });

    return Promise.all(
      pools.map(async (pool) => {
        const rate = await this.prisma.costPoolRate.findFirst({
          where: {
            poolId: pool.id,
            effectiveFrom: { lte: asOf },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
          },
          orderBy: { effectiveFrom: 'desc' },
        });
        return {
          id: pool.id,
          code: pool.code,
          name: pool.name,
          driverName: pool.driverName,
          poolCostKobo: rate?.poolCostKobo.toString() ?? null,
          practicalCapacity: rate?.practicalCapacity.toString() ?? null,
          ratePerUnitKobo: rate?.ratePerUnitKobo.toString() ?? null,
          sourceReference: rate?.sourceReference ?? null,
        };
      }),
    );
  }

  /**
   * "Unused capacity cost not silently loaded into product cost" — computed
   * here, on demand, from real driver consumption, never folded into the
   * rate itself or into any order's own standard cost.
   */
  async unusedCapacity(poolId: string, asOf: Date = new Date()) {
    const rate = await this.prisma.costPoolRate.findFirst({
      where: {
        poolId,
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!rate) {
      return { hasRate: false as const };
    }

    // Hours consumed while this rate applied: actual where conversion has
    // been confirmed, standard otherwise (an order still in progress).
    const lines = await this.prisma.productionOrderRoutingLine.findMany({
      where: {
        routingOperation: { costPoolId: poolId },
        productionOrder: {
          createdAt: { gte: rate.effectiveFrom, ...(rate.effectiveTo ? { lte: new Date(rate.effectiveTo.getTime() + 86_400_000) } : {}) },
        },
      },
      select: { standardHours: true, actualHours: true },
    });
    const consumedHours = lines.reduce((sum, line) => sum + Number(line.actualHours ?? line.standardHours), 0);
    const practicalCapacity = Number(rate.practicalCapacity);
    const unusedCapacity = Math.max(0, practicalCapacity - consumedHours);
    const unusedCapacityCostKobo = BigInt(Math.round(unusedCapacity * Number(rate.ratePerUnitKobo)));

    return {
      hasRate: true as const,
      poolCostKobo: rate.poolCostKobo.toString(),
      practicalCapacity: rate.practicalCapacity.toString(),
      ratePerUnitKobo: rate.ratePerUnitKobo.toString(),
      consumedHours: consumedHours.toFixed(2),
      unusedCapacity: unusedCapacity.toFixed(2),
      unusedCapacityCostKobo: unusedCapacityCostKobo.toString(),
    };
  }
}
