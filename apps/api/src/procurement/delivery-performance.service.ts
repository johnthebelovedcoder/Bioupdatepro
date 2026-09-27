import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { GrnStatus, PurchaseOrderStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';

/**
 * PO/GRN delivery performance (REPORT_KPI_CATALOG AGR-002): for each
 * supplier, how much of what was ordered arrived in usable condition, how
 * much was rejected, and whether it came by the promised date.
 *
 *   fill rate      accepted ÷ ordered, on approved orders' lines
 *   rejection rate rejected ÷ received
 *   on time        orders whose first posted receipt came by the expected
 *                  delivery date, of those with a date and a receipt
 *   overdue        orders past their expected date still not fully received
 *
 * Only posted receipts count: a receipt still in approval has not arrived in
 * the books.
 */
const LIVE: PurchaseOrderStatus[] = ['APPROVED', 'PARTIALLY_RECEIVED', 'FULLY_RECEIVED', 'CLOSED'];
const DAY = 86_400_000;

@Injectable()
export class DeliveryPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async bySupplier(params: { companyId: string; from?: Date; to?: Date; asOf?: Date }) {
    const asOf = params.asOf ?? new Date();
    const orders = await this.prisma.purchaseOrder.findMany({
      where: {
        companyId: params.companyId,
        status: { in: LIVE },
        ...(params.from || params.to ? { orderDate: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } } : {}),
      },
      select: {
        id: true, orderNumber: true, orderDate: true, expectedDeliveryDate: true, status: true,
        supplier: { select: { id: true, name: true } },
        lines: { select: { id: true, quantity: true } },
      },
    });
    const receipts = await this.prisma.goodsReceiptNote.findMany({
      where: { companyId: params.companyId, status: GrnStatus.POSTED, purchaseOrderId: { in: orders.map((o) => o.id) } },
      select: { purchaseOrderId: true, receiptDate: true, lines: { select: { receivedQuantity: true, rejectedQuantity: true, acceptedQuantity: true } } },
      orderBy: { receiptDate: 'asc' },
    });

    type Tally = { supplier: string; orders: number; ordered: Decimal; received: Decimal; rejected: Decimal; accepted: Decimal; dated: number; onTime: number; daysLate: number; overdue: string[] };
    const bySupplier = new Map<string, Tally>();
    for (const order of orders) {
      const t = bySupplier.get(order.supplier.id) ?? { supplier: order.supplier.name, orders: 0, ordered: new Decimal(0), received: new Decimal(0), rejected: new Decimal(0), accepted: new Decimal(0), dated: 0, onTime: 0, daysLate: 0, overdue: [] };
      bySupplier.set(order.supplier.id, t);
      t.orders += 1;
      const ordered = order.lines.reduce((s, l) => s.plus(l.quantity.toString()), new Decimal(0));
      t.ordered = t.ordered.plus(ordered);
      const mine = receipts.filter((r) => r.purchaseOrderId === order.id);
      let accepted = new Decimal(0);
      for (const r of mine) {
        for (const l of r.lines) {
          t.received = t.received.plus(l.receivedQuantity.toString());
          t.rejected = t.rejected.plus(l.rejectedQuantity.toString());
          accepted = accepted.plus(l.acceptedQuantity.toString());
        }
      }
      t.accepted = t.accepted.plus(accepted);
      const expected = order.expectedDeliveryDate;
      if (expected && mine.length > 0) {
        t.dated += 1;
        const late = Math.round((mine[0]!.receiptDate.getTime() - expected.getTime()) / DAY);
        if (late <= 0) t.onTime += 1;
        else t.daysLate += late;
      }
      if (expected && expected < asOf && accepted.lessThan(ordered)) t.overdue.push(order.orderNumber);
    }

    const pct = (n: Decimal, d: Decimal) => (d.isZero() ? null : n.div(d).mul(100).toFixed(1));
    return [...bySupplier.values()]
      .map((t) => ({
        supplier: t.supplier,
        orders: t.orders,
        orderedQuantity: t.ordered.toFixed(3),
        acceptedQuantity: t.accepted.toFixed(3),
        fillRatePercent: pct(t.accepted, t.ordered),
        rejectionRatePercent: pct(t.rejected, t.received),
        onTimePercent: t.dated ? ((t.onTime / t.dated) * 100).toFixed(1) : null,
        averageDaysLate: t.dated - t.onTime > 0 ? (t.daysLate / (t.dated - t.onTime)).toFixed(1) : null,
        overdueOrders: t.overdue,
      }))
      .sort((a, b) => Number(a.fillRatePercent ?? 101) - Number(b.fillRatePercent ?? 101));
  }
}
