import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface LedgerLine {
  journalDate: Date;
  journalNumber: string;
  narration: string;
  description: string;
  sourceModule: string;
  sourceDocumentType: string;
  debitKobo: string;
  creditKobo: string;
  runningBalanceKobo: string;
}

export interface PartyStatement {
  partyType: 'CUSTOMER' | 'SUPPLIER';
  partyCode: string;
  partyName: string;
  from: string;
  to: string;
  openingBalanceKobo: string;
  lines: LedgerLine[];
  closingBalanceKobo: string;
  totalDebitKobo: string;
  totalCreditKobo: string;
}

export interface AgeingBucket {
  label: string;
  fromDays: number;
  toDays: number | null;
  amountKobo: string;
}

/**
 * §3 "Update Customer Ledger / Update Supplier Ledger", and §6's Customer
 * Statements.
 *
 * These are VIEWS over journal lines, not tables. The alternative — a
 * subsidiary ledger maintained alongside the GL — is a second set of books
 * whose whole maintenance burden is keeping it equal to the first. Derived
 * from the same rows the trial balance reads, a statement cannot disagree with
 * the accounts.
 *
 * This is why Phase 4's business dimensions had to land on JournalLine before
 * this phase could be built.
 */
@Injectable()
export class PartyLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async customerStatement(params: {
    customerId: string;
    from: Date;
    to: Date;
  }): Promise<PartyStatement> {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: params.customerId },
      select: { code: true, name: true },
    });

    return this.buildStatement({
      partyType: 'CUSTOMER',
      partyCode: customer.code,
      partyName: customer.name,
      where: { customerId: params.customerId },
      from: params.from,
      to: params.to,
      // A receivable is an asset: debits increase what the customer owes us.
      sign: 1n,
    });
  }

  async supplierStatement(params: {
    supplierId: string;
    from: Date;
    to: Date;
  }): Promise<PartyStatement> {
    const supplier = await this.prisma.supplier.findUniqueOrThrow({
      where: { id: params.supplierId },
      select: { code: true, name: true },
    });

    return this.buildStatement({
      partyType: 'SUPPLIER',
      partyCode: supplier.code,
      partyName: supplier.name,
      where: { supplierId: params.supplierId },
      from: params.from,
      to: params.to,
      // A payable is a liability: credits increase what we owe the supplier, so
      // the balance is presented on the credit side to read as a positive debt.
      sign: -1n,
    });
  }

  private async buildStatement(params: {
    partyType: 'CUSTOMER' | 'SUPPLIER';
    partyCode: string;
    partyName: string;
    where: { customerId?: string; supplierId?: string };
    from: Date;
    to: Date;
    sign: bigint;
  }): Promise<PartyStatement> {
    const opening = await this.prisma.journalLine.aggregate({
      where: {
        ...params.where,
        journalEntry: { status: 'POSTED', journalDate: { lt: params.from } },
      },
      _sum: { debitKobo: true, creditKobo: true },
    });

    const openingBalance =
      params.sign *
      ((opening._sum.debitKobo ?? 0n) - (opening._sum.creditKobo ?? 0n));

    const lines = await this.prisma.journalLine.findMany({
      where: {
        ...params.where,
        journalEntry: {
          status: 'POSTED',
          journalDate: { gte: params.from, lte: params.to },
        },
      },
      include: {
        journalEntry: {
          select: {
            journalDate: true,
            journalNumber: true,
            narration: true,
            sourceModule: true,
            sourceDocumentType: true,
          },
        },
      },
      orderBy: [{ journalEntry: { journalDate: 'asc' } }, { lineNumber: 'asc' }],
    });

    let running = openingBalance;
    let totalDebit = 0n;
    let totalCredit = 0n;

    const ledgerLines: LedgerLine[] = lines.map((line) => {
      running += params.sign * (line.debitKobo - line.creditKobo);
      totalDebit += line.debitKobo;
      totalCredit += line.creditKobo;

      return {
        journalDate: line.journalEntry.journalDate,
        journalNumber: line.journalEntry.journalNumber,
        narration: line.journalEntry.narration,
        description: line.description,
        sourceModule: line.journalEntry.sourceModule,
        sourceDocumentType: line.journalEntry.sourceDocumentType,
        debitKobo: line.debitKobo.toString(),
        creditKobo: line.creditKobo.toString(),
        runningBalanceKobo: running.toString(),
      };
    });

    return {
      partyType: params.partyType,
      partyCode: params.partyCode,
      partyName: params.partyName,
      from: params.from.toISOString().slice(0, 10),
      to: params.to.toISOString().slice(0, 10),
      openingBalanceKobo: openingBalance.toString(),
      lines: ledgerLines,
      closingBalanceKobo: running.toString(),
      totalDebitKobo: totalDebit.toString(),
      totalCreditKobo: totalCredit.toString(),
    };
  }

  /**
   * §6 Customer Ageing.
   *
   * Ages the NET position by document date. Without an invoice-level allocation
   * model — which arrives with Order-to-Cash in Phase 8 — this ages movement
   * rather than open items, so a receipt reduces the bucket it falls in rather
   * than the bucket of the invoice it settled. That is the honest limit of what
   * the GL alone can say, and it is stated here rather than presented as a
   * full open-item ageing.
   */
  async customerAgeing(params: {
    companyId: string;
    asAt: Date;
    buckets?: number[];
  }): Promise<
    Array<{ customerCode: string; customerName: string; totalKobo: string; buckets: AgeingBucket[] }>
  > {
    const edges = params.buckets ?? [0, 30, 60, 90];

    const customers = await this.prisma.customer.findMany({
      where: { companyId: params.companyId },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });

    const results: Array<{
      customerCode: string;
      customerName: string;
      totalKobo: string;
      buckets: AgeingBucket[];
    }> = [];

    for (const customer of customers) {
      const lines = await this.prisma.journalLine.findMany({
        where: {
          customerId: customer.id,
          journalEntry: { status: 'POSTED', journalDate: { lte: params.asAt } },
        },
        select: {
          debitKobo: true,
          creditKobo: true,
          journalEntry: { select: { journalDate: true } },
        },
      });

      if (lines.length === 0) continue;

      const buckets: AgeingBucket[] = edges.map((edge, index) => ({
        label:
          index === edges.length - 1
            ? `${edge}+ days`
            : `${edge}-${edges[index + 1]! - 1} days`,
        fromDays: edge,
        toDays: index === edges.length - 1 ? null : edges[index + 1]! - 1,
        amountKobo: '0',
      }));

      let total = 0n;

      for (const line of lines) {
        const amount = line.debitKobo - line.creditKobo;
        total += amount;

        const ageDays = Math.floor(
          (params.asAt.getTime() - line.journalEntry.journalDate.getTime()) / 86_400_000,
        );

        let index = 0;
        for (let i = edges.length - 1; i >= 0; i -= 1) {
          if (ageDays >= edges[i]!) {
            index = i;
            break;
          }
        }
        buckets[index]!.amountKobo = (
          BigInt(buckets[index]!.amountKobo) + amount
        ).toString();
      }

      if (total === 0n) continue;

      results.push({
        customerCode: customer.code,
        customerName: customer.name,
        totalKobo: total.toString(),
        buckets,
      });
    }

    return results;
  }

  /** Outstanding balance for one party, used by §6 credit control. */
  async customerOutstanding(customerId: string, asAt?: Date): Promise<bigint> {
    const movement = await this.prisma.journalLine.aggregate({
      where: {
        customerId,
        journalEntry: {
          status: 'POSTED',
          ...(asAt ? { journalDate: { lte: asAt } } : {}),
        },
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    return (movement._sum.debitKobo ?? 0n) - (movement._sum.creditKobo ?? 0n);
  }
}
