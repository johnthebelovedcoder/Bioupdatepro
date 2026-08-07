import { Injectable } from '@nestjs/common';
import {
  Prisma,
  TaxType,
  VatDirection,
  WhtDirection,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingRuleViolation } from '../common/errors';
import { TaxEngineService } from './tax-engine.service';
import {
  TaxReconciliation,
  VatRegisterInput,
  WhtRegisterInput,
} from './tax.types';

/**
 * The VAT and WHT registers (§4).
 *
 * Entries are written by the posting path, inside the SAME database transaction
 * as the journal they describe. That is the control this whole module turns on:
 * a register assembled afterwards by a separate job can drift from the ledger,
 * and the drift is only discovered when a return is already filed. One written
 * alongside the posting cannot drift, and `reconcile()` proves it.
 *
 * Nothing here updates or deletes. The registers are append-only at the
 * database (030_tax_constraints.sql); corrections are adjustment documents.
 */
@Injectable()
export class TaxRegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: TaxEngineService,
  ) {}

  async recordVat(
    input: VatRegisterInput,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    // Zero-tax lines are still recorded. A zero-rated or exempt supply belongs
    // on the VAT return as turnover even though no tax arises; omitting it
    // would understate declared turnover.
    const period = await this.periodFor(
      input.companyId,
      TaxType.VAT,
      input.documentDate,
      tx,
    );

    await tx.vatRegisterEntry.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId,
        taxPeriodId: period.id,
        taxCodeId: input.calculation.taxCodeId,
        direction: input.direction,
        treatment: input.calculation.treatment,
        sourceModule: input.sourceModule,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId ?? null,
        documentReference: input.documentReference,
        documentDate: input.documentDate,
        counterpartyName: input.counterpartyName ?? null,
        counterpartyTin: input.counterpartyTin ?? null,
        taxableBaseKobo: input.calculation.taxableBaseKobo,
        taxKobo: input.calculation.taxKobo,
        appliedRate: new Prisma.Decimal(input.calculation.appliedRate),
        recoverable: input.calculation.recoverable,
        journalEntryId: input.journalEntryId,
      },
    });
  }

  async recordWht(
    input: WhtRegisterInput,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const period = await this.periodFor(
      input.companyId,
      TaxType.WHT,
      input.documentDate,
      tx,
    );

    await tx.whtRegisterEntry.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId,
        taxPeriodId: period.id,
        taxCodeId: input.calculation.taxCodeId,
        direction: input.direction,
        whtCategory: input.calculation.whtCategory,
        sourceModule: input.sourceModule,
        sourceDocumentType: input.sourceDocumentType,
        sourceDocumentId: input.sourceDocumentId ?? null,
        documentReference: input.documentReference,
        documentDate: input.documentDate,
        counterpartyName: input.counterpartyName ?? null,
        counterpartyTin: input.counterpartyTin ?? null,
        grossAmountKobo: input.grossAmountKobo,
        vatAmountKobo: input.vatAmountKobo ?? 0n,
        taxableBaseKobo: input.calculation.taxableBaseKobo,
        taxKobo: input.calculation.taxKobo,
        appliedRate: new Prisma.Decimal(input.calculation.appliedRate),
        creditNoteReference: input.creditNoteReference ?? null,
        creditNoteDate: input.creditNoteDate ?? null,
        journalEntryId: input.journalEntryId,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  async vatRegister(companyId: string, taxPeriodId: string) {
    const entries = await this.prisma.vatRegisterEntry.findMany({
      where: { companyId, taxPeriodId },
      orderBy: [{ documentDate: 'asc' }, { documentReference: 'asc' }],
      include: { taxCode: { select: { code: true, name: true } } },
    });

    const sum = (direction: VatDirection, field: 'taxKobo' | 'taxableBaseKobo') =>
      entries
        .filter((e) => e.direction === direction)
        .reduce((s, e) => s + e[field], 0n);

    const outputTax = sum(VatDirection.OUTPUT, 'taxKobo');
    // Only recoverable input VAT reduces the amount payable; input VAT on
    // exempt supplies is a cost, not a credit.
    const recoverableInputTax = entries
      .filter((e) => e.direction === VatDirection.INPUT && e.recoverable)
      .reduce((s, e) => s + e.taxKobo, 0n);
    const irrecoverableInputTax = entries
      .filter((e) => e.direction === VatDirection.INPUT && !e.recoverable)
      .reduce((s, e) => s + e.taxKobo, 0n);

    return {
      entries,
      summary: {
        outputTaxKobo: outputTax.toString(),
        outputTurnoverKobo: sum(VatDirection.OUTPUT, 'taxableBaseKobo').toString(),
        inputTaxRecoverableKobo: recoverableInputTax.toString(),
        inputTaxIrrecoverableKobo: irrecoverableInputTax.toString(),
        inputPurchasesKobo: sum(VatDirection.INPUT, 'taxableBaseKobo').toString(),
        /// Positive = payable to the authority; negative = a credit carried forward.
        netPayableKobo: (outputTax - recoverableInputTax).toString(),
      },
    };
  }

  async whtRegister(companyId: string, taxPeriodId: string) {
    const entries = await this.prisma.whtRegisterEntry.findMany({
      where: { companyId, taxPeriodId },
      orderBy: [{ documentDate: 'asc' }, { documentReference: 'asc' }],
      include: { taxCode: { select: { code: true, name: true } } },
    });

    const sum = (direction: WhtDirection) =>
      entries.filter((e) => e.direction === direction).reduce((s, e) => s + e.taxKobo, 0n);

    const byCategory = new Map<string, bigint>();
    for (const entry of entries.filter((e) => e.direction === WhtDirection.PAYABLE)) {
      byCategory.set(
        entry.whtCategory,
        (byCategory.get(entry.whtCategory) ?? 0n) + entry.taxKobo,
      );
    }

    return {
      entries,
      summary: {
        payableKobo: sum(WhtDirection.PAYABLE).toString(),
        receivableKobo: sum(WhtDirection.RECEIVABLE).toString(),
        payableByCategory: [...byCategory.entries()].map(([category, amount]) => ({
          category,
          amountKobo: amount.toString(),
        })),
        /// Receivable entries without evidence cannot be claimed, so they are
        /// surfaced rather than quietly included in the claimable total.
        receivableWithoutCreditNote: entries.filter(
          (e) => e.direction === WhtDirection.RECEIVABLE && !e.creditNoteReference,
        ).length,
      },
    };
  }

  /**
   * The accounting identity for this phase.
   *
   * For every tax code and direction in a period, the register total must equal
   * the movement on the mapped GL control account for the same period. If they
   * disagree, either a posting bypassed the register or a register entry was
   * written without a posting — both are defects that must surface before a
   * return is filed, not after.
   */
  async reconcile(companyId: string, taxPeriodId: string): Promise<TaxReconciliation> {
    const period = await this.prisma.taxPeriod.findUniqueOrThrow({
      where: { id: taxPeriodId },
    });

    const lines: TaxReconciliation['lines'] = [];

    const groups =
      period.taxType === TaxType.VAT
        ? await this.prisma.vatRegisterEntry.groupBy({
            by: ['taxCodeId', 'direction'],
            where: { companyId, taxPeriodId },
            _sum: { taxKobo: true },
          })
        : await this.prisma.whtRegisterEntry.groupBy({
            by: ['taxCodeId', 'direction'],
            where: { companyId, taxPeriodId },
            _sum: { taxKobo: true },
          });

    for (const group of groups) {
      const registerTotal = group._sum.taxKobo ?? 0n;
      const glAccountId = await this.engine.glAccountFor(
        companyId,
        group.taxCodeId,
        group.direction,
        period.endDate,
        this.prisma,
      );

      const account = await this.prisma.gLAccount.findUniqueOrThrow({
        where: { id: glAccountId },
        select: { accountNumber: true, name: true, normalBalance: true },
      });

      // The ledger movement for this account across the tax period's dates.
      const movement = await this.prisma.journalLine.aggregate({
        where: {
          glAccountId,
          journalEntry: {
            status: 'POSTED',
            journalDate: { gte: period.startDate, lte: period.endDate },
          },
        },
        _sum: { debitKobo: true, creditKobo: true },
      });

      const debit = movement._sum.debitKobo ?? 0n;
      const credit = movement._sum.creditKobo ?? 0n;
      // Compare on the account's own normal side, so an output-VAT credit
      // balance and an input-VAT debit balance both come out positive.
      const ledgerBalance =
        account.normalBalance === 'CREDIT' ? credit - debit : debit - credit;

      const difference = registerTotal - ledgerBalance;

      lines.push({
        direction: group.direction,
        glAccountNumber: account.accountNumber,
        glAccountName: account.name,
        registerTaxKobo: registerTotal.toString(),
        ledgerBalanceKobo: ledgerBalance.toString(),
        differenceKobo: difference.toString(),
        agrees: difference === 0n,
      });
    }

    return {
      taxPeriodId,
      periodName: period.name,
      lines,
      agrees: lines.every((l) => l.agrees),
    };
  }

  // -------------------------------------------------------------------------

  /**
   * The open tax period covering a document date.
   *
   * Refuses when there is none rather than creating one on the fly: a period
   * conjured by a posting would have no due date anybody chose and no filing
   * owner, and it would hide the fact that the tax calendar was never set up.
   */
  private async periodFor(
    companyId: string,
    taxType: TaxType,
    on: Date,
    tx: Prisma.TransactionClient,
  ) {
    const day = new Date(Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate()));

    const period = await tx.taxPeriod.findFirst({
      where: {
        companyId,
        taxType,
        startDate: { lte: day },
        endDate: { gte: day },
      },
    });

    if (!period) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax periods',
        `No ${taxType} tax period covers ${day.toISOString().slice(0, 10)}. ` +
          `Open the tax calendar for this company before posting taxable documents.`,
        { companyId, taxType, date: day.toISOString().slice(0, 10) },
      );
    }
    return period;
  }
}
