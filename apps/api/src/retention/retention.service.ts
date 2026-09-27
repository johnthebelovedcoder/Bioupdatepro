import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { eligibleBefore, RETENTION_SCHEDULE } from './retention';

interface Counted {
  total: number;
  oldest: Date | null;
  pastMinimum: number;
}

/**
 * The retention report: for each kind of record, how many the company holds,
 * the oldest, and how many have passed the minimum period. It reads; it
 * never deletes.
 */
@Injectable()
export class RetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async report(companyId: string, today = new Date()) {
    const counts = await this.count(companyId, today);
    const years = await this.prisma.financialYear.findMany({
      where: { companyId },
      orderBy: { startDate: 'asc' },
      select: { code: true, status: true, startDate: true, endDate: true },
    });
    return {
      asOf: today.toISOString().slice(0, 10),
      deletes: false,
      rules: RETENTION_SCHEDULE.map((rule) => {
        const c = counts[rule.key] ?? { total: 0, oldest: null, pastMinimum: 0 };
        return {
          ...rule,
          keptUntilBefore: eligibleBefore(rule.years, today).toISOString().slice(0, 10),
          total: c.total,
          oldest: c.oldest?.toISOString().slice(0, 10) ?? null,
          pastMinimum: c.pastMinimum,
        };
      }),
      // Closed years are archived by the year-end close; nothing in them is removed.
      years: years.map((y) => ({ code: y.code, status: y.status, startDate: y.startDate.toISOString().slice(0, 10), endDate: y.endDate.toISOString().slice(0, 10) })),
    };
  }

  private async count(companyId: string, today: Date): Promise<Record<string, Counted>> {
    const cut = (key: string) => eligibleBefore(RETENTION_SCHEDULE.find((r) => r.key === key)!.years, today);
    const p = this.prisma;
    const tally = async (
      total: Promise<number>,
      oldest: Promise<Date | null | undefined>,
      pastMinimum: Promise<number>,
    ): Promise<Counted> => {
      const [t, o, pm] = await Promise.all([total, oldest, pastMinimum]);
      return { total: t, oldest: o ?? null, pastMinimum: pm };
    };

    const [journals, supplierInvoices, salesInvoices, customerReceipts, supplierPayments, paymentFiles, stockMovements, livestock, payrollRuns, formerEmployees, approvals, closeLog, closePacks, audit] =
      await Promise.all([
        tally(
          p.journalEntry.count({ where: { companyId } }),
          p.journalEntry.findFirst({ where: { companyId }, orderBy: { journalDate: 'asc' }, select: { journalDate: true } }).then((r) => r?.journalDate),
          p.journalEntry.count({ where: { companyId, journalDate: { lt: cut('journals') } } }),
        ),
        tally(
          p.supplierInvoice.count({ where: { companyId } }),
          p.supplierInvoice.findFirst({ where: { companyId }, orderBy: { invoiceDate: 'asc' }, select: { invoiceDate: true } }).then((r) => r?.invoiceDate),
          p.supplierInvoice.count({ where: { companyId, invoiceDate: { lt: cut('supplierInvoices') } } }),
        ),
        tally(
          p.salesInvoice.count({ where: { companyId } }),
          p.salesInvoice.findFirst({ where: { companyId }, orderBy: { invoiceDate: 'asc' }, select: { invoiceDate: true } }).then((r) => r?.invoiceDate),
          p.salesInvoice.count({ where: { companyId, invoiceDate: { lt: cut('salesInvoices') } } }),
        ),
        tally(
          p.customerReceipt.count({ where: { companyId } }),
          p.customerReceipt.findFirst({ where: { companyId }, orderBy: { receiptDate: 'asc' }, select: { receiptDate: true } }).then((r) => r?.receiptDate),
          p.customerReceipt.count({ where: { companyId, receiptDate: { lt: cut('customerReceipts') } } }),
        ),
        tally(
          p.supplierPayment.count({ where: { companyId } }),
          p.supplierPayment.findFirst({ where: { companyId }, orderBy: { paymentDate: 'asc' }, select: { paymentDate: true } }).then((r) => r?.paymentDate),
          p.supplierPayment.count({ where: { companyId, paymentDate: { lt: cut('supplierPayments') } } }),
        ),
        tally(
          p.paymentFile.count({ where: { companyId } }),
          p.paymentFile.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).then((r) => r?.createdAt),
          p.paymentFile.count({ where: { companyId, createdAt: { lt: cut('paymentFiles') } } }),
        ),
        tally(
          p.stockMovement.count({ where: { companyId } }),
          p.stockMovement.findFirst({ where: { companyId }, orderBy: { movementDate: 'asc' }, select: { movementDate: true } }).then((r) => r?.movementDate),
          p.stockMovement.count({ where: { companyId, movementDate: { lt: cut('stockMovements') } } }),
        ),
        tally(
          p.livestockGroup.count({ where: { companyId } }),
          p.livestockGroup.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).then((r) => r?.createdAt),
          p.livestockGroup.count({ where: { companyId, createdAt: { lt: cut('livestock') } } }),
        ),
        tally(
          p.payrollRun.count({ where: { companyId } }),
          p.payrollRun.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).then((r) => r?.createdAt),
          p.payrollRun.count({ where: { companyId, createdAt: { lt: cut('payrollRuns') } } }),
        ),
        tally(
          p.employee.count({ where: { companyId, exitDate: { not: null } } }),
          p.employee.findFirst({ where: { companyId, exitDate: { not: null } }, orderBy: { exitDate: 'asc' }, select: { exitDate: true } }).then((r) => r?.exitDate),
          p.employee.count({ where: { companyId, exitDate: { lt: cut('formerEmployees') } } }),
        ),
        tally(
          p.workflowTransaction.count({ where: { companyId } }),
          p.workflowTransaction.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).then((r) => r?.createdAt),
          p.workflowTransaction.count({ where: { companyId, createdAt: { lt: cut('approvals') } } }),
        ),
        tally(
          p.periodCloseLog.count({ where: { companyId } }),
          p.periodCloseLog.findFirst({ where: { companyId }, orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }).then((r) => r?.occurredAt),
          p.periodCloseLog.count({ where: { companyId, occurredAt: { lt: cut('closeLog') } } }),
        ),
        tally(
          p.closePack.count({ where: { companyId } }),
          p.closePack.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }).then((r) => r?.createdAt),
          p.closePack.count({ where: { companyId, createdAt: { lt: cut('closePacks') } } }),
        ),
        tally(
          p.auditRecord.count({ where: { companyId } }),
          p.auditRecord.findFirst({ where: { companyId }, orderBy: { occurredAt: 'asc' }, select: { occurredAt: true } }).then((r) => r?.occurredAt),
          p.auditRecord.count({ where: { companyId, occurredAt: { lt: cut('audit') } } }),
        ),
      ]);
    return { journals, supplierInvoices, salesInvoices, customerReceipts, supplierPayments, paymentFiles, stockMovements, livestock, payrollRuns, formerEmployees, approvals, closeLog, closePacks, audit };
  }
}
