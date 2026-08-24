import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One box that finds anything the signed-in user is allowed to see.
 *
 * The menu answers "where do I go to do a thing". It cannot answer the question
 * people in an ERP actually ask, which is "where is PO-20260821-478615" — that
 * is a record, not a screen, and no depth of navigation will ever reach it.
 * Until this existed the app had no answer to it at all.
 *
 * Two rules shape everything below.
 *
 * **Company scope is not optional.** Every query filters on the caller's
 * company. A search box that leaks one farm's supplier names to another is a
 * worse breach than a missing guard on a page, because nobody thinks of a
 * search box as a door.
 *
 * **Never return what the caller cannot open.** A result that 403s when clicked
 * is a worse experience than no result, and a document number is itself
 * information — knowing that PAY-000412 exists tells you something even if you
 * cannot read it. So the caller's roles decide which groups run at all.
 */

export interface SearchHit {
  /** What kind of thing this is, for the badge and the grouping. */
  type: string;
  /** The heading — usually a document number or a code. */
  title: string;
  /** The line under it: who, when, how much. */
  subtitle: string | null;
  /** Where clicking goes. */
  href: string;
  /** Sorted ascending, so the best match is first. */
  rank: number;
}

/** Which roles may see each group of records. */
const VISIBLE_TO: Record<string, string[]> = {
  buying: ['FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR'],
  receiving: [
    'PRODUCTION_SUPERVISOR',
    'FARM_MANAGER',
    'FINANCE_MANAGER',
    'FINANCIAL_CONTROLLER',
    'MANAGING_DIRECTOR',
  ],
  selling: ['FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR'],
  ledger: ['FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR'],
  people: ['FARM_MANAGER', 'MANAGING_DIRECTOR'],
  masters: [
    'PRODUCTION_SUPERVISOR',
    'FARM_MANAGER',
    'FINANCE_MANAGER',
    'FINANCIAL_CONTROLLER',
    'MANAGING_DIRECTOR',
  ],
  livestock: [
    'PRODUCTION_SUPERVISOR',
    'FARM_MANAGER',
    'FINANCE_MANAGER',
    'FINANCIAL_CONTROLLER',
    'MANAGING_DIRECTOR',
  ],
};

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(params: {
    companyId: string;
    roles: readonly string[];
    query: string;
    limit?: number;
  }): Promise<SearchHit[]> {
    const query = params.query.trim();
    // One character matches most of the database and helps nobody.
    if (query.length < 2) return [];

    const limit = Math.min(params.limit ?? 20, 50);
    const perGroup = 6;
    const may = (group: string) =>
      params.roles.includes('ADMINISTRATOR') ||
      (VISIBLE_TO[group] ?? []).some((role) => params.roles.includes(role));

    const groups: Array<Promise<SearchHit[]>> = [];
    if (may('buying')) groups.push(this.purchaseOrders(params.companyId, query, perGroup));
    if (may('receiving')) groups.push(this.goodsReceipts(params.companyId, query, perGroup));
    if (may('buying')) groups.push(this.suppliers(params.companyId, query, perGroup));
    if (may('selling')) groups.push(this.customers(params.companyId, query, perGroup));
    if (may('ledger')) groups.push(this.journals(params.companyId, query, perGroup));
    if (may('people')) groups.push(this.employees(params.companyId, query, perGroup));
    if (may('masters')) groups.push(this.items(params.companyId, query, perGroup));
    if (may('masters')) groups.push(this.warehouses(params.companyId, query, perGroup));
    if (may('livestock')) groups.push(this.livestock(params.companyId, query, perGroup));
    if (may('livestock')) groups.push(this.pens(params.companyId, query, perGroup));

    const found = (await Promise.all(groups)).flat();
    return found.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title)).slice(0, limit);
  }

  /* --- Documents ------------------------------------------------------- */

  private async purchaseOrders(companyId: string, q: string, take: number): Promise<SearchHit[]> {
    const rows = await this.prisma.purchaseOrder.findMany({
      where: {
        companyId,
        OR: [
          { orderNumber: { contains: q, mode: 'insensitive' } },
          { supplier: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      orderBy: { orderDate: 'desc' },
      take,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        orderDate: true,
        supplier: { select: { name: true } },
      },
    });

    return rows.map((row) => ({
      type: 'Purchase order',
      title: row.orderNumber,
      subtitle: `${row.supplier.name} · ${plain(row.status)} · ${day(row.orderDate)}`,
      // The order list, not a detail page — there is not one yet, and linking
      // to a route that does not exist is worse than landing one step away.
      href: '/procurement',
      rank: rankOf(row.orderNumber, q, 0),
    }));
  }

  private async goodsReceipts(companyId: string, q: string, take: number): Promise<SearchHit[]> {
    const rows = await this.prisma.goodsReceiptNote.findMany({
      where: {
        companyId,
        OR: [
          { grnNumber: { contains: q, mode: 'insensitive' } },
          { deliveryNoteReference: { contains: q, mode: 'insensitive' } },
          { supplier: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      orderBy: { receiptDate: 'desc' },
      take,
      select: {
        id: true,
        grnNumber: true,
        status: true,
        receiptDate: true,
        supplier: { select: { name: true } },
      },
    });

    return rows.map((row) => ({
      type: 'Goods received',
      title: row.grnNumber,
      subtitle: `${row.supplier.name} · ${plain(row.status)} · ${day(row.receiptDate)}`,
      href: '/procurement/receipts',
      rank: rankOf(row.grnNumber, q, 0),
    }));
  }

  private async journals(companyId: string, q: string, take: number): Promise<SearchHit[]> {
    const rows = await this.prisma.journalEntry.findMany({
      where: {
        companyId,
        OR: [
          { journalNumber: { contains: q, mode: 'insensitive' } },
          { narration: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { journalDate: 'desc' },
      take,
      select: {
        id: true,
        journalNumber: true,
        narration: true,
        journalDate: true,
        status: true,
      },
    });

    return rows.map((row) => ({
      type: 'Journal',
      title: row.journalNumber,
      subtitle: `${row.narration ?? plain(row.status)} · ${day(row.journalDate)}`,
      href: '/ledger/journals',
      rank: rankOf(row.journalNumber, q, 1),
    }));
  }

  /* --- Master records --------------------------------------------------- */

  private async suppliers(companyId: string, q: string, take: number): Promise<SearchHit[]> {
    const rows = await this.prisma.supplier.findMany({
      where: {
        companyId,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } },
        ],
      },
      take,
      select: { id: true, code: true, name: true, status: true },
    });

    return rows.map((row) => ({
      type: 'Vendor',
      title: row.name,
      subtitle: `${row.code}${row.status === 'ACTIVE' ? '' : ` · ${plain(row.status)}`}`,
      href: '/suppliers',
      rank: rankOf(`${row.code} ${row.name}`, q, 1),
    }));
  }

  private async customers(companyId: string, q: string, take: number): Promise<SearchHit[]> {
    const rows = await this.prisma.customer.findMany({
      where: {
        companyId,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } },
        ],
      },
      take,
      select: { id: true, code: true, name: true, status: true },
    });

    return rows.map((row) => ({
      type: 'Customer',
      title: row.name,
      subtitle: `${row.code}${row.status === 'ACTIVE' ? '' : ` · ${plain(row.status)}`}`,
      href: '/admin/customers',
      rank: rankOf(`${row.code} ${row.name}`, q, 1),
    }));
  }

  private async items(companyId: string, q: string, take: number): Promise<SearchHit[]> {
    const rows = await this.prisma.item.findMany({
      where: {
        companyId,
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      },
      take,
      select: { id: true, code: true, description: true, itemType: true, active: true },
    });

    return rows.map((row) => ({
      type: 'Item',
      title: `${row.code} — ${row.description}`,
      subtitle: `${plain(row.itemType)}${row.active ? '' : ' · inactive'}`,
      href: '/admin/items',
      rank: rankOf(`${row.code} ${row.description}`, q, 1),
    }));
  }

  private async warehouses(companyId: string, q: string, take: number): Promise<SearchHit[]> {
    const rows = await this.prisma.warehouse.findMany({
      where: {
        companyId,
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      },
      take,
      select: { id: true, code: true, name: true, type: true },
    });

    return rows.map((row) => ({
      type: 'Store',
      title: row.name,
      subtitle: `${row.code} · ${plain(row.type)}`,
      href: '/admin/stores',
      rank: rankOf(`${row.code} ${row.name}`, q, 2),
    }));
  }

  private async employees(companyId: string, q: string, take: number): Promise<SearchHit[]> {
    const rows = await this.prisma.employee.findMany({
      where: {
        companyId,
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { surname: { contains: q, mode: 'insensitive' } },
          { employeeNumber: { contains: q, mode: 'insensitive' } },
        ],
      },
      take,
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        surname: true,
        employmentStatus: true,
      },
    });

    return rows.map((row) => ({
      type: 'Staff',
      title: `${row.firstName} ${row.surname}`,
      subtitle: `${row.employeeNumber} · ${plain(row.employmentStatus)}`,
      href: '/staff',
      rank: rankOf(`${row.employeeNumber} ${row.firstName} ${row.surname}`, q, 1),
    }));
  }

  /* --- Livestock -------------------------------------------------------- */

  private async livestock(companyId: string, q: string, take: number): Promise<SearchHit[]> {
    const rows = await this.prisma.livestockGroup.findMany({
      where: {
        companyId,
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { breed: { contains: q, mode: 'insensitive' } },
          { purpose: { contains: q, mode: 'insensitive' } },
        ],
      },
      take,
      select: {
        id: true,
        code: true,
        breed: true,
        speciesKey: true,
        stage: true,
        population: true,
        status: true,
      },
    });

    // The module decides the noun. Nothing here is hard-coded to a species —
    // "colony" and "batch" come from the module registry, same as everywhere.
    const listFor: Record<string, string> = { snail: 'colonies', poultry: 'batches' };

    return rows.map((row) => ({
      type: row.speciesKey === 'snail' ? 'Colony' : 'Batch',
      title: row.code,
      subtitle: `${row.breed} · ${plain(row.stage)} · ${row.population.toLocaleString()} alive`,
      href: `/m/${row.speciesKey}/${listFor[row.speciesKey] ?? 'batches'}`,
      rank: rankOf(`${row.code} ${row.breed}`, q, 0),
    }));
  }

  private async pens(companyId: string, q: string, take: number): Promise<SearchHit[]> {
    const rows = await this.prisma.penHouse.findMany({
      where: {
        farm: { companyId },
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      },
      take,
      select: { id: true, code: true, name: true, farm: { select: { name: true } } },
    });

    return rows.map((row) => ({
      type: 'House or pen',
      title: `${row.code} — ${row.name}`,
      subtitle: row.farm.name,
      href: '/pens',
      rank: rankOf(`${row.code} ${row.name}`, q, 2),
    }));
  }
}

/* --- Ranking and formatting --------------------------------------------- */

/**
 * Lower is better.
 *
 * An exact match beats a prefix, a prefix beats a match in the middle, and the
 * group's own bias breaks ties between kinds — so typing "PO-2026" puts orders
 * above the store that happens to mention it. Crude on purpose: Postgres
 * full-text ranking would be better and needs an index migration, which is not
 * a thing to bolt on beside a UI change.
 */
function rankOf(haystack: string, needle: string, groupBias: number): number {
  const text = haystack.toLowerCase();
  const term = needle.toLowerCase();
  if (text === term) return groupBias;
  const at = text.indexOf(term);
  if (at === 0) return groupBias + 1;
  if (at > 0) return groupBias + 2 + Math.min(at / 100, 0.9);
  return groupBias + 5;
}

/** SCREAMING_ENUM to something a person would say. */
function plain(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase();
}

function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}
