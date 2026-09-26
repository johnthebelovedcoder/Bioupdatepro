import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { StockDirection } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';

export interface TraceNode {
  kind:
    | 'INVOICE' | 'DELIVERY' | 'LINE' | 'RECEIPT' | 'PRODUCTION' | 'HARVEST' | 'POPULATION' | 'HATCH'
    | 'BREEDING' | 'EGG_BATCH' | 'FEED' | 'TREATMENT' | 'TRANSFER' | 'COUNT' | 'RETURN' | 'OTHER' | 'GAP';
  title: string;
  reference?: string;
  date?: string;
  quantity?: string;
  details?: Record<string, string>;
  children: TraceNode[];
}

type Movement = {
  id: string;
  itemId: string;
  warehouseId: string;
  direction: StockDirection;
  quantity: Decimal;
  batchReference: string | null;
  sourceDocumentType: string;
  sourceDocumentId: string;
  documentReference: string;
  movementDate: Date;
};

const MAX_DEPTH = 10;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : undefined);
const qty = (d: Decimal) => d.toDecimalPlaces(3).toString();

/**
 * Lot traceability (Acceptance_Criteria AC-011): a sale traced back through
 * stock, production, harvest, population and its origins to the goods
 * receipts and inputs, in one query.
 *
 * Inventory is valued at pooled moving average (POL-002), so a unit on the
 * shelf carries no lot of its own. What was issued is matched to what had
 * been received by quantity, first in first out, within each item and store —
 * a lot reference named on the issue is matched first. That matching is for
 * tracing only; valuation is untouched. It is deterministic because the stock
 * ledger is append-only.
 */
@Injectable()
export class TraceabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve a document number, lot, production order or population code and trace it back. */
  async trace(companyId: string, reference: string) {
    const ref = reference.trim();
    if (!ref) throw new NotFoundException('Give a delivery, invoice, lot, production order or population to trace.');
    const run = new TraceRun(this.prisma, companyId);

    const delivery = await this.prisma.deliveryNote.findFirst({ where: { companyId, deliveryNumber: ref }, select: { id: true } });
    if (delivery) return { reference: ref, resolvedAs: 'Delivery note', tree: await run.delivery(delivery.id, 0) };

    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { companyId, invoiceNumber: ref },
      select: { id: true, invoiceNumber: true, invoiceDate: true, customer: { select: { name: true } }, lines: { select: { salesOrderLineId: true } } },
    });
    if (invoice) {
      const orderLineIds = invoice.lines.map((l) => l.salesOrderLineId).filter((id): id is string => Boolean(id));
      const deliveries = await this.prisma.deliveryNote.findMany({
        where: { companyId, lines: { some: { salesOrderLineId: { in: orderLineIds } } } },
        select: { id: true },
        orderBy: { deliveryDate: 'asc' },
      });
      const tree: TraceNode = {
        kind: 'INVOICE',
        title: `Invoice ${invoice.invoiceNumber} to ${invoice.customer.name}`,
        reference: invoice.invoiceNumber,
        date: iso(invoice.invoiceDate),
        children: [],
      };
      for (const d of deliveries) tree.children.push(await run.delivery(d.id, 1));
      if (tree.children.length === 0) tree.children.push(gap('No delivery found for this invoice’s order lines, so there is no stock to trace.'));
      return { reference: ref, resolvedAs: 'Sales invoice', tree };
    }

    const order = await this.prisma.productionOrder.findFirst({ where: { companyId, orderNumber: ref }, select: { id: true } });
    if (order) return { reference: ref, resolvedAs: 'Production order', tree: await run.productionOrder(order.id, null, 0) };

    const group = await this.prisma.livestockGroup.findFirst({ where: { companyId, code: ref }, select: { id: true } });
    if (group) return { reference: ref, resolvedAs: 'Population', tree: await run.population(group.id, 0) };

    const lots = await this.prisma.stockMovement.findMany({
      where: { companyId, batchReference: ref, direction: StockDirection.IN },
      orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }],
    });
    if (lots.length > 0) {
      const tree: TraceNode = { kind: 'LINE', title: `Lot ${ref}`, reference: ref, children: [] };
      for (const lot of lots) tree.children.push(await run.inbound(toMovement(lot), new Decimal(lot.quantity.toString()), 1));
      return { reference: ref, resolvedAs: 'Lot', tree };
    }

    throw new NotFoundException(`Nothing called ${ref} to trace: give a delivery or invoice number, a lot, a production order or a population code.`);
  }

  /** One stock movement traced back: an issue to the receipts it drew on, a receipt to its source. */
  async traceMovement(companyId: string, movementId: string) {
    const movement = await this.prisma.stockMovement.findFirst({ where: { id: movementId, companyId } });
    if (!movement) throw new NotFoundException('No such stock movement.');
    const run = new TraceRun(this.prisma, companyId);
    return movement.direction === StockDirection.OUT
      ? run.outbound(toMovement(movement), 0)
      : run.inbound(toMovement(movement), new Decimal(movement.quantity.toString()), 0);
  }

  /** The trace flattened for export: one row per node, with its depth. */
  static toRows(tree: TraceNode) {
    const rows: Array<{ depth: number; kind: string; title: string; reference: string; date: string; quantity: string; details: string }> = [];
    const walk = (node: TraceNode, depth: number) => {
      rows.push({
        depth,
        kind: node.kind,
        title: node.title,
        reference: node.reference ?? '',
        date: node.date ?? '',
        quantity: node.quantity ?? '',
        details: Object.entries(node.details ?? {}).map(([k, v]) => `${k}: ${v}`).join('; '),
      });
      node.children.forEach((child) => walk(child, depth + 1));
    };
    walk(tree, 0);
    return rows;
  }
}

