import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AuditAction, Prisma } from '@bioassetpro/database';
import { chartVersionOf, speciesNumberFor } from '../chart/chart';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../posting/posting.service';
import { AuditService } from '../audit/audit.service';
import { StockMovementService } from '../inventory/stock-movement.service';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Eggs into the books — PCR-067, PCR-068, PCR-069.
 *
 * DEC-002 ("Egg recognition"), answered 2026-09-24: eggs are recognised when
 * collected, at a value per crate the farm sets and dates (`EggValuePolicy`).
 * They are agricultural produce, so the value is a gain (IAS 41), not a
 * change in the layers.
 *
 *   COLLECTED  Dr the eggs item's inventory account (Eggs, 130215)
 *              Cr Agricultural Produce Gain — Eggs (420210)          PCR-067
 *              Table and hatching eggs go into the eggs stock item, so a
 *              sale of eggs takes them back out through delivery like any
 *              other stock. Rejects are counted and carry no value.
 *   SET        Dr Eggs in Incubation (130216) / Cr Eggs (130215)      PCR-068
 *              The set eggs leave stock at the store's average cost.
 *   HATCHED    Dr Biological Assets — Poultry (130210)
 *              Cr Eggs in Incubation (130216)                          PCR-069
 *              The whole set value goes to the chicks that hatched, the
 *              workbook's "allocated incubation carrying value"; a hatch with
 *              no chicks writes it off to Production Loss (5305).
 *
 * Like feed, a posting runs after the record has committed and never loses
 * it: with no egg value set yet, a closed period, or an earlier step not yet
 * posted, the record waits under "Farm records waiting for the ledger".
 */

const ACCOUNT = {
  gain: '420210',
  eggs: '130215',
  incubation: '130216',
  poultry: '130210',
  // (The loss account depends on the chart — resolved in postHatch.)
} as const;

