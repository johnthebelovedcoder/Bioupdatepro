import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { SalesOrderService } from '../sales/sales-order.service';
import { PurchaseOrderService } from '../procurement/purchase-order.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Sales and purchases arriving from the phone.
 *
 * These two were the last kinds the outbox could not send. They are not
 * operational events like a round or a harvest — they are trade, and O2C and
 * P2P already own that end to end: pricing, VAT, withholding, the stock
 * movement, the posting and the register entry that has to agree with it.
 *
 * So NOTHING here posts anything. It is a translator, and that is the whole
 * design argument: a second path that produced its own journal for a gate sale
 * would be a second opinion about what a sale does to the ledger, and the two
 * would drift the first time a tax rate changed. There is one posting path and
 * this feeds it.
 *
 * What it does instead is record the document and submit it for approval. That
 * is not a limitation dressed up as a principle — §2 makes maker-checker
 * structural, and a sale that posted itself the moment a handset came back into
 * signal would be a farm worker with unreviewed access to revenue recognition.
 * The person at the gate records what happened; finance approves it and it
 * posts through the same route every other invoice takes.
 *
 * The honest consequence, which the interface must state and not bury: after
 * this succeeds the money is NOT yet in the ledger. It is a submitted document
 * waiting for somebody to approve.
 */
