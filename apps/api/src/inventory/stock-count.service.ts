import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AuditAction, Prisma } from '@bioassetpro/database';
import { nextReference, siteOf } from '../numbering/numbering';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { PostingControlService } from '../posting-control/posting-control.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { StockMovementService } from './stock-movement.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

/** Who may approve, hold or cancel a count (INT-009: counter ≠ approver). */
const APPROVER_ROLES = ['FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO', 'ADMINISTRATOR'];
const OPEN = ['COUNTING', 'SUBMITTED', 'ON_HOLD'];

/**
 * Stock counts (SYSTEM_INTEGRITY_MATRIX INT-009; Year_End_Close step 2).
 *
 * Starting a count freezes the store: its book quantities and costs are
 * taken, and no stock moves in or out of it (a database trigger) until the
 * count is posted or cancelled. Counts are entered, lines beyond the recount
 * threshold are counted again, every difference is given a reason, and
 * someone other than the counter approves — or holds the count for
 * investigation, or cancels it. Only an approved count moves stock, through
 * PCR-014: a shortage Dr 640100 / Cr the item's inventory, a surplus the
 * reverse, at the cost frozen with the book.
 */
@Injectable()
export class StockCountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly postingControl: PostingControlService,
    private readonly stockMovements: StockMovementService,
  ) {}

  async start(params: {
    companyId: string;
    warehouseId: string;
    itemIds?: string[];
    recountThresholdPercent?: Decimal.Value;
    actor: WorkflowActor;
  }) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: params.warehouseId, companyId: params.companyId },
      select: { id: true, code: true, branchId: true },
    });
    if (!warehouse) throw new NotFoundException('No such store.');
    const threshold = new Decimal(params.recountThresholdPercent ?? 5);
    if (threshold.isNaN() || threshold.lt(0) || threshold.gt(100)) throw new BadRequestException('Give a recount threshold between 0 and 100%.');
    await this.requireOpenPeriod(params.companyId);

    const open = await this.prisma.stockCount.findFirst({
      where: { companyId: params.companyId, warehouseId: warehouse.id, status: { in: OPEN } },
      select: { reference: true },
    });
    if (open) {
      throw new AccountingRuleViolation('INT-009 — One count per store', `${warehouse.code} is already being counted (${open.reference}).`, { reference: open.reference });
    }

    // What to count: the items named, or everything the store holds.
    let itemIds = params.itemIds?.filter(Boolean) ?? [];
    if (itemIds.length === 0) {
      const held = await this.prisma.stockMovement.groupBy({
        by: ['itemId'],
        where: { companyId: params.companyId, warehouseId: warehouse.id },
      });
      itemIds = held.map((h) => h.itemId);
    }
    const items = await this.prisma.item.findMany({ where: { companyId: params.companyId, id: { in: itemIds } }, select: { id: true, code: true } });
    if (items.length !== new Set(itemIds).size) throw new BadRequestException('One of those items is not this company’s.');

    const reference = await nextReference(this.prisma, {
      companyId: params.companyId,
      type: 'STA',
      site: await siteOf(this.prisma, { farmId: null, branchId: warehouse.branchId }),
      date: new Date(),
    });

    return this.prisma.$transaction(async (tx) => {
      const lines: Array<{ itemId: string; bookQuantity: Prisma.Decimal; unitCostKobo: bigint }> = [];
      for (const item of items) {
        const book = await this.stockMovements.storeQuantity(tx, params.companyId, item.id, warehouse.id);
        const position = await this.stockMovements.currentPosition(tx, params.companyId, item.id);
        lines.push({
          itemId: item.id,
          bookQuantity: new Prisma.Decimal(Decimal.max(book, 0).toFixed(6)),
          unitCostKobo: position.wacKobo ?? (await this.standardCost(tx, item.id)),
        });
      }
      if (lines.length === 0) throw new BadRequestException(`${warehouse.code} holds nothing to count. Name the items to count.`);
      const count = await tx.stockCount.create({
        data: {
          companyId: params.companyId,
          branchId: warehouse.branchId,
          warehouseId: warehouse.id,
          reference,
          recountThresholdPercent: new Prisma.Decimal(threshold.toString()),
          startedById: params.actor.userId,
          lines: { create: lines },
        },
      });
      await this.audit.write(
        {
          transactionId: count.id,
          module: 'inventory',
          entityType: 'StockCount',
          entityId: count.id,
          status: 'COUNTING',
          action: AuditAction.CREATE,
          userId: params.actor.userId,
          comments: `Started count ${reference} of ${warehouse.code}: ${lines.length} items frozen at their book quantities.`,
        },
        tx,
      );
      return count;
    });
  }

  /**
   * Enter counted quantities. A line marked for recount takes its second
   * count here; any line can be given the reason for its difference.
   */
  async record(params: {
    companyId: string;
    countId: string;
    counts: Array<{ itemId: string; quantity?: Decimal.Value | null; reason?: string | null }>;
    actor: WorkflowActor;
  }) {
    const count = await this.load(params.companyId, params.countId);
    if (count.status !== 'COUNTING') throw new BadRequestException(`${count.reference} is ${count.status.toLowerCase()}; counts are entered while counting.`);

    return this.prisma.$transaction(async (tx) => {
      for (const entry of params.counts) {
        let line: { id: string; recountRequired: boolean } | undefined = count.lines.find((l) => l.itemId === entry.itemId);
        if (!line) {
          // Something found in the store that the book did not list.
          const item = await tx.item.findFirst({ where: { id: entry.itemId, companyId: params.companyId }, select: { id: true } });
          if (!item) throw new BadRequestException('That item is not this company’s.');
          const position = await this.stockMovements.currentPosition(tx, params.companyId, item.id);
          const book = await this.stockMovements.storeQuantity(tx, params.companyId, item.id, count.warehouseId);
          line = await tx.stockCountLine.create({
            data: {
              stockCountId: count.id,
              itemId: item.id,
              bookQuantity: new Prisma.Decimal(Decimal.max(book, 0).toFixed(6)),
              unitCostKobo: position.wacKobo ?? (await this.standardCost(tx, item.id)),
            },
          });
        }
        const data: Prisma.StockCountLineUpdateInput = {};
        if (entry.quantity !== undefined && entry.quantity !== null && entry.quantity !== '') {
          const quantity = new Decimal(entry.quantity);
          if (quantity.isNaN() || quantity.lt(0)) throw new BadRequestException('A counted quantity is zero or more.');
          const value = new Prisma.Decimal(quantity.toFixed(6));
          if (line.recountRequired) Object.assign(data, { recountQuantity: value, recountedById: params.actor.userId });
          else Object.assign(data, { countedQuantity: value, countedById: params.actor.userId });
        }
        if (entry.reason !== undefined) data.reason = entry.reason?.trim() || null;
        if (Object.keys(data).length > 0) await tx.stockCountLine.update({ where: { id: line.id }, data });
      }
      return this.detailFrom(tx, params.companyId, count.id);
    });
  }

  /**
   * Submit for approval. Lines beyond the recount threshold that have not
   * been counted twice are sent back for a recount first; every remaining
   * difference needs a reason.
   */
  async submit(params: { companyId: string; countId: string; actor: WorkflowActor }) {
    const count = await this.load(params.companyId, params.countId);
    if (count.status !== 'COUNTING') throw new BadRequestException(`${count.reference} is already ${count.status.toLowerCase()}.`);
    const uncounted = count.lines.filter((l) => l.countedQuantity === null || (l.recountRequired && l.recountQuantity === null));
    if (uncounted.length > 0) {
      throw new AccountingRuleViolation(
        'INT-009 — Every line counted',
        `${uncounted.length} line${uncounted.length === 1 ? ' is' : 's are'} not yet counted: ${uncounted.map((l) => l.item.code).join(', ')}.`,
        { items: uncounted.map((l) => l.item.code) },
      );
    }

    const threshold = new Decimal(count.recountThresholdPercent.toString());
    const toRecount = count.lines.filter((l) => {
      if (l.recountRequired) return false;
      const book = new Decimal(l.bookQuantity.toString());
      const difference = new Decimal(l.countedQuantity!.toString()).minus(book).abs();
      return book.isZero() ? difference.gt(0) : difference.div(book).mul(100).gt(threshold);
    });
    if (toRecount.length > 0) {
      await this.prisma.stockCountLine.updateMany({ where: { id: { in: toRecount.map((l) => l.id) }, stockCount: { companyId: params.companyId } }, data: { recountRequired: true } });
      return {
        status: 'COUNTING' as const,
        recount: toRecount.map((l) => l.item.code),
        message: `Beyond the ${threshold.toString()}% recount threshold — count again: ${toRecount.map((l) => l.item.code).join(', ')}.`,
      };
    }

    const finals = count.lines.map((l) => {
      const final = new Decimal((l.recountQuantity ?? l.countedQuantity)!.toString());
      const variance = final.minus(new Decimal(l.bookQuantity.toString()));
      const value = BigInt(variance.mul(l.unitCostKobo.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
      return { line: l, variance, value };
    });
    const unexplained = finals.filter((f) => !f.variance.isZero() && !f.line.reason);
    if (unexplained.length > 0) {
      throw new AccountingRuleViolation(
        'INT-009 — Reason and variance evidence',
        `Give the reason for each difference: ${unexplained.map((f) => f.line.item.code).join(', ')}.`,
        { items: unexplained.map((f) => f.line.item.code) },
      );
    }
    const net = finals.reduce((sum, f) => sum + f.value, 0n);

    await this.prisma.$transaction(async (tx) => {
      for (const f of finals) {
        await tx.stockCountLine.update({
          where: { id: f.line.id },
          data: { varianceQuantity: new Prisma.Decimal(f.variance.toFixed(6)), varianceValueKobo: f.value },
        });
      }
      await tx.stockCount.update({
        where: { id: count.id },
        data: { status: 'SUBMITTED', submittedById: params.actor.userId, submittedAt: new Date(), netAdjustmentKobo: net },
      });
      await this.audit.write(
        {
          transactionId: count.id,
          module: 'inventory',
          entityType: 'StockCount',
          entityId: count.id,
          status: 'SUBMITTED',
          action: AuditAction.SUBMIT,
          userId: params.actor.userId,
          comments: `Submitted ${count.reference}: ${finals.filter((f) => !f.variance.isZero()).length} differences, net ${net} kobo.`,
        },
        tx,
      );
    });
    return { status: 'SUBMITTED' as const, recount: [], message: 'Submitted for approval.' };
  }

  /**
   * Approve (post the adjustment), hold for investigation, or cancel. By
   * someone other than whoever counted, unless the company allows it.
   */
  async decide(params: { companyId: string; countId: string; action: 'APPROVE' | 'HOLD' | 'CANCEL'; note?: string | null; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => APPROVER_ROLES.includes(r))) {
      throw new ForbiddenException('A farm manager or finance approver decides a stock count.');
    }
    const count = await this.load(params.companyId, params.countId);
    const note = params.note?.trim() || null;
    const allowed = params.action === 'CANCEL' ? ['COUNTING', 'SUBMITTED', 'ON_HOLD'] : ['SUBMITTED', 'ON_HOLD'];
    if (!allowed.includes(count.status)) throw new BadRequestException(`${count.reference} is ${count.status.toLowerCase()}.`);
    if (params.action !== 'APPROVE' && !note) throw new BadRequestException(params.action === 'HOLD' ? 'Say what is being investigated.' : 'Say why the count is cancelled.');

    const counters = new Set(
      [count.startedById, count.submittedById, ...count.lines.flatMap((l) => [l.countedById, l.recountedById])].filter((id): id is string => Boolean(id)),
    );
    if (params.action === 'APPROVE' && counters.has(params.actor.userId)) {
      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { allowSelfApproval: true } });
      if (!company.allowSelfApproval) throw new ForbiddenException('You counted this store, so someone else approves the count (INT-009).');
    }

    if (params.action !== 'APPROVE') {
      const status = params.action === 'HOLD' ? 'ON_HOLD' : 'CANCELLED';
      await this.prisma.stockCount.update({
        where: { id: count.id },
        data: { status, decidedById: params.actor.userId, decidedAt: new Date(), decisionNote: note },
      });
      await this.audit.write({
        transactionId: count.id,
        module: 'inventory',
        entityType: 'StockCount',
        entityId: count.id,
        status,
        action: params.action === 'HOLD' ? AuditAction.UPDATE : AuditAction.REJECT,
        userId: params.actor.userId,
        comments: `${count.reference} ${params.action === 'HOLD' ? 'held for investigation' : 'cancelled'}: ${note}.`,
      });
      return { status };
    }

    const differences = count.lines.filter((l) => l.varianceQuantity !== null && !new Decimal(l.varianceQuantity.toString()).isZero());
    const unpriced = differences.filter((l) => new Decimal(l.varianceQuantity!.toString()).gt(0) && l.unitCostKobo === 0n);
    if (unpriced.length > 0) {
      throw new AccountingRuleViolation(
        'INT-009 — A surplus needs a cost',
        `There is no cost to bring ${unpriced.map((l) => l.item.code).join(', ')} in at: set a standard cost for the item, or cancel and recount once it has one.`,
        {},
      );
    }

    const context = await this.requireOpenPeriod(params.companyId);
    const rule = await this.postingControl.resolve({ companyId: params.companyId, ruleId: 'PCR-014', on: new Date() });
    if (!rule.debit || !rule.credit) throw new AccountingRuleViolation('Consolidated Reference §66 — Posting rule', 'PCR-014 has no account on one side.', {});
    const lossAccount = rule.debit.glAccountId;
    const dimensions = {
      companyId: params.companyId,
      branchId: count.branchId,
      financialYearId: context.period.financialYearId,
      financialPeriodId: context.period.id,
      currencyId: context.company.baseCurrencyId,
      exchangeRate: '1',
      costCentreId: context.costCentre.id,
    };

    return this.prisma.$transaction(async (tx) => {
      const lines: Array<{ glAccountId: string; description: string; debit?: ReturnType<typeof kobo>; credit?: ReturnType<typeof kobo>; dimensions: typeof dimensions }> = [];
      for (const line of differences) {
        const variance = new Decimal(line.varianceQuantity!.toString());
        const value = line.varianceValueKobo!;
        const magnitude = value < 0n ? -value : value;
        const stockAccount = line.item.inventoryGlAccountId ?? rule.credit!.glAccountId;
        const movement = {
          tx,
          companyId: params.companyId,
          branchId: count.branchId,
          itemId: line.itemId,
          warehouseId: count.warehouseId,
          quantity: variance.abs(),
          sourceModule: 'inventory',
          sourceDocumentType: 'StockCount',
          sourceDocumentId: count.id,
          documentReference: count.reference,
          movementDate: new Date(),
        };
        if (variance.lt(0)) {
          await this.stockMovements.issueOutAtValue({ ...movement, valueKobo: magnitude, perStore: true });
        } else {
          await this.stockMovements.receiveIn({ ...movement, valueKobo: magnitude });
        }
        if (magnitude === 0n) continue;
        const label = `PCR-014 — count ${variance.lt(0) ? 'shortage' : 'surplus'} ${line.item.code} (${count.reference})`;
        lines.push(
          variance.lt(0)
            ? { glAccountId: lossAccount, description: label, debit: kobo(magnitude), dimensions }
            : { glAccountId: stockAccount, description: label, debit: kobo(magnitude), dimensions },
          variance.lt(0)
            ? { glAccountId: stockAccount, description: label, credit: kobo(magnitude), dimensions }
            : { glAccountId: lossAccount, description: label, credit: kobo(magnitude), dimensions },
        );
      }

      const journal =
        lines.length > 0
          ? await this.posting.post(
              {
                sourceModule: 'inventory',
                sourceDocumentType: 'StockCount',
                sourceDocumentId: count.id,
                journalNumber: count.reference,
                journalDate: new Date(),
                narration: `Stock count ${count.reference}: approved adjustment`,
                ...dimensions,
                idempotencyKey: `stock-count:${count.id}`,
                actor: params.actor,
                lines,
              },
              tx,
            )
          : null;

      await tx.stockCount.update({
        where: { id: count.id },
        data: { status: 'POSTED', decidedById: params.actor.userId, decidedAt: new Date(), decisionNote: note, journalEntryId: journal?.journalEntryId ?? null },
      });
      await this.audit.write(
        {
          transactionId: count.id,
          module: 'inventory',
          entityType: 'StockCount',
          entityId: count.id,
          status: 'POSTED',
          action: AuditAction.APPROVE,
          userId: params.actor.userId,
          comments: `Approved ${count.reference}: ${differences.length} adjustments, net ${count.netAdjustmentKobo} kobo.`,
        },
        tx,
      );
      return { status: 'POSTED', journalEntryId: journal?.journalEntryId ?? null };
    }, { timeout: 20000 });
  }

  async list(companyId: string) {
    const counts = await this.prisma.stockCount.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { lines: true } } },
    });
    const warehouses = await this.prisma.warehouse.findMany({ where: { companyId, id: { in: [...new Set(counts.map((c) => c.warehouseId))] } }, select: { id: true, code: true, name: true } });
    return counts.map((c) => ({
      id: c.id,
      reference: c.reference,
      store: warehouses.find((w) => w.id === c.warehouseId)?.code ?? '',
      status: c.status,
      lines: c._count.lines,
      frozenAt: c.frozenAt.toISOString(),
      netAdjustmentKobo: c.netAdjustmentKobo.toString(),
    }));
  }

  async detail(companyId: string, countId: string) {
    return this.detailFrom(this.prisma, companyId, countId);
  }

  private async detailFrom(client: PrismaService | Prisma.TransactionClient, companyId: string, countId: string) {
    const count = await client.stockCount.findFirst({
      where: { id: countId, companyId },
      include: { lines: { orderBy: { id: 'asc' } } },
    });
    if (!count) throw new NotFoundException('No such stock count.');
    const [items, warehouse] = await Promise.all([
      client.item.findMany({ where: { companyId, id: { in: count.lines.map((l) => l.itemId) } }, select: { id: true, code: true, description: true } }),
      client.warehouse.findFirst({ where: { id: count.warehouseId, companyId }, select: { code: true, name: true } }),
    ]);
    const userIds = [count.startedById, count.submittedById, count.decidedById, ...count.lines.flatMap((l) => [l.countedById, l.recountedById])].filter(
      (id): id is string => Boolean(id),
    );
    const users = await client.user.findMany({ where: { companyId, id: { in: [...new Set(userIds)] } }, select: { id: true, fullName: true } });
    const name = (id: string | null) => (id ? users.find((u) => u.id === id)?.fullName ?? 'someone' : null);
    return {
      id: count.id,
      reference: count.reference,
      store: warehouse ? `${warehouse.code} — ${warehouse.name}` : '',
      status: count.status,
      recountThresholdPercent: count.recountThresholdPercent.toString(),
      frozenAt: count.frozenAt.toISOString(),
      startedBy: name(count.startedById),
      submittedBy: name(count.submittedById),
      decidedBy: name(count.decidedById),
      decisionNote: count.decisionNote,
      netAdjustmentKobo: count.netAdjustmentKobo.toString(),
      journalEntryId: count.journalEntryId,
      lines: count.lines.map((l) => {
        const item = items.find((i) => i.id === l.itemId);
        return {
          itemId: l.itemId,
          item: item ? `${item.code} — ${item.description}` : l.itemId,
          bookQuantity: l.bookQuantity.toString(),
          unitCostKobo: l.unitCostKobo.toString(),
          countedQuantity: l.countedQuantity?.toString() ?? null,
          countedBy: name(l.countedById),
          recountRequired: l.recountRequired,
          recountQuantity: l.recountQuantity?.toString() ?? null,
          recountedBy: name(l.recountedById),
          reason: l.reason,
          varianceQuantity: l.varianceQuantity?.toString() ?? null,
          varianceValueKobo: l.varianceValueKobo?.toString() ?? null,
        };
      }),
    };
  }

  private async load(companyId: string, countId: string) {
    const count = await this.prisma.stockCount.findFirst({ where: { id: countId, companyId }, include: { lines: true } });
    if (!count) throw new NotFoundException('No such stock count.');
    const items = await this.prisma.item.findMany({
      where: { companyId, id: { in: count.lines.map((l) => l.itemId) } },
      select: { id: true, code: true, inventoryGlAccountId: true },
    });
    return {
      ...count,
      lines: count.lines.map((l) => ({ ...l, item: items.find((i) => i.id === l.itemId) ?? { id: l.itemId, code: l.itemId, inventoryGlAccountId: null } })),
    };
  }

  private async standardCost(client: Prisma.TransactionClient, itemId: string): Promise<bigint> {
    const cost = await client.itemStandardCost.findFirst({ where: { itemId, effectiveTo: null }, orderBy: { effectiveFrom: 'desc' }, select: { standardCostKobo: true } });
    return cost?.standardCostKobo ?? 0n;
  }

  /** INT-009 "period check": a count opens and posts only in an open period. */
  private async requireOpenPeriod(companyId: string) {
    const on = new Date();
    const [period, costCentre, company] = await Promise.all([
      this.prisma.financialPeriod.findFirst({
        where: { financialYear: { companyId }, startDate: { lte: on }, endDate: { gte: on }, status: 'OPEN' },
        select: { id: true, financialYearId: true },
      }),
      this.prisma.costCentre.findFirst({ where: { companyId, active: true }, orderBy: { code: 'asc' }, select: { id: true } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
    ]);
    if (!period || !costCentre) {
      throw new AccountingRuleViolation('INT-009 — Period check', 'There is no open period today for a count to post into.', {});
    }
    return { period, costCentre, company };
  }
}
