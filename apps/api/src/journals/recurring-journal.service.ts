import { Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  ManualJournalStatus,
  Prisma,
  RecurrenceFrequency,
  RecurringJournalBasis,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';

export interface GenerationOutcome {
  generated: Array<{ recurringCode: string; reference: string; journalDate: string }>;
  skipped: Array<{ recurringCode: string; reason: string }>;
}

/**
 * §3 "Recurring Journals".
 *
 * Generates DRAFT documents that then travel the normal approval pipeline.
 * Deliberately not auto-posting: a recurring accrual is still an accounting
 * judgement each period, and a template that posts itself removes the last
 * human look at a figure nobody is otherwise reviewing.
 *
 * `generateDue(now)` takes an explicit clock so the schedule can be tested
 * without waiting a month.
 */
@Injectable()
export class RecurringJournalService {
  private readonly logger = new Logger(RecurringJournalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async generateDue(params: {
    companyId: string;
    now: Date;
    actorId: string;
  }): Promise<GenerationOutcome> {
    const due = await this.prisma.recurringJournal.findMany({
      where: {
        companyId: params.companyId,
        active: true,
        nextRunDate: { lte: startOfDay(params.now) },
      },
      include: {
        lines: { orderBy: { lineNumber: 'asc' } },
        journalType: true,
      },
    });

    const outcome: GenerationOutcome = { generated: [], skipped: [] };

    for (const template of due) {
      if (template.endDate && template.nextRunDate > template.endDate) {
        await this.prisma.recurringJournal.update({
          where: { id: template.id },
          data: { active: false },
        });
        outcome.skipped.push({
          recurringCode: template.code,
          reason: 'Schedule has passed its end date; template deactivated.',
        });
        continue;
      }

      if (template.lines.length === 0) {
        outcome.skipped.push({
          recurringCode: template.code,
          reason: 'Template has no lines.',
        });
        continue;
      }

      const totalDebit = template.lines.reduce((s, l) => s + l.debitKobo, 0n);
      const totalCredit = template.lines.reduce((s, l) => s + l.creditKobo, 0n);
      if (totalDebit !== totalCredit) {
        // Refuse rather than generate an unpostable document that someone has
        // to work out the cause of later.
        outcome.skipped.push({
          recurringCode: template.code,
          reason:
            `Template does not balance: debits ${totalDebit} kobo vs credits ` +
            `${totalCredit} kobo. Correct the template.`,
        });
        continue;
      }

      const journalDate = template.nextRunDate;
      const period = await this.prisma.financialPeriod.findFirst({
        where: {
          financialYear: { companyId: params.companyId },
          startDate: { lte: journalDate },
          endDate: { gte: journalDate },
        },
      });

      if (!period) {
        outcome.skipped.push({
          recurringCode: template.code,
          reason:
            `No financial period covers ${journalDate.toISOString().slice(0, 10)}. ` +
            `Open the calendar for that year first.`,
        });
        continue;
      }

      const reference = `${template.code}-${journalDate.toISOString().slice(0, 7)}`;

      const existing = await this.prisma.manualJournal.findUnique({
        where: { companyId_reference: { companyId: params.companyId, reference } },
      });
      if (existing) {
        // Already generated for this period. Advance the schedule rather than
        // failing, so a re-run of the sweep is harmless (Rule 6 in spirit).
        await this.advance(template.id, template.frequency, journalDate, template.dayOfMonth);
        outcome.skipped.push({
          recurringCode: template.code,
          reason: `${reference} already exists.`,
        });
        continue;
      }

      await this.prisma.$transaction(async (tx) => {
        const journal = await tx.manualJournal.create({
          data: {
            companyId: params.companyId,
            journalTypeId: template.journalTypeId,
            reference,
            journalDate,
            narration: template.narration,
            branchId: template.branchId,
            financialYearId: period.financialYearId,
            financialPeriodId: period.id,
            currencyId: template.currencyId,
            exchangeRate: new Prisma.Decimal('1.00000000'),
            customerId: template.customerId,
            supplierId: template.supplierId,
            status: ManualJournalStatus.DRAFT,
            recurringJournalId: template.id,
            createdById: params.actorId,
            lines: {
              create: template.lines.map((line) => ({
                lineNumber: line.lineNumber,
                glAccountId: line.glAccountId,
                description: line.description,
                debitKobo: line.debitKobo,
                creditKobo: line.creditKobo,
                departmentId: line.departmentId,
                costCentreId: line.costCentreId,
                farmId: line.farmId,
                projectId: line.projectId,
                customerId: line.customerId ?? template.customerId,
                supplierId: line.supplierId ?? template.supplierId,
                employeeId: line.employeeId,
                itemId: line.itemId,
              })),
            },
          },
        });

        await this.audit.write(
          {
            transactionId: journal.id,
            module: 'journals',
            entityType: 'ManualJournal',
            entityId: journal.id,
            status: ManualJournalStatus.DRAFT,
            action: AuditAction.CREATE,
            userId: params.actorId,
            comments: `[recurring] Generated from template ${template.code}.`,
            metadata: { recurringCode: template.code, reference },
          },
          tx,
        );
      });

      await this.advance(template.id, template.frequency, journalDate, template.dayOfMonth);

      outcome.generated.push({
        recurringCode: template.code,
        reference,
        journalDate: journalDate.toISOString().slice(0, 10),
      });
    }

    if (outcome.generated.length > 0) {
      this.logger.log(
        `Generated ${outcome.generated.length} recurring journal draft(s) for approval.`,
      );
    }
    return outcome;
  }

  /**
   * Move the schedule on by one interval.
   *
   * The day of month is clamped, not carried: a template set to the 31st runs
   * on the 30th in April and the 28th in February rather than skipping the
   * month or spilling into the next one.
   */
  private async advance(
    templateId: string,
    frequency: RecurrenceFrequency,
    from: Date,
    dayOfMonth: number,
  ): Promise<void> {
    const monthsToAdd: Record<RecurrenceFrequency, number> = {
      MONTHLY: 1,
      QUARTERLY: 3,
      HALF_YEARLY: 6,
      ANNUALLY: 12,
    };

    const year = from.getUTCFullYear();
    const month = from.getUTCMonth() + monthsToAdd[frequency];
    const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = Math.min(dayOfMonth, lastDayOfTarget);

    await this.prisma.recurringJournal.update({
      where: { id: templateId },
      data: { nextRunDate: new Date(Date.UTC(year, month, day)) },
    });
  }

  /** Every template this company has, newest first — what the web app's own list needs. */
  async listTemplates(companyId: string) {
    const templates = await this.prisma.recurringJournal.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        journalType: { select: { code: true, name: true } },
        lines: { select: { debitKobo: true, creditKobo: true } },
      },
    });

    return templates.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      journalType: t.journalType.name,
      basis: t.basis,
      frequency: t.frequency,
      dayOfMonth: t.dayOfMonth,
      startDate: t.startDate,
      endDate: t.endDate,
      nextRunDate: t.nextRunDate,
      active: t.active,
      amountKobo: t.lines.reduce((s, l) => s + l.debitKobo, 0n).toString(),
    }));
  }

  async create(input: {
    companyId: string;
    journalTypeCode: string;
    code: string;
    name: string;
    narration: string;
    branchId: string;
    currencyId: string;
    frequency: RecurrenceFrequency;
    dayOfMonth: number;
    basis?: RecurringJournalBasis;
    startDate: Date;
    endDate?: Date | null;
    customerId?: string | null;
    supplierId?: string | null;
    lines: Array<{
      glAccountId: string;
      description: string;
      debitKobo?: bigint;
      creditKobo?: bigint;
      costCentreId?: string | null;
      customerId?: string | null;
      supplierId?: string | null;
    }>;
    actorId: string;
  }) {
    const journalType = await this.prisma.journalType.findUnique({
      where: {
        companyId_code: { companyId: input.companyId, code: input.journalTypeCode },
      },
    });
    if (!journalType) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §3 — Journal types',
        `Journal type "${input.journalTypeCode}" is not configured.`,
        { journalTypeCode: input.journalTypeCode },
      );
    }

    return this.prisma.recurringJournal.create({
      data: {
        companyId: input.companyId,
        journalTypeId: journalType.id,
        code: input.code,
        name: input.name,
        narration: input.narration,
        branchId: input.branchId,
        currencyId: input.currencyId,
        frequency: input.frequency,
        dayOfMonth: input.dayOfMonth,
        ...(input.basis ? { basis: input.basis } : {}),
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        nextRunDate: input.startDate,
        customerId: input.customerId ?? null,
        supplierId: input.supplierId ?? null,
        createdById: input.actorId,
        lines: {
          create: input.lines.map((line, index) => ({
            lineNumber: index + 1,
            glAccountId: line.glAccountId,
            description: line.description,
            debitKobo: line.debitKobo ?? 0n,
            creditKobo: line.creditKobo ?? 0n,
            costCentreId: line.costCentreId ?? null,
            customerId: line.customerId ?? null,
            supplierId: line.supplierId ?? null,
          })),
        },
      },
      include: { lines: true },
    });
  }
}

function startOfDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}