@Injectable()
export class TradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly salesOrders: SalesOrderService,
    private readonly purchaseOrders: PurchaseOrderService,
  ) {}

  /* --- Sales ------------------------------------------------------------ */

  async recordSale(params: {
    companyId: string;
    actor: WorkflowActor;
    idempotencyKey: string;
    payload: SalePayload;
  }) {
    const { companyId, actor, idempotencyKey, payload } = params;

    return this.once('operations.sale', idempotencyKey, payload, async () => {
      {
        const context = await this.tradingContext(companyId);

        /*
         * A walk-in has no customer record, and the gate sale is exactly the
         * transaction this product exists to capture — so rather than refuse
         * it, the sale is booked against the company's counter-sale customer.
         * Refusing would send the seller back to a paper receipt, which is the
         * failure this replaces.
         */
        const customerId =
          payload.buyer.customerId ?? (await this.counterSaleCustomer(companyId)).id;

        const items = await this.resolveItems(
          companyId,
          payload.lines.map((line) => line.itemId ?? line.code),
        );

        const lines = payload.lines.map((line, index) => ({
          lineNumber: index + 1,
          itemId: items.get(line.itemId ?? line.code)!,
          quantity: new Decimal(line.quantity),
          unitPriceKobo: BigInt(line.unitPriceKobo),
        }));

        if (lines.length === 0) {
          throw new BadRequestException('A sale needs at least one line.');
        }

        const order = await this.salesOrders.createOrder({
          companyId,
          orderNumber: documentNumber('SO', payload.date, idempotencyKey),
          customerId,
          orderDate: new Date(payload.date),
          currencyId: context.currencyId,
          branchId: context.branchId,
          warehouseId: context.warehouseId,
          farmId: context.farmId,
          lines,
          actor,
        });

        await this.salesOrders.submitOrder({ salesOrderId: order.id, actor });

        /*
         * Livestock leaving the farm is an operational fact as well as a
         * financial one, and it is recorded here rather than left to the
         * posting: the population has to fall when the animals go, whatever
         * happens to the invoice afterwards.
         */
        const removals = payload.lines.filter((line) => (line.animalsRemoved ?? 0) > 0);
        const reduced: string[] = [];
        for (const line of removals) {
          if (!line.batchId) continue;
          const group = await this.prisma.livestockGroup.findFirst({
            where: {
              companyId,
              OR: [
                ...(isUuid(line.batchId) ? [{ id: line.batchId }] : []),
                { code: line.batchId },
              ],
            },
          });
          if (!group) continue;
          if (group.population < line.animalsRemoved!) {
            throw new BadRequestException(
              `${group.code} has ${group.population} left — cannot sell ${line.animalsRemoved}.`,
            );
          }
          await this.prisma.livestockGroup.update({
            where: { id: group.id },
            data: { population: { decrement: line.animalsRemoved! } },
          });
          reduced.push(group.code);
        }

        return {
          reference: order.id,
          result: {
            salesOrderId: order.id,
            orderNumber: order.orderNumber,
            status: 'SUBMITTED',
            populationsReduced: reduced,
            // Said plainly, because the phone shows it to the person who sold.
            note: 'Recorded and sent for approval. It reaches the ledger once approved.',
          },
        };
      }
    });
  }

  /* --- Purchases -------------------------------------------------------- */

  async recordPurchase(params: {
    companyId: string;
    actor: WorkflowActor;
    idempotencyKey: string;
    payload: PurchasePayload;
  }) {
    const { companyId, actor, idempotencyKey, payload } = params;

    return this.once('operations.purchase', idempotencyKey, payload, async () => {
      {
        const context = await this.tradingContext(companyId);

        const supplier = await this.prisma.supplier.findFirst({
          where: {
            companyId,
            OR: [
              ...(isUuid(payload.supplierId) ? [{ id: payload.supplierId }] : []),
              { code: payload.supplierId },
            ],
          },
        });
        if (!supplier) {
          throw new BadRequestException('That supplier does not exist on this company.');
        }

        const items = await this.resolveItems(
          companyId,
          payload.lines.map((line) => line.itemId ?? line.code),
        );

        const lines = payload.lines.map((line, index) => ({
          lineNumber: index + 1,
          itemId: items.get(line.itemId ?? line.code)!,
          quantity: new Decimal(line.quantity),
          unitPriceKobo: BigInt(line.unitCostKobo),
        }));

        if (lines.length === 0) {
          throw new BadRequestException('A purchase needs at least one line.');
        }

        const order = await this.purchaseOrders.createOrder({
          companyId,
          orderNumber: documentNumber('PO', payload.date, idempotencyKey),
          supplierId: supplier.id,
          orderDate: new Date(payload.date),
          currencyId: context.currencyId,
          branchId: context.branchId,
          warehouseId: context.warehouseId,
          farmId: context.farmId,
          lines,
          actor,
        });

        await this.purchaseOrders.submitOrder({ purchaseOrderId: order.id, actor });

        /*
         * "Goods received" from the phone still stops at a submitted order.
         *
         * A goods receipt moves stock and posts GRNI, and it is raised against
         * an APPROVED order — receipting against one nobody has approved yet
         * would put the control after the money. So the arrival is recorded as
         * the order it belongs to, and the receipt is raised in the store
         * screens once the order is approved. Stated rather than silently
         * downgraded, because the person who took delivery needs to know the
         * stock has not moved yet.
         */
        return {
          reference: order.id,
          result: {
            purchaseOrderId: order.id,
            orderNumber: order.orderNumber,
            status: 'SUBMITTED',
            receiptRaised: false,
            note:
              payload.type === 'goods-received'
                ? 'Recorded as an order and sent for approval. Stock moves when the goods receipt is raised against it.'
                : 'Recorded and sent for approval.',
          },
        };
      }
    });
  }

  /**
   * Do this once, however many times the handset sends it.
   *
   * IdempotencyService reserves and commits INSIDE the caller's transaction,
   * which is the stronger guarantee and the right one everywhere else in this
   * codebase. It cannot be used here: the sales and purchase services open
   * transactions of their own, and wrapping them in an outer one would nest.
   *
   * So this is check-then-act, with the unique constraint on (scope, key) as
   * the real backstop. Two concurrent identical submissions can both pass the
   * check; the loser then fails to insert and is answered as a replay rather
   * than raising a second order. The window is narrow — the outbox sends
   * serially per device — and the constraint, not the check, is what makes it
   * safe.
   */
  private async once<T>(
    scope: string,
    key: string,
    payload: unknown,
    work: () => Promise<{ reference: string; result: T }>,
  ): Promise<T | { replayed: true; reference: string }> {
    const hash = IdempotencyService.hash(payload);

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== hash) {
        // The same key with different contents is a client bug worth
        // surfacing, not something to absorb silently.
        throw new ConflictException('That idempotency key was used for a different submission.');
      }
      return { replayed: true, reference: existing.resultRef };
    }

    const { reference, result } = await work();

    try {
      await this.prisma.idempotencyRecord.create({
        data: { scope, key, requestHash: hash, resultRef: reference },
      });
    } catch {
      // Lost the race. The other request's document stands; ours would be a
      // duplicate, and saying so is better than reporting a second success.
      return { replayed: true, reference };
    }

    return result;
  }

  /* ---------------------------------------------------------------------- */

  /**
   * Turn whatever the phone called an item into an item id.
   *
   * It may send either — a uuid where the screen read the item master, or a
   * code like FD-LAYER where it read a list held in the browser. Accepting both
   * is not laxity: the alternative is refusing a feed purchase because the
   * screen that raised it has not been switched over yet, and a refused feed
   * order is a farm that runs out of feed.
   *
   * Resolved in one query rather than per line, and an unknown reference is
   * named in the error so the person can see which line is wrong.
   */
  private async resolveItems(companyId: string, references: string[]) {
    const wanted = [...new Set(references.filter(Boolean))];
    if (wanted.length === 0) {
      throw new BadRequestException('No items on this document.');
    }

    /*
     * The uuid test is not cosmetic. Postgres compares a uuid column by casting
     * the operand, so handing it "FD-LAYER" raises a driver error rather than
     * simply not matching — the query has to be told which references could
     * possibly be ids before it runs.
     */
    const ids = wanted.filter(isUuid);
    const found = await this.prisma.item.findMany({
      where: {
        companyId,
        OR: [...(ids.length > 0 ? [{ id: { in: ids } }] : []), { code: { in: wanted } }],
      },
      select: { id: true, code: true },
    });

    const byReference = new Map<string, string>();
    for (const item of found) {
      byReference.set(item.id, item.id);
      byReference.set(item.code, item.id);
    }

    const missing = wanted.filter((reference) => !byReference.has(reference));
    if (missing.length > 0) {
      throw new BadRequestException(
        `These are not in the item master: ${missing.join(', ')}. They have to exist before they can be bought or sold.`,
      );
    }
    return byReference;
  }

  /**
   * The dimensions every trade document needs.
   *
   * Resolved from the company rather than accepted from the handset. A phone
   * that has been offline is not a source of authority about which branch or
   * warehouse a sale belongs to, and letting it name them would let it post
   * into a part of the business it has nothing to do with.
   */
  private async tradingContext(companyId: string) {
    const [company, branch, warehouse, farm] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
      this.prisma.branch.findFirst({ where: { companyId, active: true }, orderBy: { code: 'asc' } }),
      this.prisma.warehouse.findFirst({
        where: { companyId, active: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.farm.findFirst({ where: { companyId, active: true }, orderBy: { code: 'asc' } }),
    ]);

    if (!branch || !warehouse) {
      throw new BadRequestException(
        'This company has no active branch and warehouse, so a trade document cannot be raised.',
      );
    }

    return {
      currencyId: company.baseCurrencyId,
      branchId: branch.id,
      warehouseId: warehouse.id,
      farmId: farm?.id ?? null,
    };
  }

  /**
   * The customer a gate sale is booked against.
   *
   * One per company, created on first use. A named row rather than a null
   * customer: receivables, ageing and the VAT return all group by customer, and
   * a sale with no counterparty falls out of every one of them.
   */
  private async counterSaleCustomer(companyId: string) {
    const existing = await this.prisma.customer.findFirst({
      where: { companyId, code: 'CUS-COUNTER' },
    });
    if (existing) return existing;

    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    return this.prisma.customer.create({
      data: {
        company: { connect: { id: companyId } },
        currency: { connect: { id: company.baseCurrencyId } },
        code: 'CUS-COUNTER',
        name: 'Counter sales',
        category: 'Gate sale',
      },
    });
  }
}

