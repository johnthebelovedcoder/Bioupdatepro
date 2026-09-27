import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { SalesInvoiceStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { grossMargin } from '../reporting/kpi-formulas';

/**
 * Sales, cost of sales and gross margin by product and by customer
 * (REPORT_KPI_CATALOG AGR-011), from posted sales invoices.
 *
 * Revenue is each invoice line net of VAT and discount, in base currency.
 * Cost is what that line took out of stock: its own cost where cost of sales
 * was recognised at invoice, else the cost its order line's deliveries
 * carried, in proportion to the quantity invoiced. Credit notes are not
 * netted here; they are reported where they are raised.
 */
const POSTED: SalesInvoiceStatus[] = ['POSTED', 'PART_PAID', 'PAID'];

@Injectable()
export class SalesMarginService {
  constructor(private readonly prisma: PrismaService) {}

  async report(params: { companyId: string; from?: Date; to?: Date }) {
    const lines = await this.prisma.salesInvoiceLine.findMany({
      where: {
        invoice: {
          companyId: params.companyId,
          status: { in: POSTED },
          ...(params.from || params.to ? { invoiceDate: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } } : {}),
        },
      },
      select: {
        itemId: true, quantity: true, netAmountKobo: true, costKobo: true, salesOrderLineId: true,
        item: { select: { code: true, description: true } },
        invoice: { select: { exchangeRate: true, customer: { select: { id: true, name: true } } } },
      },
    });

    const orderLineIds = [...new Set(lines.map((l) => l.salesOrderLineId).filter((id): id is string => !!id))];
    const delivered = orderLineIds.length
      ? await this.prisma.deliveryNoteLine.groupBy({
          by: ['salesOrderLineId'],
          where: { salesOrderLineId: { in: orderLineIds }, deliveryNote: { companyId: params.companyId } },
          _sum: { quantity: true, costKobo: true },
        })
      : [];
    const deliveredBy = new Map(delivered.map((d) => [d.salesOrderLineId, d]));

    type Tally = { key: string; label: string; quantity: Decimal; revenue: bigint; cost: bigint };
    const byProduct = new Map<string, Tally>();
    const byCustomer = new Map<string, Tally>();
    const add = (map: Map<string, Tally>, key: string, label: string, quantity: Decimal, revenue: bigint, cost: bigint) => {
      const t = map.get(key) ?? { key, label, quantity: new Decimal(0), revenue: 0n, cost: 0n };
      t.quantity = t.quantity.plus(quantity);
      t.revenue += revenue;
      t.cost += cost;
      map.set(key, t);
    };

    for (const line of lines) {
      const quantity = new Decimal(line.quantity.toString());
      const revenue = BigInt(new Decimal(line.netAmountKobo.toString()).mul(line.invoice.exchangeRate.toString()).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
      let cost = line.costKobo;
      if (cost === 0n && line.salesOrderLineId) {
        const d = deliveredBy.get(line.salesOrderLineId);
        const deliveredQty = new Decimal(d?._sum.quantity?.toString() ?? '0');
        if (d && !deliveredQty.isZero()) {
          cost = BigInt(new Decimal((d._sum.costKobo ?? 0n).toString()).mul(Decimal.min(quantity, deliveredQty)).div(deliveredQty).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0));
        }
      }
      add(byProduct, line.itemId, `${line.item.code} — ${line.item.description}`, quantity, revenue, cost);
      add(byCustomer, line.invoice.customer.id, line.invoice.customer.name, quantity, revenue, cost);
    }

    const rows = (map: Map<string, Tally>) =>
      [...map.values()]
        .map((t) => ({
          key: t.key,
          label: t.label,
          quantity: t.quantity.toFixed(3),
          revenueKobo: t.revenue.toString(),
          costOfSalesKobo: t.cost.toString(),
          grossMarginKobo: (t.revenue - t.cost).toString(),
          grossMarginPercent: grossMargin(t.revenue.toString(), t.cost.toString())?.mul(100).toFixed(1) ?? null,
        }))
        .sort((a, b) => Number(BigInt(b.revenueKobo) - BigInt(a.revenueKobo)));

    const revenue = lines.length ? [...byProduct.values()].reduce((s, t) => s + t.revenue, 0n) : 0n;
    const cost = [...byProduct.values()].reduce((s, t) => s + t.cost, 0n);
    return {
      totals: {
        revenueKobo: revenue.toString(),
        costOfSalesKobo: cost.toString(),
        grossMarginKobo: (revenue - cost).toString(),
        grossMarginPercent: grossMargin(revenue.toString(), cost.toString())?.mul(100).toFixed(1) ?? null,
      },
      byProduct: rows(byProduct),
      byCustomer: rows(byCustomer),
    };
  }
}
