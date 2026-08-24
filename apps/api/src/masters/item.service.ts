import { Injectable } from '@nestjs/common';
import { AuditAction, ItemType, TaxType } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { Kobo } from '../common/money';

/**
 * Long enough for a create plus its audit record on a cold connection pool.
 * The 5s default failed the first item created after a restart.
 */
const TRANSACTION_OPTIONS = { timeout: 20_000 };

/**
 * Item / Product master (§5).
 *
 * The GL-mapping validation here is the part that earns its keep: an inventory
 * item with no inventory account, or an expense item with no expense account,
 * produces a posting that cannot be built — and it is far cheaper to refuse
 * that at master-data entry than at three-way match.
 */
@Injectable()
export class ItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(input: {
    companyId: string;
    code: string;
    description: string;
    category?: string | null;
    itemType?: ItemType;
    isBiologicalFeed?: boolean;
    isManufactured?: boolean;
    unitOfMeasureCode: string;
    vatTaxCode?: string | null;
    preferredSupplierId?: string | null;
    reorderLevel?: string | null;
    economicOrderQuantity?: string | null;
    inventoryGlAccountId?: string | null;
    expenseGlAccountId?: string | null;
    revenueGlAccountId?: string | null;
    defaultWarehouseId?: string | null;
    standardCost?: Kobo | null;
    standardCostFrom?: Date | null;
    actorId: string;
  }) {
    const itemType = input.itemType ?? ItemType.INVENTORY;

    const uom = await this.prisma.unitOfMeasure.findUnique({
      where: { companyId_code: { companyId: input.companyId, code: input.unitOfMeasureCode } },
    });
    if (!uom) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Item master',
        `Unit of measure "${input.unitOfMeasureCode}" is not configured.`,
        { unitOfMeasure: input.unitOfMeasureCode },
      );
    }

    let vatTaxCodeId: string | null = null;
    if (input.vatTaxCode) {
      const taxCode = await this.prisma.taxCode.findUnique({
        where: { companyId_code: { companyId: input.companyId, code: input.vatTaxCode } },
      });
      if (!taxCode) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §4 — Tax Engine',
          `Tax code "${input.vatTaxCode}" is not configured.`,
          { taxCode: input.vatTaxCode },
        );
      }
      if (taxCode.taxType !== TaxType.VAT) {
        throw new AccountingRuleViolation(
          'Consolidated Reference §4 — Tax Engine',
          `Tax code "${input.vatTaxCode}" is a ${taxCode.taxType} code; an item carries a VAT code.`,
          { taxCode: input.vatTaxCode },
        );
      }
      vatTaxCodeId = taxCode.id;
    }

    // An item that cannot post is an item that will fail at the worst moment.
    if (itemType === ItemType.INVENTORY && !input.inventoryGlAccountId) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Item master',
        `Inventory item "${input.code}" needs a default inventory GL account: goods ` +
          `receipt posts Dr Inventory / Cr GRNI and has nowhere to debit without one.`,
        { itemCode: input.code },
      );
    }
    if (itemType === ItemType.EXPENSE && !input.expenseGlAccountId) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §5 — Item master',
        `Expense item "${input.code}" needs a default expense GL account.`,
        { itemCode: input.code },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          companyId: input.companyId,
          code: input.code,
          description: input.description,
          category: input.category ?? null,
          itemType,
          isBiologicalFeed: input.isBiologicalFeed ?? false,
          isManufactured: input.isManufactured ?? false,
          unitOfMeasureId: uom.id,
          vatTaxCodeId,
          preferredSupplierId: input.preferredSupplierId ?? null,
          reorderLevel: input.reorderLevel ?? null,
          economicOrderQuantity: input.economicOrderQuantity ?? null,
          inventoryGlAccountId: input.inventoryGlAccountId ?? null,
          expenseGlAccountId: input.expenseGlAccountId ?? null,
          revenueGlAccountId: input.revenueGlAccountId ?? null,
          defaultWarehouseId: input.defaultWarehouseId ?? null,
          ...(input.standardCost !== undefined && input.standardCost !== null
            ? {
                standardCosts: {
                  create: [
                    {
                      standardCostKobo: input.standardCost,
                      effectiveFrom: input.standardCostFrom ?? new Date('2026-01-01'),
                    },
                  ],
                },
              }
            : {}),
        },
      });

      await this.audit.write(
        {
          transactionId: item.id,
          module: 'masters',
          entityType: 'Item',
          entityId: item.id,
          status: 'ACTIVE',
          action: AuditAction.CREATE,
          userId: input.actorId,
          comments: `Created item ${item.code} — ${item.description}.`,
        },
        tx,
      );

      return item;
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Set a standard cost from a date, closing the previous one the day before.
   *
   * Costs are never edited in place: a production order costed last month must
   * still resolve the cost that applied then (§10.9 platform rule — BOM, labour,
   * overhead and yield are configurable AND effective-dated).
   */
  async setStandardCost(params: {
    itemId: string;
    cost: Kobo;
    effectiveFrom: Date;
    sourceReference?: string | null;
    actorId: string;
  }) {
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
      await tx.itemStandardCost.updateMany({
        where: { itemId: params.itemId, effectiveTo: null, effectiveFrom: { lt: day } },
        data: { effectiveTo: previousDay },
      });

      const created = await tx.itemStandardCost.create({
        data: {
          itemId: params.itemId,
          standardCostKobo: params.cost,
          effectiveFrom: day,
          sourceReference: params.sourceReference ?? null,
        },
      });

      await this.audit.write(
        {
          transactionId: params.itemId,
          module: 'masters',
          entityType: 'ItemStandardCost',
          entityId: created.id,
          status: 'ACTIVE',
          action: AuditAction.UPDATE,
          userId: params.actorId,
          comments:
            `Standard cost set to ${params.cost} kobo from ${day.toISOString().slice(0, 10)}.`,
          metadata: { costKobo: params.cost.toString() },
        },
        tx,
      );

      return created;
    }, TRANSACTION_OPTIONS);
  }

  async list(companyId: string, itemType?: ItemType) {
    return this.prisma.item.findMany({
      where: { companyId, ...(itemType ? { itemType } : {}) },
      orderBy: { code: 'asc' },
      include: {
        unitOfMeasure: { select: { code: true } },
        vatTaxCode: { select: { code: true } },
        standardCosts: {
          where: { effectiveTo: null },
          select: { standardCostKobo: true, effectiveFrom: true },
        },
      },
    });
  }
}
