import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AuditAction, StockLotStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { allowsSelfApproval } from '../workflow/self-approval';
import { blockedReason, lotBalances } from './lots';

/** Who releases or rejects a quarantined lot. */
export const LOT_DECIDERS = ['QA_OFFICER', 'FARM_MANAGER', 'PRODUCTION_LEAD', 'FINANCE_CONTROLLER', 'CFO'];

const DAY = 24 * 60 * 60 * 1000;

/**
 * Lots, expiry and quarantine (handbook §35, §59.3 "Inventory Ageing/Expiry",
 * FR-FM-02): what each lot holds store by store, how old it is and how long
 * it has left; and QA's release or rejection of a quarantined lot.
 */
@Injectable()
export class LotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Stock ageing and expiry as of a day: every lot with stock, soonest to expire first. */
  async report(companyId: string, asOf = new Date(), withinDays?: number) {
    const lots = await this.prisma.stockLot.findMany({ where: { companyId }, select: { itemId: true } });
    const itemIds = [...new Set(lots.map((l) => l.itemId))];
    const [items, stores, lotRows] = await Promise.all([
      this.prisma.item.findMany({
        where: { companyId, id: { in: itemIds } },
        select: { id: true, code: true, description: true, weightedAverageCostKobo: true, unitOfMeasure: { select: { code: true } } },
      }),
      this.prisma.warehouse.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
      this.prisma.stockLot.findMany({ where: { companyId }, select: { id: true, itemId: true, lotReference: true, receivedById: true, decisionNote: true } }),
    ]);
    const rows = [];
    for (const item of items) {
      const balances = (await lotBalances(this.prisma, companyId, item.id)) ?? [];
      for (const b of balances) {
        const expiry = b.lot?.expiryDate ?? null;
        const daysToExpiry = expiry ? Math.floor((expiry.getTime() - asOf.getTime()) / DAY) : null;
        if (withinDays !== undefined && (daysToExpiry === null || daysToExpiry > withinDays)) continue;
        const reason = blockedReason(b.lot, asOf);
        const meta = b.lotReference ? lotRows.find((l) => l.itemId === item.id && l.lotReference === b.lotReference) : undefined;
        const store = stores.find((s) => s.id === b.warehouseId);
        rows.push({
          lotId: meta?.id ?? null,
          itemId: item.id,
          itemCode: item.code,
          description: item.description,
          unit: item.unitOfMeasure.code,
          store: store ? `${store.code} — ${store.name}` : '',
          lotReference: b.lotReference,
          receivedOn: (b.lot?.receivedOn ?? b.firstIn).toISOString().slice(0, 10),
          ageDays: Math.max(0, Math.floor((asOf.getTime() - (b.lot?.receivedOn ?? b.firstIn).getTime()) / DAY)),
          expiryDate: expiry ? expiry.toISOString().slice(0, 10) : null,
          daysToExpiry,
          status: b.lot?.status === StockLotStatus.AVAILABLE && reason?.startsWith('expired') ? 'EXPIRED' : (b.lot?.status ?? 'NO_LOT'),
          blocked: reason,
          quantity: b.quantity.toFixed(3),
          valueKobo: item.weightedAverageCostKobo
            ? BigInt(b.quantity.mul(item.weightedAverageCostKobo.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)).toString()
            : null,
          receivedById: meta?.receivedById ?? null,
          decisionNote: meta?.decisionNote ?? null,
        });
      }
    }
    rows.sort((a, b) => (a.daysToExpiry ?? Number.POSITIVE_INFINITY) - (b.daysToExpiry ?? Number.POSITIVE_INFINITY) || a.itemCode.localeCompare(b.itemCode));
    return rows;
  }

  /** Release a quarantined lot, or reject it — someone other than whoever received it. */
  async decide(params: { companyId: string; lotId: string; decision: 'RELEASE' | 'REJECT'; note?: string | null; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => LOT_DECIDERS.includes(r))) {
      throw new ForbiddenException('QA, the farm manager, the production lead or finance control release or reject a lot.');
    }
    const lot = await this.prisma.stockLot.findFirst({ where: { id: params.lotId, companyId: params.companyId } });
    if (!lot) throw new NotFoundException('No such lot.');
    if (lot.status !== StockLotStatus.QUARANTINE) throw new BadRequestException(`Lot ${lot.lotReference} is not in quarantine.`);
    if (lot.receivedById === params.actor.userId && !(await allowsSelfApproval(this.prisma, params.companyId))) {
      throw new ForbiddenException('You received this lot, so someone else releases or rejects it.');
    }
    if (params.decision === 'REJECT' && !params.note?.trim()) throw new BadRequestException('Say why the lot is rejected.');
    const status = params.decision === 'RELEASE' ? StockLotStatus.AVAILABLE : StockLotStatus.REJECTED;
    await this.prisma.stockLot.update({
      where: { id: lot.id },
      data: { status, decidedById: params.actor.userId, decidedAt: new Date(), decisionNote: params.note?.trim() || null },
    });
    await this.audit.write({
      transactionId: lot.id,
      module: 'inventory',
      entityType: 'StockLot',
      entityId: lot.id,
      status,
      action: params.decision === 'RELEASE' ? AuditAction.APPROVE : AuditAction.REJECT,
      userId: params.actor.userId,
      comments: `Lot ${lot.lotReference} ${params.decision === 'RELEASE' ? 'released from quarantine' : 'rejected'}${params.note?.trim() ? `: ${params.note.trim()}` : ''}.`,
    });
    return { id: lot.id, status };
  }

  /** An item's stock controls: quarantine on receipt, and shelf life in days. */
  async setItemControls(params: { companyId: string; itemId: string; quarantineOnReceipt: boolean; shelfLifeDays: number | null; actor: WorkflowActor }) {
    const item = await this.prisma.item.findFirst({ where: { id: params.itemId, companyId: params.companyId } });
    if (!item) throw new NotFoundException('No such item.');
    if (params.shelfLifeDays !== null && (!Number.isInteger(params.shelfLifeDays) || params.shelfLifeDays <= 0)) {
      throw new BadRequestException('Shelf life is a whole number of days above zero, or blank.');
    }
    await this.prisma.item.update({
      where: { id: item.id },
      data: { quarantineOnReceipt: params.quarantineOnReceipt, shelfLifeDays: params.shelfLifeDays },
    });
    await this.audit.write({
      transactionId: item.id,
      module: 'inventory',
      entityType: 'Item',
      entityId: item.id,
      status: 'ACTIVE',
      action: AuditAction.UPDATE,
      userId: params.actor.userId,
      oldValue: { quarantineOnReceipt: item.quarantineOnReceipt, shelfLifeDays: item.shelfLifeDays },
      newValue: { quarantineOnReceipt: params.quarantineOnReceipt, shelfLifeDays: params.shelfLifeDays },
      comments: `Stock controls for ${item.code}.`,
    });
    return { id: item.id };
  }
}
