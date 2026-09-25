import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, PeriodStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { PostingControlService } from '../posting-control/posting-control.service';
import { ProfitLossService } from '../reporting/profit-loss.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { kobo } from '../common/money';

export interface IncomeTaxProvision {
  periodName: string;
  ratePercent: string;
  profitBeforeTaxYtdKobo: string;
  taxDueYtdKobo: string;
  alreadyProvidedKobo: string;
  postedKobo: string;
  journalEntryId: string | null;
}

/**
 * Company income tax (PCR-084: Dr 650100 Income Tax Expense / Cr 227100
 * Income Tax Payable).
 *
 * Provided for as a year-to-date figure: at the end of any month, the tax due
 * on the year's profit before tax so far, at the company's rate, less what has
 * already been provided this year. So it can be run every month or only at
 * year end, re-running changes nothing, and a later loss reverses what was
 * provided. A loss for the year to date carries no tax (and no credit —
 * deferred tax is not modelled). The journal is dated the period's last day.
 */
@Injectable()
export class IncomeTaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly postingControl: PostingControlService,
    private readonly profitLoss: ProfitLossService,
  ) {}

  async setRate(params: { companyId: string; ratePercent: number; actor: WorkflowActor }) {
    const rate = Number(params.ratePercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BadRequestException('The income tax rate is a percentage from 0 to 100.');
    }
    const before = await this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { incomeTaxRatePercent: true } });
    await this.prisma.company.update({ where: { id: params.companyId }, data: { incomeTaxRatePercent: rate } });
    await this.audit.write({
      transactionId: params.companyId,
      module: 'closing',
      entityType: 'Company',
      entityId: params.companyId,
      status: 'ACTIVE',
      action: AuditAction.CONFIG_CHANGE,
      userId: params.actor.userId,
      comments: `Income tax rate set to ${rate}%.`,
      oldValue: { incomeTaxRatePercent: before.incomeTaxRatePercent.toString() },
      newValue: { incomeTaxRatePercent: String(rate) },
    });
    return { ratePercent: String(rate) };
  }

  /** What providing for tax through this period would post — without posting it. */
  async preview(companyId: string, financialPeriodId: string): Promise<IncomeTaxProvision> {
    return this.compute(companyId, financialPeriodId).then(({ result }) => result);
  }

  async provide(params: { companyId: string; financialPeriodId: string; actor: WorkflowActor }): Promise<IncomeTaxProvision> {
    const { result, period, delta } = await this.compute(params.companyId, params.financialPeriodId);
    if (delta === 0n) return result;
    if (period.status !== PeriodStatus.OPEN) {
      throw new BadRequestException(`${period.name} is ${period.status.toLowerCase()}; provide for tax in an open period.`);
    }

    const rule = await this.postingControl.resolve({ companyId: params.companyId, ruleId: 'PCR-084', on: period.endDate });
    const expense = rule.debit?.glAccountId;
    const payable = rule.credit?.glAccountId;
    if (!expense || !payable) {
      throw new BadRequestException('PCR-084 has no accounts. Load the posting rules (Books → Controls) first.');
    }
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: params.companyId },
      select: { baseCurrencyId: true, branches: { where: { active: true }, orderBy: { code: 'asc' }, take: 1, select: { id: true } } },
    });
    const branchId = company.branches[0]?.id;
    if (!branchId) throw new BadRequestException('This company has no active branch.');
    const dimensions = {
      companyId: params.companyId,
      branchId,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      currencyId: company.baseCurrencyId,
      exchangeRate: '1.00000000',
    };
    const amount = kobo(delta > 0n ? delta : -delta);
    const posted = await this.posting.post({
      sourceModule: 'closing',
      sourceDocumentType: 'IncomeTaxProvision',
      sourceDocumentId: period.id,
      journalNumber: `CIT-${period.name.replace(/\s+/g, '-')}-${result.taxDueYtdKobo}`,
      journalDate: period.endDate,
      narration: `Income tax provided to ${period.name}: ${result.ratePercent}% of profit before tax to date`,
      ...dimensions,
      idempotencyKey: `income-tax:${period.id}:${result.taxDueYtdKobo}`,
      actor: params.actor,
      lines: [
        { glAccountId: expense, description: 'PCR-084 — income tax expense', ...(delta > 0n ? { debit: amount } : { credit: amount }), dimensions },
        { glAccountId: payable, description: 'PCR-084 — income tax payable', ...(delta > 0n ? { credit: amount } : { debit: amount }), dimensions },
      ],
    });
    return { ...result, postedKobo: delta.toString(), journalEntryId: posted.journalEntryId };
  }

  private async compute(companyId: string, financialPeriodId: string) {
    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: financialPeriodId, financialYear: { companyId } },
    });
    if (!period) throw new NotFoundException('No such period in this company.');
    const periods = await this.prisma.financialPeriod.findMany({
      where: { financialYearId: period.financialYearId, periodNumber: { lte: period.periodNumber } },
      select: { id: true },
    });
    let pbt = 0n;
    let provided = 0n;
    for (const p of periods) {
      const pl = await this.profitLoss.build({ companyId, financialPeriodId: p.id });
      pbt += BigInt(pl.profitBeforeTaxKobo);
      provided += BigInt(pl.incomeTaxKobo);
    }
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { incomeTaxRatePercent: true } });
    const rate = company.incomeTaxRatePercent;
    // Round half up to the kobo: basis points of the rate × profit.
    const bp = BigInt(rate.mul(100).toFixed(0));
    const due = pbt > 0n ? (pbt * bp + 5_000n) / 10_000n : 0n;
    const delta = due - provided;
    const result: IncomeTaxProvision = {
      periodName: period.name,
      ratePercent: rate.toString(),
      profitBeforeTaxYtdKobo: pbt.toString(),
      taxDueYtdKobo: due.toString(),
      alreadyProvidedKobo: provided.toString(),
      postedKobo: '0',
      journalEntryId: null,
    };
    return { result, period, delta };
  }
}
