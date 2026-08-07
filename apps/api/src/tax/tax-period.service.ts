import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  TaxPeriodStatus,
  TaxType,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { TaxEngineService } from './tax-engine.service';
import { TaxRegisterService } from './tax-register.service';

/**
 * The tax filing calendar (§4).
 *
 * Deliberately separate from the financial calendar (§8): a VAT return covers a
 * calendar month with a statutory due date and is filed with an authority,
 * while a financial period is closed for management reporting. The two are
 * often the same month and are never the same event, and conflating them means
 * a management close cannot happen without also claiming the return was filed.
 */
@Injectable()
export class TaxPeriodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: TaxEngineService,
    private readonly registers: TaxRegisterService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Generate a year of filing periods from the company's configured cadence.
   * Nigerian VAT is monthly, due on the 21st of the following month — both are
   * configuration, not constants.
   */
  async generateYear(params: {
    companyId: string;
    taxType: TaxType;
    year: number;
    actorId: string;
  }) {
    const config = await this.engine.configuration(
      params.companyId,
      new Date(Date.UTC(params.year, 0, 1)),
      this.prisma,
    );

    const intervalMonths = config.vatFilingIntervalMonths;
    const periodsInYear = Math.floor(12 / intervalMonths);
    const created: string[] = [];

    for (let index = 0; index < periodsInYear; index += 1) {
      const periodNumber = index + 1;
      const startMonth = index * intervalMonths;
      const start = new Date(Date.UTC(params.year, startMonth, 1));
      const end = new Date(Date.UTC(params.year, startMonth + intervalMonths, 0));

      // Due on the configured day of the month AFTER the period ends.
      const due = new Date(
        Date.UTC(params.year, startMonth + intervalMonths, config.vatFilingDueDayOfMonth),
      );

      const name =
        intervalMonths === 1
          ? `${MONTHS[startMonth]} ${params.year}`
          : `${MONTHS[startMonth]}–${MONTHS[startMonth + intervalMonths - 1]} ${params.year}`;

      const existing = await this.prisma.taxPeriod.findUnique({
        where: {
          companyId_taxType_year_periodNumber: {
            companyId: params.companyId,
            taxType: params.taxType,
            year: params.year,
            periodNumber,
          },
        },
      });
      if (existing) continue;

      const period = await this.prisma.taxPeriod.create({
        data: {
          companyId: params.companyId,
          taxType: params.taxType,
          year: params.year,
          periodNumber,
          name,
          startDate: start,
          endDate: end,
          dueDate: due,
        },
      });
      created.push(period.id);
    }

    return { created: created.length, taxType: params.taxType, year: params.year };
  }

  /**
   * Close a period to further entries.
   *
   * Refuses when the register does not reconcile to the ledger. That is the
   * point of the check: a period closed while the two disagree produces a
   * return that cannot be tied back to the accounts, and the discrepancy is
   * then discovered by the authority rather than by us.
   */
  async close(params: {
    taxPeriodId: string;
    actorId: string;
    ipAddress?: string | null;
    device?: string | null;
  }) {
    const period = await this.prisma.taxPeriod.findUniqueOrThrow({
      where: { id: params.taxPeriodId },
    });

    if (period.status !== TaxPeriodStatus.OPEN) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax periods',
        `Tax period "${period.name}" is already ${period.status}.`,
        { taxPeriodId: period.id, status: period.status },
      );
    }

    const reconciliation = await this.registers.reconcile(
      period.companyId,
      period.id,
    );
    if (!reconciliation.agrees) {
      const failing = reconciliation.lines.filter((l) => !l.agrees);
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax register must agree with the ledger',
        `Tax period "${period.name}" will not close: the register and the general ledger ` +
          `disagree on ${failing.length} control account(s). ` +
          failing
            .map(
              (l) =>
                `${l.glAccountNumber} ${l.glAccountName} (${l.direction}): register ` +
                `${l.registerTaxKobo} kobo vs ledger ${l.ledgerBalanceKobo} kobo`,
            )
            .join('; '),
        { reconciliation },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.taxPeriod.update({
        where: { id: period.id },
        data: { status: TaxPeriodStatus.CLOSED },
      });

      await this.audit.write(
        {
          transactionId: period.id,
          module: 'tax',
          entityType: 'TaxPeriod',
          entityId: period.id,
          status: TaxPeriodStatus.CLOSED,
          action: AuditAction.PERIOD_CLOSE,
          userId: params.actorId,
          ipAddress: params.ipAddress,
          device: params.device,
          comments: `Closed ${period.taxType} period ${period.name}; register agrees with the ledger.`,
          metadata: { reconciliation: reconciliation as unknown as Prisma.InputJsonValue },
        },
        tx,
      );

      return updated;
    });
  }

  /** Mark a closed period as filed with the authority. Terminal. */
  async markFiled(params: {
    taxPeriodId: string;
    filingReference: string;
    actorId: string;
  }) {
    const period = await this.prisma.taxPeriod.findUniqueOrThrow({
      where: { id: params.taxPeriodId },
    });

    if (period.status !== TaxPeriodStatus.CLOSED) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §4 — Tax periods',
        `Tax period "${period.name}" is ${period.status}. Close it — which proves the ` +
          `register agrees with the ledger — before recording it as filed.`,
        { taxPeriodId: period.id, status: period.status },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.taxPeriod.update({
        where: { id: period.id },
        data: {
          status: TaxPeriodStatus.FILED,
          filedAt: new Date(),
          filedById: params.actorId,
          filingReference: params.filingReference,
        },
      });

      await this.audit.write(
        {
          transactionId: period.id,
          module: 'tax',
          entityType: 'TaxPeriod',
          entityId: period.id,
          status: TaxPeriodStatus.FILED,
          action: AuditAction.PERIOD_CLOSE,
          userId: params.actorId,
          comments: `Filed ${period.taxType} return for ${period.name}, reference ${params.filingReference}.`,
          metadata: { filingReference: params.filingReference },
        },
        tx,
      );

      return updated;
    });
  }

  async list(companyId: string, taxType?: TaxType) {
    return this.prisma.taxPeriod.findMany({
      where: { companyId, ...(taxType ? { taxType } : {}) },
      orderBy: [{ taxType: 'asc' }, { year: 'asc' }, { periodNumber: 'asc' }],
    });
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
