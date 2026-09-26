import Decimal from 'decimal.js';
import { Prisma, StockDirection, StockLotStatus } from '@bioassetpro/database';
import type { PrismaClient } from '@bioassetpro/database';
import { AccountingRuleViolation } from '../common/errors';

type Client = Prisma.TransactionClient | PrismaClient;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Movements that may take expired, quarantined or rejected stock: getting rid
 * of it (a write-off, a return to the supplier) and making the book agree
 * with the shelf (a count). Everything else — production, feeding, sales,
 * transfers — may only use stock that is fit to use.
 */
const MAY_TAKE_BLOCKED = new Set(['InventoryWriteOff', 'SupplierReturn', 'StockCount']);

export interface LotMeta {
  lotReference: string;
  expiryDate: Date | null;
  receivedOn: Date;
  status: StockLotStatus;
  sourceId: string;
  decidedAt: Date | null;
}

export interface LotBalance {
  warehouseId: string;
  /** Null for stock that came in with no lot. */
  lotReference: string | null;
  quantity: Decimal;
  lot: LotMeta | null;
  firstIn: Date;
}

const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Why a lot cannot be used on a day, or null when it can. */
export function blockedReason(lot: LotMeta | null, on: Date): string | null {
  if (!lot) return null;
  if (lot.status === StockLotStatus.REJECTED) return 'rejected';
  if (lot.status === StockLotStatus.QUARANTINE) return 'in quarantine';
  // Released from quarantine: it was not usable before the release.
  if (lot.decidedAt && on < lot.decidedAt) return 'in quarantine';
  if (lot.expiryDate && lot.expiryDate < dayOf(on)) return `expired ${lot.expiryDate.toISOString().slice(0, 10)}`;
  return null;
}

/** Record a lot, or tighten one already known: the earlier expiry, and quarantine wins. */
export async function registerLot(
  client: Client,
  params: {
    companyId: string;
    itemId: string;
    lotReference: string;
    expiryDate: Date | null;
    receivedOn: Date;
    quarantine: boolean;
    sourceType: string;
    sourceId: string;
    receivedById?: string | null;
  },
) {
  const existing = await client.stockLot.findFirst({
    where: { companyId: params.companyId, itemId: params.itemId, lotReference: params.lotReference },
  });
  if (!existing) {
    return client.stockLot.create({
      data: {
        companyId: params.companyId,
        itemId: params.itemId,
        lotReference: params.lotReference,
        expiryDate: params.expiryDate,
        receivedOn: params.receivedOn,
        status: params.quarantine ? StockLotStatus.QUARANTINE : StockLotStatus.AVAILABLE,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        receivedById: params.receivedById ?? null,
      },
    });
  }
  const expiry =
    existing.expiryDate && params.expiryDate
      ? existing.expiryDate < params.expiryDate
        ? existing.expiryDate
        : params.expiryDate
      : (existing.expiryDate ?? params.expiryDate);
  return client.stockLot.update({
    where: { id: existing.id },
    data: {
      expiryDate: expiry,
      ...(params.quarantine && existing.status === StockLotStatus.AVAILABLE
        ? { status: StockLotStatus.QUARANTINE, decidedAt: null, decidedById: null, receivedById: params.receivedById ?? existing.receivedById }
        : {}),
    },
  });
}

/** The day a shelf life ends, counted from a day. */
export function expiryFromShelfLife(from: Date, shelfLifeDays: number | null | undefined): Date | null {
  return shelfLifeDays ? new Date(dayOf(from).getTime() + shelfLifeDays * DAY) : null;
}

/**
 * What each lot of an item holds, store by store, rebuilt from the stock
 * ledger. A movement that names its lot takes from that lot; one that does
 * not takes from the store's lots earliest-expiry first (FEFO) — skipping
 * lots that were not usable on its day, which is exactly what the issue check
 * enforced when it was made. Null when the item has no lots at all, so items
 * that are not lot-controlled cost nothing extra.
 */