function gap(title: string): TraceNode {
  return { kind: 'GAP', title, children: [] };
}

function toMovement(m: {
  id: string; itemId: string; warehouseId: string; direction: StockDirection; quantity: { toString(): string }; batchReference: string | null;
  sourceDocumentType: string; sourceDocumentId: string; documentReference: string; movementDate: Date;
}): Movement {
  return { ...m, quantity: new Decimal(m.quantity.toString()) };
}

/** One trace: caches the FIFO matching per item and store, and stops cycles. */
class TraceRun {
  private readonly allocations = new Map<string, Map<string, Array<{ source: Movement; quantity: Decimal }>>>();
  private readonly items = new Map<string, { code: string; description: string; unit: string }>();
  private readonly seenGroups = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly companyId: string,
  ) {}

  async delivery(deliveryId: string, depth: number): Promise<TraceNode> {
    const note = await this.prisma.deliveryNote.findFirstOrThrow({
      where: { id: deliveryId, companyId: this.companyId },
      select: { id: true, deliveryNumber: true, deliveryDate: true, customer: { select: { name: true } }, warehouse: { select: { code: true } } },
    });
    const node: TraceNode = {
      kind: 'DELIVERY',
      title: `Delivery ${note.deliveryNumber} to ${note.customer.name}`,
      reference: note.deliveryNumber,
      date: iso(note.deliveryDate),
      details: { store: note.warehouse.code },
      children: [],
    };
    const outs = await this.prisma.stockMovement.findMany({
      where: { companyId: this.companyId, sourceDocumentType: 'DeliveryNote', sourceDocumentId: note.id, direction: StockDirection.OUT },
      orderBy: { createdAt: 'asc' },
    });
    for (const out of outs) node.children.push(await this.outbound(toMovement(out), depth + 1));
    return node;
  }

  /**
   * What an issue drew on: the receipts it consumed, each traced back. When
   * only part of the issue is being followed (12 kg of a 20 kg transfer), its
   * sources are scaled to that share.
   */
  async outbound(out: Movement, depth: number, label?: string, share?: Decimal): Promise<TraceNode> {
    const item = await this.item(out.itemId);
    const followed = share && share.lt(out.quantity) ? share : out.quantity;
    const scale = followed.div(out.quantity);
    const node: TraceNode = {
      kind: 'LINE',
      title: label ?? `${qty(followed)} ${item.unit} ${item.code} — ${item.description}`,
      quantity: qty(followed),
      date: iso(out.movementDate),
      details: out.batchReference ? { lot: out.batchReference } : undefined,
      children: [],
    };
    if (depth > MAX_DEPTH) {
      node.children.push(gap('Trace stops here (depth limit).'));
      return node;
    }
    const drawn = await this.drawnFrom(out);
    let covered = new Decimal(0);
    for (const { source, quantity } of drawn) {
      covered = covered.plus(quantity);
      node.children.push(await this.inbound(source, quantity.mul(scale), depth + 1));
    }
    if (covered.lt(out.quantity)) {
      node.children.push(gap(`${qty(out.quantity.minus(covered).mul(scale))} ${item.unit} issued with no earlier receipt in the store to match it to.`));
    }
    return node;
  }

  /** Where a receipt into stock came from. */
  async inbound(movement: Movement, quantity: Decimal, depth: number): Promise<TraceNode> {
    const item = await this.item(movement.itemId);
    const amount = `${qty(quantity)} ${item.unit} ${item.code}`;
    switch (movement.sourceDocumentType) {
      case 'GoodsReceiptNote': {
        const grn = await this.prisma.goodsReceiptNote.findFirst({
          where: { id: movement.sourceDocumentId, companyId: this.companyId },
          select: { grnNumber: true, receiptDate: true, supplier: { select: { code: true, name: true } }, purchaseOrder: { select: { orderNumber: true } } },
        });
        return {
          kind: 'RECEIPT',
          title: grn ? `${amount} received on ${grn.grnNumber} from ${grn.supplier.name}` : `${amount} received on ${movement.documentReference}`,
          reference: grn?.grnNumber ?? movement.documentReference,
          date: iso(grn?.receiptDate ?? movement.movementDate),
          quantity: qty(quantity),
          details: {
            ...(grn ? { supplier: `${grn.supplier.code} — ${grn.supplier.name}`, 'purchase order': grn.purchaseOrder.orderNumber } : {}),
            ...(movement.batchReference ? { lot: movement.batchReference } : {}),
          },
          children: [],
        };
      }
      case 'ProductionOrder':
        return this.productionOrder(movement.sourceDocumentId, { amount, quantity }, depth);
      case 'InventoryTransfer': {
        const issue = await this.prisma.stockMovement.findFirst({
          where: { companyId: this.companyId, sourceDocumentType: 'InventoryTransfer', sourceDocumentId: movement.sourceDocumentId, direction: StockDirection.OUT, itemId: movement.itemId },
        });
        const node: TraceNode = {
          kind: 'TRANSFER',
          title: `${amount} transferred in on ${movement.sourceDocumentId}`,
          reference: movement.sourceDocumentId,
          date: iso(movement.movementDate),
          quantity: qty(quantity),
          children: [],
        };
        if (issue) node.children.push(await this.outbound(toMovement(issue), depth + 1, `Issued from the sending store on ${iso(issue.movementDate)}`, quantity));
        else node.children.push(gap('The sending side of this transfer was not found.'));
        return node;
      }
      case 'EggCollectionBatch': {
        const batch = await this.prisma.eggCollectionBatch.findFirst({
          where: { id: movement.sourceDocumentId, companyId: this.companyId },
          select: { code: true, collectedOn: true, sourceGroupId: true },
        });
        const node: TraceNode = {
          kind: 'EGG_BATCH',
          title: `${amount} collected in egg batch ${batch?.code ?? movement.documentReference}`,
          reference: batch?.code ?? movement.documentReference,
          date: iso(batch?.collectedOn ?? movement.movementDate),
          quantity: qty(quantity),
          children: [],
        };
        if (batch) node.children.push(await this.population(batch.sourceGroupId, depth + 1));
        return node;
      }
      case 'StockCount':
        return { kind: 'COUNT', title: `${amount} found on stock count ${movement.documentReference}`, reference: movement.documentReference, date: iso(movement.movementDate), quantity: qty(quantity), children: [] };
      case 'SalesReturn':
        return { kind: 'RETURN', title: `${amount} returned by a customer (${movement.documentReference})`, reference: movement.documentReference, date: iso(movement.movementDate), quantity: qty(quantity), children: [] };
      default:
        return {
          kind: 'OTHER',
          title: `${amount} brought in by ${movement.documentReference}`,
          reference: movement.documentReference,
          date: iso(movement.movementDate),
          quantity: qty(quantity),
          details: { source: movement.sourceDocumentType },
          children: [],
        };
    }
  }

  async productionOrder(orderId: string, share: { amount: string; quantity: Decimal } | null, depth: number): Promise<TraceNode> {
    const order = await this.prisma.productionOrder.findFirstOrThrow({
      where: { id: orderId, companyId: this.companyId },
      select: {
        id: true, orderNumber: true, processingCycle: true, completedAt: true, harvestRecordId: true, sourceGroupId: true,
        recipeVersion: { select: { version: true, recipe: { select: { code: true, name: true } } } },
      },
    });
    const node: TraceNode = {
      kind: 'PRODUCTION',
      title: `${share ? `${share.amount} made by ` : ''}${order.processingCycle === 'FEED_MILL' ? 'feed-mill run' : 'processing order'} ${order.orderNumber}`,
      reference: order.orderNumber,
      date: iso(order.completedAt),
      quantity: share ? qty(share.quantity) : undefined,
      details: { recipe: `${order.recipeVersion.recipe.code} v${order.recipeVersion.version} — ${order.recipeVersion.recipe.name}` },
      children: [],
    };
    if (depth > MAX_DEPTH) {
      node.children.push(gap('Trace stops here (depth limit).'));
      return node;
    }
    if (order.harvestRecordId) {
      const harvest = await this.prisma.harvestRecord.findFirst({
        where: { id: order.harvestRecordId, companyId: this.companyId },
        select: { harvestedOn: true, count: true, weightKg: true, grade: true, groupId: true },
      });
      if (harvest) {
        node.children.push({
          kind: 'HARVEST',
          title: `Harvest of ${harvest.count} (${new Decimal(harvest.weightKg.toString()).toDecimalPlaces(3).toString()} kg, grade ${harvest.grade})`,
          date: iso(harvest.harvestedOn),
          children: [await this.population(harvest.groupId, depth + 2)],
        });
      }
    } else if (order.sourceGroupId) {
      node.children.push(await this.population(order.sourceGroupId, depth + 1));
    }
    const materials = await this.prisma.stockMovement.findMany({
      where: { companyId: this.companyId, sourceDocumentType: 'ProductionOrder', sourceDocumentId: order.id, direction: StockDirection.OUT },
      orderBy: { createdAt: 'asc' },
    });
    for (const material of materials) node.children.push(await this.outbound(toMovement(material), depth + 1));
    return node;
  }

  async population(groupId: string, depth: number): Promise<TraceNode> {
    const group = await this.prisma.livestockGroup.findFirst({
      where: { id: groupId, companyId: this.companyId },
      select: {
        id: true, code: true, speciesKey: true, breed: true, purpose: true, startedOn: true, hatchedOn: true, openingPopulation: true,
        source: true, acquisitionCostKobo: true, farm: { select: { code: true } }, penHouse: { select: { code: true } },
      },
    });
    if (!group) return gap('Population not found.');
    const node: TraceNode = {
      kind: 'POPULATION',
      title: `${group.speciesKey === 'snail' ? 'Cohort' : 'Flock'} ${group.code} — ${group.breed}, ${group.purpose.toLowerCase()}`,
      reference: group.code,
      date: iso(group.startedOn),
      quantity: String(group.openingPopulation),
      details: {
        farm: group.farm.code,
        house: group.penHouse.code,
        ...(group.hatchedOn ? { hatched: iso(group.hatchedOn)! } : {}),
        ...(group.source ? { source: group.source } : {}),
        ...(group.acquisitionCostKobo > 0n ? { 'acquisition cost (kobo)': group.acquisitionCostKobo.toString() } : {}),
      },
      children: [],
    };
    if (this.seenGroups.has(group.id)) {
      node.children.push(gap('Already traced above.'));
      return node;
    }
    this.seenGroups.add(group.id);
    if (depth > MAX_DEPTH) {
      node.children.push(gap('Trace stops here (depth limit).'));
      return node;
    }

    // Where the animals came from.
    const [hatch, breeding, movedIn] = await Promise.all([
      this.prisma.hatchEvent.findFirst({
        where: { companyId: this.companyId, chickGroupId: group.id },
        select: { hatchedOn: true, hatchedCount: true, incubationBatch: { select: { code: true, setOn: true, eggBatch: { select: { code: true, collectedOn: true, sourceGroupId: true } } } } },
      }),
      this.prisma.snailBreedingCycle.findFirst({
        where: { companyId: this.companyId, hatchlingGroupId: group.id },
        select: { code: true, setOn: true, eggsLaid: true, hatchedCount: true, breederGroupId: true },
      }),
      this.prisma.harvestRecord.findMany({
        where: { companyId: this.companyId, movedToGroupId: group.id },
        select: { harvestedOn: true, count: true, groupId: true },
      }),
    ]);
    if (hatch) {
      const egg = hatch.incubationBatch.eggBatch;
      node.children.push({
        kind: 'HATCH',
        title: `Hatched ${hatch.hatchedCount} from incubation ${hatch.incubationBatch.code}, egg batch ${egg.code}`,
        date: iso(hatch.hatchedOn),
        details: { 'eggs collected': iso(egg.collectedOn)!, 'set in incubator': iso(hatch.incubationBatch.setOn)! },
        children: [await this.population(egg.sourceGroupId, depth + 1)],
      });
    }
    if (breeding) {
      node.children.push({
        kind: 'BREEDING',
        title: `Hatched ${breeding.hatchedCount ?? '—'} of ${breeding.eggsLaid} eggs in breeding cycle ${breeding.code}`,
        reference: breeding.code,
        date: iso(breeding.setOn),
        children: [await this.population(breeding.breederGroupId, depth + 1)],
      });
    }
    for (const moved of movedIn) {
      node.children.push({
        kind: 'HARVEST',
        title: `${moved.count} moved in from another population`,
        date: iso(moved.harvestedOn),
        children: [await this.population(moved.groupId, depth + 1)],
      });
    }
    if (!hatch && !breeding && movedIn.length === 0) {
      node.children.push({
        kind: 'OTHER',
        title: group.source ? `Placed from ${group.source}` : 'Placed with no recorded source',
        date: iso(group.startedOn),
        children: [],
      });
    }

    // What it ate: feed issued, by item, back to the receipts it came from.
    const feeds = await this.prisma.feedIssue.findMany({
      where: { dailyRecord: { groupId: group.id, companyId: this.companyId }, itemId: { not: null } },
      select: { id: true, itemId: true },
    });
    const byItem = new Map<string, string[]>();
    for (const f of feeds) byItem.set(f.itemId!, [...(byItem.get(f.itemId!) ?? []), f.id]);
    for (const [itemId, issueIds] of byItem) {
      const item = await this.item(itemId);
      const outs = await this.prisma.stockMovement.findMany({
        where: { companyId: this.companyId, sourceDocumentType: 'FEED_ISSUE', sourceDocumentId: { in: issueIds }, direction: StockDirection.OUT },
      });
      const total = outs.reduce((sum, o) => sum.plus(o.quantity.toString()), new Decimal(0));
      const feedNode: TraceNode = {
        kind: 'FEED',
        title: `Fed ${qty(total)} ${item.unit} ${item.code} — ${item.description} (${outs.length} issue${outs.length === 1 ? '' : 's'})`,
        quantity: qty(total),
        children: [],
      };
      // Sources summed across every issue of this feed.
      const sources = new Map<string, { source: Movement; quantity: Decimal }>();
      for (const out of outs) {
        for (const drawn of await this.drawnFrom(toMovement(out))) {
          const seen = sources.get(drawn.source.id);
          sources.set(drawn.source.id, { source: drawn.source, quantity: (seen?.quantity ?? new Decimal(0)).plus(drawn.quantity) });
        }
      }
      for (const { source, quantity } of sources.values()) feedNode.children.push(await this.inbound(source, quantity, depth + 2));
      node.children.push(feedNode);
    }

    const treatments = await this.prisma.treatmentRecord.findMany({
      where: { companyId: this.companyId, groupId: group.id },
      select: { name: true, givenOn: true, route: true, treatedCount: true },
      orderBy: { givenOn: 'asc' },
    });
    for (const t of treatments) {
      node.children.push({ kind: 'TREATMENT', title: `${t.name} (${t.route}) to ${t.treatedCount}`, date: iso(t.givenOn), children: [] });
    }
    return node;
  }

  /**
   * Which receipts an issue consumed: the store's movements replayed in
   * order, each issue taking from the oldest receipts still holding stock —
   * those carrying the issue's own lot reference first.
   */
  private async drawnFrom(out: Movement) {
    const key = `${out.itemId}:${out.warehouseId}`;
    let map = this.allocations.get(key);
    if (!map) {
      map = new Map();
      const rows = await this.prisma.stockMovement.findMany({
        where: { companyId: this.companyId, itemId: out.itemId, warehouseId: out.warehouseId },
        orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }],
      });
      const queue: Array<{ source: Movement; remaining: Decimal }> = [];
      for (const row of rows) {
        const movement = toMovement(row);
        if (movement.direction === StockDirection.IN) {
          queue.push({ source: movement, remaining: movement.quantity });
          continue;
        }
        let needed = movement.quantity;
        const taken: Array<{ source: Movement; quantity: Decimal }> = [];
        const order = movement.batchReference
          ? [...queue.filter((q) => q.source.batchReference === movement.batchReference), ...queue.filter((q) => q.source.batchReference !== movement.batchReference)]
          : queue;
        for (const lot of order) {
          if (needed.lte(0)) break;
          if (lot.remaining.lte(0)) continue;
          const take = Decimal.min(lot.remaining, needed);
          lot.remaining = lot.remaining.minus(take);
          needed = needed.minus(take);
          taken.push({ source: lot.source, quantity: take });
        }
        map.set(movement.id, taken);
      }
      this.allocations.set(key, map);
    }
    return map.get(out.id) ?? [];
  }

  private async item(itemId: string) {
    let item = this.items.get(itemId);
    if (!item) {
      const row = await this.prisma.item.findFirst({
        where: { id: itemId, companyId: this.companyId },
        select: { code: true, description: true, unitOfMeasure: { select: { code: true } } },
      });
      item = { code: row?.code ?? itemId, description: row?.description ?? '', unit: row?.unitOfMeasure.code ?? '' };
      this.items.set(itemId, item);
    }
    return item;
  }
}