@Injectable()
export class EggPostingService {
  private readonly logger = new Logger(EggPostingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly stock: StockMovementService,
    private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* The policy                                                          */
  /* ------------------------------------------------------------------ */

  async listPolicies(companyId: string) {
    const policies = await this.prisma.eggValuePolicy.findMany({
      where: { companyId },
      orderBy: { effectiveFrom: 'desc' },
    });
    const items = await this.prisma.item.findMany({
      where: { id: { in: policies.map((p) => p.itemId) } },
      select: { id: true, code: true, description: true },
    });
    const item = new Map(items.map((i) => [i.id, i]));
    return policies.map((p) => ({
      id: p.id,
      effectiveFrom: p.effectiveFrom,
      eggsPerUnit: p.eggsPerUnit,
      valuePerUnitKobo: p.valuePerUnitKobo,
      hatchingValuePerUnitKobo: p.hatchingValuePerUnitKobo,
      item: item.get(p.itemId) ?? null,
    }));
  }

  /**
   * Set the value of eggs from a date. Never edits an earlier value — a new
   * price is a new row, so collections already posted keep theirs.
   */
  async setPolicy(params: {
    companyId: string;
    itemId: string;
    eggsPerUnit: number;
    valuePerUnitKobo: bigint;
    /** Hatching eggs' own value per unit; null or absent = the table price. */
    hatchingValuePerUnitKobo?: bigint | null;
    effectiveFrom: Date;
    actor: WorkflowActor;
  }) {
    if (!Number.isInteger(params.eggsPerUnit) || params.eggsPerUnit < 1) {
      throw new BadRequestException('Eggs per unit must be a whole number, at least 1.');
    }
    if (params.valuePerUnitKobo <= 0n) throw new BadRequestException('The value must be more than zero.');
    const hatching = params.hatchingValuePerUnitKobo ?? null;
    if (hatching !== null && hatching <= 0n) throw new BadRequestException('The hatching value must be more than zero.');

    const item = await this.prisma.item.findFirst({ where: { id: params.itemId, companyId: params.companyId, active: true } });
    if (!item) throw new NotFoundException('No such active item in this company.');

    const eggsAccount = await this.account(params.companyId, ACCOUNT.eggs, this.prisma);
    // Eggs are held in Eggs (130215). An item with no inventory account is
    // pointed there; one already pointed elsewhere keeps its own, so the
    // control reconciliation for that account stays whole either way.
    if (!item.inventoryGlAccountId) {
      await this.prisma.item.update({ where: { id: item.id }, data: { inventoryGlAccountId: eggsAccount } });
    }

    const policy = await this.prisma.eggValuePolicy.upsert({
      where: { companyId_effectiveFrom: { companyId: params.companyId, effectiveFrom: params.effectiveFrom } },
      update: { itemId: item.id, eggsPerUnit: params.eggsPerUnit, valuePerUnitKobo: params.valuePerUnitKobo, hatchingValuePerUnitKobo: hatching, createdById: params.actor.userId },
      create: {
        companyId: params.companyId,
        itemId: item.id,
        eggsPerUnit: params.eggsPerUnit,
        valuePerUnitKobo: params.valuePerUnitKobo,
        hatchingValuePerUnitKobo: hatching,
        effectiveFrom: params.effectiveFrom,
        createdById: params.actor.userId,
      },
    });

    await this.audit.write({
      transactionId: policy.id,
      module: 'poultry-egg',
      entityType: 'EggValuePolicy',
      entityId: policy.id,
      status: 'ACTIVE',
      action: AuditAction.UPDATE,
      userId: params.actor.userId,
      newValue: {
        item: item.code,
        eggsPerUnit: params.eggsPerUnit,
        valuePerUnitKobo: params.valuePerUnitKobo.toString(),
        hatchingValuePerUnitKobo: hatching?.toString() ?? null,
        effectiveFrom: params.effectiveFrom.toISOString().slice(0, 10),
      },
    });
    return policy;
  }

  /** The value in force on a date — the latest set on or before it. */
  async policyOn(companyId: string, on: Date) {
    return this.prisma.eggValuePolicy.findFirst({
      where: { companyId, effectiveFrom: { lte: on } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /* ------------------------------------------------------------------ */
  /* The three postings                                                  */
  /* ------------------------------------------------------------------ */

  /** PCR-067 — value a collection and put its eggs into stock. */
  async postCollection(batchId: string, actor: WorkflowActor): Promise<{ posted: boolean; reason?: string }> {
    const batch = await this.prisma.eggCollectionBatch.findUnique({ where: { id: batchId } });
    if (!batch || batch.journalEntryId) return { posted: false };

    const eggs = batch.hatchingCount + batch.tableCount;
    if (eggs <= 0) return { posted: false }; // All rejects: counted, worth nothing.

    const policy = await this.policyOn(batch.companyId, batch.collectedOn);
    if (!policy) {
      return { posted: false, reason: `No egg value is set for ${day(batch.collectedOn)}. Set one under Poultry → Eggs.` };
    }

    return this.attempt(`Egg collection ${batch.code}`, async () => {
      const item = await this.prisma.item.findUniqueOrThrow({ where: { id: policy.itemId } });
      const quantity = new Decimal(eggs).div(policy.eggsPerUnit).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
      // Table and hatching eggs each at their own price (hatching defaults to
      // the table price); rounded once each, to whole kobo.
      const valueOf = (count: number, perUnit: bigint) =>
        BigInt(new Decimal(count).mul(perUnit.toString()).div(policy.eggsPerUnit).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
      const tableValueKobo = valueOf(batch.tableCount, policy.valuePerUnitKobo);
      const hatchingValueKobo = valueOf(batch.hatchingCount, policy.hatchingValuePerUnitKobo ?? policy.valuePerUnitKobo);
      const valueKobo = tableValueKobo + hatchingValueKobo;

      await this.prisma.$transaction(async (tx) => {
        const [context, gain, warehouseId] = await Promise.all([
          this.context(tx, batch.companyId, batch.collectedOn),
          this.account(batch.companyId, ACCOUNT.gain, tx),
          this.warehouse(tx, batch.companyId, item.defaultWarehouseId),
        ]);
        const inventory = item.inventoryGlAccountId ?? (await this.account(batch.companyId, ACCOUNT.eggs, tx));
        const dims = { ...context, branchId: batch.branchId, farmId: batch.farmId, penHouseId: batch.penHouseId };

        const journal = await this.posting.post(
          {
            sourceModule: 'poultry-egg',
            sourceDocumentType: 'EggCollectionBatch',
            sourceDocumentId: batch.id,
            journalNumber: `EGG-${batch.code}`,
            journalDate: batch.collectedOn,
            narration: `${eggs} eggs collected (${batch.code})`,
            ...dims,
            idempotencyKey: `egg-collection:${batch.id}`,
            actor,
            lines: [
              { glAccountId: inventory, description: `PCR-067 — ${eggs} eggs into stock`, debit: kobo(valueKobo), dimensions: dims },
              { glAccountId: gain, description: `PCR-067 — eggs at ${naira(policy.valuePerUnitKobo)} per ${policy.eggsPerUnit}`, credit: kobo(valueKobo), dimensions: dims },
            ],
          },
          tx,
        );

        await this.stock.receiveIn({
          tx,
          companyId: batch.companyId,
          branchId: batch.branchId,
          itemId: item.id,
          warehouseId,
          quantity,
          valueKobo,
          batchReference: batch.code,
          sourceModule: 'poultry-egg',
          sourceDocumentType: 'EggCollectionBatch',
          sourceDocumentId: batch.id,
          documentReference: `EGG-${batch.code}`,
          movementDate: batch.collectedOn,
          journalEntryId: journal.journalEntryId,
        });

        await tx.eggCollectionBatch.update({
          where: { id: batch.id },
          data: { journalEntryId: journal.journalEntryId, itemId: item.id, eggsPerUnit: policy.eggsPerUnit, valueKobo, hatchingValueKobo },
        });
      });
    });
  }

  /** PCR-068 — set eggs leave stock at average cost into Eggs in Incubation. */
  async postIncubation(incubationId: string, actor: WorkflowActor): Promise<{ posted: boolean; reason?: string }> {
    const incubation = await this.prisma.incubationBatch.findUnique({
      where: { id: incubationId },
      include: { eggBatch: true },
    });
    if (!incubation || incubation.journalEntryId) return { posted: false };
    const source = incubation.eggBatch;
    if (!source.journalEntryId || !source.itemId || !source.eggsPerUnit) {
      return { posted: false, reason: `${incubation.code} waits for its collection ${source.code} to be valued first.` };
    }

    return this.attempt(`Incubation ${incubation.code}`, async () => {
      await this.prisma.$transaction(async (tx) => {
        const item = await tx.item.findUniqueOrThrow({ where: { id: source.itemId! } });
        const [context, incubationAccount, warehouseId] = await Promise.all([
          this.context(tx, incubation.companyId, incubation.setOn),
          this.account(incubation.companyId, ACCOUNT.incubation, tx),
          this.warehouse(tx, incubation.companyId, item.defaultWarehouseId),
        ]);
        const inventory = item.inventoryGlAccountId ?? (await this.account(incubation.companyId, ACCOUNT.eggs, tx));
        const dims = { ...context, branchId: source.branchId, farmId: source.farmId, penHouseId: source.penHouseId };

        const movement = {
          tx,
          companyId: incubation.companyId,
          branchId: source.branchId,
          itemId: item.id,
          warehouseId,
          quantity: new Decimal(incubation.setQuantity).div(source.eggsPerUnit!).toDecimalPlaces(6, Decimal.ROUND_HALF_UP),
          batchReference: source.code,
          sourceModule: 'poultry-egg',
          sourceDocumentType: 'IncubationBatch',
          sourceDocumentId: incubation.id,
          documentReference: `INC-${incubation.code}`,
          movementDate: incubation.setOn,
        };
        // Hatching eggs leave at their collection's hatching value — their
        // own price, not the average of everything in stock. The last setting
        // from a collection takes what is left, so rounding never strands a
        // kobo in Eggs. A collection posted before hatching eggs were priced
        // apart (hatchingValueKobo 0) leaves at the average, as it always did.
        const settingValue = await this.settingValue(tx, incubation.id, source);
        const issued =
          settingValue === null
            ? await this.stock.issueOut(movement)
            : await this.stock.issueOutAtValue({ ...movement, valueKobo: settingValue });
        if (issued.valueKobo <= 0n) return;

        const journal = await this.posting.post(
          {
            sourceModule: 'poultry-egg',
            sourceDocumentType: 'IncubationBatch',
            sourceDocumentId: incubation.id,
            journalNumber: `INC-${incubation.code}`,
            journalDate: incubation.setOn,
            narration: `${incubation.setQuantity} eggs set (${incubation.code})`,
            ...dims,
            idempotencyKey: `egg-incubation:${incubation.id}`,
            actor,
            lines: [
              { glAccountId: incubationAccount, description: `PCR-068 — ${incubation.setQuantity} eggs set`, debit: kobo(issued.valueKobo), dimensions: dims },
              { glAccountId: inventory, description: `PCR-068 — eggs out of stock (${source.code})`, credit: kobo(issued.valueKobo), dimensions: dims },
            ],
          },
          tx,
        );

        await tx.incubationBatch.update({
          where: { id: incubation.id },
          data: { journalEntryId: journal.journalEntryId, valueKobo: issued.valueKobo },
        });
      });
    });
  }

  /**
   * What a setting of hatching eggs is worth: its share of the collection's
   * hatching value by count, with the last setting taking the remainder.
   * Null when the collection carries no separate hatching value.
   */
  private async settingValue(
    tx: Prisma.TransactionClient,
    incubationId: string,
    source: { id: string; hatchingCount: number; hatchingValueKobo: bigint },
  ): Promise<bigint | null> {
    if (source.hatchingValueKobo <= 0n || source.hatchingCount <= 0) return null;
    const incubation = await tx.incubationBatch.findUniqueOrThrow({ where: { id: incubationId } });
    const earlier = await tx.incubationBatch.findMany({
      where: { eggBatchId: source.id, journalEntryId: { not: null }, id: { not: incubationId } },
      select: { setQuantity: true, valueKobo: true },
    });
    const setBefore = earlier.reduce((n, e) => n + e.setQuantity, 0);
    const valuedBefore = earlier.reduce((v, e) => v + e.valueKobo, 0n);
    if (setBefore + incubation.setQuantity >= source.hatchingCount) return source.hatchingValueKobo - valuedBefore;
    return BigInt(
      new Decimal(source.hatchingValueKobo.toString())
        .mul(incubation.setQuantity)
        .div(source.hatchingCount)
        .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .toFixed(0),
    );
  }

  /** PCR-069 — the set value goes to the chicks that hatched. */
  async postHatch(hatchId: string, actor: WorkflowActor): Promise<{ posted: boolean; reason?: string }> {
    const hatch = await this.prisma.hatchEvent.findUnique({
      where: { id: hatchId },
      include: { incubationBatch: { include: { eggBatch: true } } },
    });
    if (!hatch || hatch.journalEntryId) return { posted: false };
    const incubation = hatch.incubationBatch;
    if (!incubation.journalEntryId) {
      return { posted: false, reason: `The hatch from ${incubation.code} waits for the setting to be valued first.` };
    }
    if (incubation.valueKobo <= 0n) return { posted: false };

    return this.attempt(`Hatch from ${incubation.code}`, async () => {
      await this.prisma.$transaction(async (tx) => {
        const source = incubation.eggBatch;
        const chicks = hatch.hatchedCount > 0 && hatch.chickGroupId;
        const [context, incubationAccount, target] = await Promise.all([
          this.context(tx, hatch.companyId, hatch.hatchedOn),
          this.account(hatch.companyId, ACCOUNT.incubation, tx),
          this.account(
            hatch.companyId,
            chicks
              ? ACCOUNT.poultry
              : speciesNumberFor(await chartVersionOf(tx, hatch.companyId), 'productionLoss', 'poultry')!,
            tx,
          ),
        ]);
        const group = chicks ? await tx.livestockGroup.findUniqueOrThrow({ where: { id: hatch.chickGroupId! } }) : null;
        const dims = {
          ...context,
          branchId: group?.branchId ?? source.branchId,
          farmId: group?.farmId ?? source.farmId,
          penHouseId: group?.penHouseId ?? source.penHouseId,
          ...(chicks ? {} : { costCentreId: await this.costCentre(tx, hatch.companyId) }),
        };

        const journal = await this.posting.post(
          {
            sourceModule: 'poultry-egg',
            sourceDocumentType: 'HatchEvent',
            sourceDocumentId: hatch.id,
            journalNumber: `HATCH-${incubation.code}`,
            journalDate: hatch.hatchedOn,
            narration: chicks
              ? `${hatch.hatchedCount} chicks hatched into ${group!.code} (${incubation.code})`
              : `No chicks hatched from ${incubation.code}`,
            ...dims,
            idempotencyKey: `egg-hatch:${hatch.id}`,
            actor,
            lines: [
              {
                glAccountId: target,
                description: chicks ? `PCR-069 — ${hatch.hatchedCount} day-old chicks` : `PCR-069 — incubation lost, no chicks`,
                debit: kobo(incubation.valueKobo),
                dimensions: dims,
              },
              { glAccountId: incubationAccount, description: `PCR-069 — out of incubation (${incubation.code})`, credit: kobo(incubation.valueKobo), dimensions: dims },
            ],
          },
          tx,
        );

        await tx.hatchEvent.update({ where: { id: hatch.id }, data: { journalEntryId: journal.journalEntryId } });
        // The chicks' carrying value is what the eggs were worth, the same
        // field a bought flock carries its purchase cost in.
        if (group) {
          await tx.livestockGroup.update({ where: { id: group.id }, data: { acquisitionCostKobo: incubation.valueKobo } });
        }
      });
    });
  }

  /** Everything still waiting, in the order each step depends on the last. */
  async postPending(companyId: string, actor: WorkflowActor) {
    const reasons = new Set<string>();
    const tally = { posted: 0, failed: 0 };
    const count = (outcome: { posted: boolean; reason?: string }) => {
      if (outcome.posted) tally.posted += 1;
      else if (outcome.reason) {
        tally.failed += 1;
        reasons.add(outcome.reason);
      }
    };

    const collections = await this.prisma.eggCollectionBatch.findMany({
      where: { companyId, journalEntryId: null },
      orderBy: { collectedOn: 'asc' },
      select: { id: true },
    });
    for (const c of collections) count(await this.postCollection(c.id, actor));

    const incubations = await this.prisma.incubationBatch.findMany({
      where: { companyId, journalEntryId: null },
      orderBy: { setOn: 'asc' },
      select: { id: true },
    });
    for (const i of incubations) count(await this.postIncubation(i.id, actor));

    const hatches = await this.prisma.hatchEvent.findMany({
      where: { companyId, journalEntryId: null },
      orderBy: { hatchedOn: 'asc' },
      select: { id: true },
    });
    for (const h of hatches) count(await this.postHatch(h.id, actor));

    return { ...tally, reasons: [...reasons] };
  }

  /** How many egg records are still waiting to post, for the Controls backlog. */
  async pendingCount(companyId: string) {
    const [collections, incubations, hatches] = await Promise.all([
      this.prisma.eggCollectionBatch.count({
        where: { companyId, journalEntryId: null, OR: [{ hatchingCount: { gt: 0 } }, { tableCount: { gt: 0 } }] },
      }),
      this.prisma.incubationBatch.count({ where: { companyId, journalEntryId: null } }),
      this.prisma.hatchEvent.count({ where: { companyId, journalEntryId: null } }),
    ]);
    return collections + incubations + hatches;
  }

  /* ------------------------------------------------------------------ */

  /** Run a posting; a refusal is reported, never thrown — the record stays. */
  private async attempt(what: string, run: () => Promise<void>): Promise<{ posted: boolean; reason?: string }> {
    try {
      await run();
      return { posted: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${what} did not post: ${message}`);
      return { posted: false, reason: message };
    }
  }

  private async context(tx: Prisma.TransactionClient, companyId: string, on: Date) {
    const period = await tx.financialPeriod.findFirst({
      where: { financialYear: { companyId }, startDate: { lte: on }, endDate: { gte: on }, status: 'OPEN' },
    });
    if (!period) {
      throw new AccountingRuleViolation('§9 — Financial period', `No open accounting period covers ${day(on)}.`, {});
    }
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: { baseCurrencyId: true } });
    return {
      companyId,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      currencyId: company.baseCurrencyId,
      exchangeRate: '1',
    };
  }

  private async account(companyId: string, number: string, client: Prisma.TransactionClient | PrismaService): Promise<string> {
    const account = await client.gLAccount.findFirst({ where: { companyId, accountNumber: number, active: true }, select: { id: true } });
    if (!account) {
      throw new AccountingRuleViolation(
        'PCR-067/068/069 — Egg posting',
        `Eggs post to account ${number}, which this chart does not have. Load the posting rules on Controls first.`,
        { accountNumber: number },
      );
    }
    return account.id;
  }

  private async warehouse(tx: Prisma.TransactionClient, companyId: string, preferred: string | null): Promise<string> {
    if (preferred) return preferred;
    const warehouse = await tx.warehouse.findFirst({ where: { companyId, active: true }, orderBy: { code: 'asc' }, select: { id: true } });
    if (!warehouse) throw new AccountingRuleViolation('PCR-067 — Egg stock', 'No store is set up to hold eggs.', {});
    return warehouse.id;
  }

  private async costCentre(tx: Prisma.TransactionClient, companyId: string): Promise<string | null> {
    const centre = await tx.costCentre.findFirst({ where: { companyId, active: true }, orderBy: { code: 'asc' }, select: { id: true } });
    return centre?.id ?? null;
  }
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** For journal text: the ₦ sign has no place in every database encoding, NGN does. */
function naira(k: bigint): string {
  return `NGN ${(k / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(k % 100n).toString().padStart(2, '0')}`;
}