export async function lotBalances(client: Client, companyId: string, itemId: string, warehouseId?: string): Promise<LotBalance[] | null> {
  const lots = await client.stockLot.findMany({
    where: { companyId, itemId },
    select: { lotReference: true, expiryDate: true, receivedOn: true, status: true, sourceId: true, decidedAt: true },
  });
  if (lots.length === 0) return null;
  const byRef = new Map(lots.map((l) => [l.lotReference, l]));
  const bySource = new Map<string, LotMeta>();
  for (const l of lots) if (!bySource.has(l.sourceId)) bySource.set(l.sourceId, l);

  const movements = await client.stockMovement.findMany({
    where: { companyId, itemId, ...(warehouseId ? { warehouseId } : {}) },
    orderBy: [{ movementDate: 'asc' }, { createdAt: 'asc' }],
    select: { direction: true, quantity: true, batchReference: true, sourceDocumentId: true, warehouseId: true, movementDate: true },
  });

  const stores = new Map<string, Map<string, LotBalance>>();
  const bucketsOf = (w: string) => {
    let m = stores.get(w);
    if (!m) stores.set(w, (m = new Map()));
    return m;
  };

  for (const mv of movements) {
    const buckets = bucketsOf(mv.warehouseId);
    const qty = new Decimal(mv.quantity.toString());
    if (mv.direction === StockDirection.IN) {
      const lot = (mv.batchReference ? byRef.get(mv.batchReference) : undefined) ?? (!mv.batchReference ? bySource.get(mv.sourceDocumentId) : undefined) ?? null;
      const key = lot?.lotReference ?? mv.batchReference ?? '';
      const bucket = buckets.get(key) ?? { warehouseId: mv.warehouseId, lotReference: key || null, quantity: new Decimal(0), lot, firstIn: mv.movementDate };
      bucket.quantity = bucket.quantity.plus(qty);
      buckets.set(key, bucket);
      continue;
    }
    let left = qty;
    const named = mv.batchReference ? buckets.get(mv.batchReference) : undefined;
    if (named && named.quantity.gt(0)) {
      const take = Decimal.min(left, named.quantity);
      named.quantity = named.quantity.minus(take);
      left = left.minus(take);
    }
    if (left.gt(0)) {
      const ordered = fefo([...buckets.values()].filter((b) => b.quantity.gt(0)));
      const usable = ordered.filter((b) => !blockedReason(b.lot, mv.movementDate));
      const blocked = ordered.filter((b) => blockedReason(b.lot, mv.movementDate));
      for (const b of [...usable, ...blocked]) {
        if (left.lte(0)) break;
        const take = Decimal.min(left, b.quantity);
        b.quantity = b.quantity.minus(take);
        left = left.minus(take);
      }
    }
  }
  const out: LotBalance[] = [];
  for (const buckets of stores.values()) for (const b of buckets.values()) if (b.quantity.gt('0.000001')) out.push(b);
  return fefo(out);
}

/** Earliest expiry first, then oldest; stock with no lot or no expiry last. */
export function fefo<T extends { lot: LotMeta | null; firstIn: Date; lotReference: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ea = a.lot?.expiryDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const eb = b.lot?.expiryDate?.getTime() ?? Number.POSITIVE_INFINITY;
    if (ea !== eb) return ea - eb;
    if ((a.lotReference === null) !== (b.lotReference === null)) return a.lotReference === null ? 1 : -1;
    return a.firstIn.getTime() - b.firstIn.getTime();
  });
}

/**
 * Refuse, in words, an issue that would take expired, quarantined or rejected
 * stock (FR-FM-02 "prevent issue of quarantined, expired or insufficient
 * lots"; §55.3). Named lots are checked themselves; otherwise the store (or,
 * without a store check, the company) must hold enough that is fit to use.
 */
export async function assertUsableStock(
  client: Client,
  params: {
    companyId: string;
    itemId: string;
    warehouseId: string | null;
    quantity: Decimal;
    batchReference?: string | null;
    on: Date;
    documentReference: string;
    sourceDocumentType: string;
  },
) {
  if (MAY_TAKE_BLOCKED.has(params.sourceDocumentType)) return;
  const balances = await lotBalances(client, params.companyId, params.itemId, params.warehouseId ?? undefined);
  if (!balances) return;
  const rule = 'FR-FM-02 — Expired or quarantined stock';
  const item = await client.item.findFirst({ where: { id: params.itemId, companyId: params.companyId }, select: { code: true } });
  const code = item?.code ?? 'this item';

  if (params.batchReference) {
    const named = balances.filter((b) => b.lotReference === params.batchReference);
    const reason = named.length ? blockedReason(named[0]!.lot, params.on) : null;
    if (reason) {
      throw new AccountingRuleViolation(rule, `${params.documentReference}: lot ${params.batchReference} of ${code} is ${reason} and cannot be used. Write it off or return it.`, {
        itemId: params.itemId,
        lot: params.batchReference,
      });
    }
  }
  let usable = new Decimal(0);
  const blocked: string[] = [];
  for (const b of balances) {
    const reason = blockedReason(b.lot, params.on);
    if (reason) blocked.push(`${b.quantity.toFixed(3)} in lot ${b.lotReference} (${reason})`);
    else usable = usable.plus(b.quantity);
  }
  if (usable.lt(params.quantity)) {
    throw new AccountingRuleViolation(
      rule,
      `${params.documentReference}: ${params.quantity.toString()} of ${code} asked, but only ${usable.toFixed(3)} is fit to use${
        params.warehouseId ? ' in that store' : ''
      }${blocked.length ? ` — ${blocked.join('; ')}` : ''}. Use ${usable.toFixed(3)} or less; expired or rejected stock is written off or returned, quarantined stock waits for QA.`,
      { itemId: params.itemId, usable: usable.toFixed(6), requested: params.quantity.toString() },
    );
  }
}

/** Which lots a quantity would come from, earliest expiry first, using only usable stock. */
export async function allocateFefo(client: Client, params: { companyId: string; itemId: string; warehouseId: string; quantity: Decimal; on: Date }) {
  const balances = await lotBalances(client, params.companyId, params.itemId, params.warehouseId);
  if (!balances) return null;
  let left = params.quantity;
  const pieces: Array<{ lotReference: string | null; quantity: string }> = [];
  for (const b of balances) {
    if (left.lte(0)) break;
    if (blockedReason(b.lot, params.on)) continue;
    const take = Decimal.min(left, b.quantity);
    pieces.push({ lotReference: b.lotReference, quantity: take.toFixed(6) });
    left = left.minus(take);
  }
  if (left.gt(0)) pieces.push({ lotReference: null, quantity: left.toFixed(6) });
  return pieces;
}