/**
 * A readable, unique, STABLE document number.
 *
 * Derived from the idempotency key rather than a counter, so a retry of the
 * same submission produces the same number instead of burning a new one in the
 * sequence every time a handset loses signal mid-send.
 */
/** Whether a reference could be a database id at all. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function documentNumber(prefix: string, date: string, idempotencyKey: string): string {
  const day = date.replace(/-/g, '').slice(0, 8);
  const suffix = idempotencyKey.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `${prefix}-${day}-${suffix}`;
}

/* -------------------------------------------------------------------------- */

export interface SalePayload {
  type: 'sale';
  date: string;
  buyer: { customerId?: string; walkIn?: string };
  paidNow: boolean;
  method: string | null;
  termsDays: number;
  lines: Array<{
    itemId?: string;
    code: string;
    quantity: number;
    unitPriceKobo: string;
    vat: string;
    batchId?: string | null;
    animalsRemoved?: number;
  }>;
  totalKobo: string;
  vatKobo: string;
}

export interface PurchasePayload {
  type: 'purchase-order' | 'goods-received';
  date: string;
  supplierId: string;
  reference: string | null;
  paidNow: boolean;
  lines: Array<{
    itemId?: string;
    code: string;
    quantity: number;
    unit: string;
    unitCostKobo: string;
  }>;
  totalKobo: string;
}
