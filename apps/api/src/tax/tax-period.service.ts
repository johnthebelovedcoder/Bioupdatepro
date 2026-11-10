import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
import { PostingService } from '../posting/posting.service';
import { resolveApprovedMappedAccount } from '../posting-control/approved-account-map';
import { chartVersionOf } from '../chart/chart';
import { kobo } from '../common/money';
import { WorkflowActor } from '../workflow/workflow.types';
import { WorkflowService } from '../workflow/workflow.service';

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
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
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

  /** Submit a reconciled VAT settlement run for maker-checker approval. */
  async settleVat(params: { companyId: string; taxPeriodId: string; actor: WorkflowActor }) {
    const period = await this.prisma.taxPeriod.findFirstOrThrow({ where: { id: params.taxPeriodId, companyId: params.companyId } });
    if (period.taxType !== TaxType.VAT || period.status === TaxPeriodStatus.OPEN) {
      throw new AccountingRuleViolation('YifrehCore COR-YFR-073A/B — VAT settlement clearing', 'Only a locked VAT filing period can be cleared to the settlement control.', { taxPeriodId: period.id, taxType: period.taxType, status: period.status });
    }
    const existing = await this.prisma.workflowTransaction.findFirst({ where: { companyId: params.companyId, module: 'tax', documentType: 'VatSettlementRun', documentId: period.id }, select: { id: true, status: true, documentReference: true } });
    if (existing && existing.status !== 'RETURNED') return { workflowTransactionId: existing.id, status: existing.status, replayed: true };
    const reconciliation = await this.registers.reconcile(params.companyId, period.id);
    if (!reconciliation.agrees) throw new AccountingRuleViolation('YifrehCore COR-YFR-073A/B — reconciled VAT ledger required', 'The VAT control accounts must reconcile before settlement clearing.', { reconciliation });
    const [register, company, branch] = await Promise.all([
      this.registers.vatRegister(params.companyId, period.id),
      this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { baseCurrencyId: true, baseCurrency: { select: { code: true } } } }),
      this.prisma.branch.findFirst({ where: { companyId: params.companyId, active: true }, orderBy: { code: 'asc' }, select: { id: true } }),
    ]);
    const amount = BigInt(register.summary.outputTaxKobo) + BigInt(register.summary.inputTaxRecoverableKobo);
    if (amount <= 0n) throw new AccountingRuleViolation('YifrehCore COR-YFR-073A/B — no eligible VAT', 'This period has no output VAT or recoverable input VAT to clear.');
    if (!branch || company.baseCurrency.code !== 'NGN') throw new AccountingRuleViolation('YifrehCore COR-YFR-073A/B — approval context', 'An active branch and NGN company are required to submit VAT settlement for approval.', { periodName: period.name });
    const submitted = await this.workflow.submit({
      companyId: params.companyId, transactionType: 'VAT_SETTLEMENT_RUN', module: 'tax',
      documentType: 'VatSettlementRun', documentId: period.id,
      documentReference: `VAT-SETTLE-${period.year}-${String(period.periodNumber).padStart(2, '0')}`,
      amount: kobo(amount), currencyId: company.baseCurrencyId, branchId: branch.id,
      postingPayload: { taxPeriodId: period.id }, actor: params.actor,
    });
    return { workflowTransactionId: submitted.transactionId, status: submitted.status, replayed: false };
  }

  /** Called only by the workflow handler after an independent approver approves the run. */
  async postApprovedVatSettlement(params: { companyId: string; taxPeriodId: string; actor: WorkflowActor; tx: Prisma.TransactionClient }) {
    const period = await params.tx.taxPeriod.findFirstOrThrow({ where: { id: params.taxPeriodId, companyId: params.companyId } });
    if (period.taxType !== TaxType.VAT || period.status === TaxPeriodStatus.OPEN) throw new AccountingRuleViolation('YifrehCore COR-YFR-073A/B — locked VAT period required', 'The VAT filing period must remain locked through approval.', { taxPeriodId: period.id, status: period.status });
    const reconciliation = await this.registers.reconcile(params.companyId, period.id);
    if (!reconciliation.agrees) throw new AccountingRuleViolation('YifrehCore COR-YFR-073A/B — reconciled VAT ledger required', 'The VAT control accounts must still reconcile when the settlement run is approved.', { reconciliation });
    const existing = await params.tx.journalEntry.findFirst({ where: { companyId: params.companyId, sourceModule: 'tax', sourceDocumentType: 'VatSettlementClearing', sourceDocumentId: period.id, status: 'POSTED' }, select: { id: true, journalNumber: true } });
    if (existing) return { journalEntryId: existing.id, journalNumber: existing.journalNumber, replayed: true };
    const on = new Date();
    const [outputGroups, inputGroups, company, branch, financialPeriod] = await Promise.all([
      params.tx.vatRegisterEntry.groupBy({ by: ['taxCodeId'], where: { companyId: params.companyId, taxPeriodId: period.id, direction: 'OUTPUT' }, _sum: { taxKobo: true } }),
      params.tx.vatRegisterEntry.groupBy({ by: ['taxCodeId'], where: { companyId: params.companyId, taxPeriodId: period.id, direction: 'INPUT', recoverable: true }, _sum: { taxKobo: true } }),
      params.tx.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { baseCurrencyId: true, baseCurrency: { select: { code: true } } } }),
      params.tx.branch.findFirst({ where: { companyId: params.companyId, active: true }, orderBy: { code: 'asc' }, select: { id: true } }),
      params.tx.financialPeriod.findFirst({ where: { financialYear: { companyId: params.companyId }, startDate: { lte: on }, endDate: { gte: on }, status: 'OPEN' }, select: { id: true, financialYearId: true } }),
    ]);
    if (!branch || !financialPeriod || company.baseCurrency.code !== 'NGN') throw new AccountingRuleViolation('YifrehCore COR-YFR-073A/B — posting context', 'An open financial period, active branch, and NGN company are required to post VAT settlement clearing.', { periodName: period.name });
    const approved = (await chartVersionOf(params.tx, params.companyId)) === 'APPROVED';
    if (!approved) throw new AccountingRuleViolation('YifrehCore COR-YFR-073A/B — approved posting chart', 'VAT settlement clearing is enabled only on the approved workbook chart.');
    const settlement = await resolveApprovedMappedAccount(params.tx, { companyId: params.companyId, application: 'YifrehCore', masterType: 'Tax settlement', masterId: period.id, postingKey: 'VAT_SETTLEMENT', on });
    const lines: Array<{ glAccountId: string; description: string; debit?: ReturnType<typeof kobo>; credit?: ReturnType<typeof kobo>; dimensions: { companyId: string; branchId: string; financialYearId: string; financialPeriodId: string; currencyId: string; exchangeRate: string } }> = [];
    const dimensions = { companyId: params.companyId, branchId: branch.id, financialYearId: financialPeriod.financialYearId, financialPeriodId: financialPeriod.id, currencyId: company.baseCurrencyId, exchangeRate: '1' };
    const expected: Record<string, string> = {};
    const dynamic: Record<string, string[]> = {};
    const add = (side: 'Debit' | 'Credit', accountId: string, amount: bigint, description: string) => {
      if (amount <= 0n) return;
      const pair = `${side}:${accountId}`;
      expected[pair] = (BigInt(expected[pair] ?? '0') + amount).toString();
      lines.push({ glAccountId: accountId, description, ...(side === 'Debit' ? { debit: kobo(amount) } : { credit: kobo(amount) }), dimensions });
    };
    const ruleIds: string[] = [];
    const setDynamic = (rule: string, key: string, accountId: string) => { dynamic[`${rule}:${key}`] = [...new Set([...(dynamic[`${rule}:${key}`] ?? []), accountId])]; };
    for (const row of outputGroups) {
      const amount = row._sum.taxKobo ?? 0n;
      if (amount <= 0n) continue;
      const accountId = await this.engine.glAccountFor(params.companyId, row.taxCodeId, 'OUTPUT', on, params.tx);
      add('Debit', accountId, amount, `Output VAT cleared — ${period.name}`);
      add('Credit', settlement.glAccountId, amount, `VAT settlement control — ${period.name}`);
      setDynamic('COR-YFR-073A', 'OUTPUT_VAT', accountId);
      setDynamic('COR-YFR-073A', 'VAT_SETTLEMENT', settlement.glAccountId);
      ruleIds.push('COR-YFR-073A');
    }
    for (const row of inputGroups) {
      const amount = row._sum.taxKobo ?? 0n;
      if (amount <= 0n) continue;
      const accountId = await this.engine.glAccountFor(params.companyId, row.taxCodeId, 'INPUT', on, params.tx);
      add('Debit', settlement.glAccountId, amount, `VAT settlement control — ${period.name}`);
      add('Credit', accountId, amount, `Recoverable input VAT cleared — ${period.name}`);
      setDynamic('COR-YFR-073B', 'VAT_SETTLEMENT', settlement.glAccountId);
      setDynamic('COR-YFR-073B', 'INPUT_VAT', accountId);
      ruleIds.push('COR-YFR-073B');
    }
    if (!lines.length) throw new AccountingRuleViolation('YifrehCore COR-YFR-073A/B — no eligible VAT', 'This period has no output VAT or recoverable input VAT to clear.');
    const uniqueRuleIds = [...new Set(ruleIds)];
    const approvedControl = { application: 'YifrehCore', applicationRuleId: uniqueRuleIds[0]!, additionalApplicationRuleIds: uniqueRuleIds.slice(1), dynamicAccountIds: dynamic, expectedAccountSideAmountsKobo: expected };
    const result = await this.posting.post({
        sourceModule: 'tax', sourceDocumentType: 'VatSettlementClearing', sourceDocumentId: period.id,
        journalNumber: `VAT-CLEAR-${period.year}-${String(period.periodNumber).padStart(2, '0')}`,
        journalDate: on, narration: `Clear reconciled input and output VAT for ${period.name}`,
        ...dimensions, idempotencyKey: `vat-settlement-clearing:${params.companyId}:${period.id}`, actor: params.actor, approvedControl, lines,
      }, params.tx);
    await this.audit.write({ transactionId: period.id, module: 'tax', entityType: 'TaxPeriod', entityId: period.id, status: 'SETTLED', action: AuditAction.POST, userId: params.actor.userId, comments: `Cleared output and recoverable input VAT for ${period.name} to its assigned settlement control account after workflow approval.`, metadata: { journalEntryId: result.journalEntryId, outputGroups: outputGroups.length, recoverableInputGroups: inputGroups.length } }, params.tx);
    return { journalEntryId: result.journalEntryId, journalNumber: result.journalNumber, replayed: result.replayed };
  }

  /** Pay a filed VAT return from an assigned registered bank account. */
  async payVat(params: { companyId: string; taxPeriodId: string; bankAccountId: string; authorityReference: string; actor: WorkflowActor }) {
    const period = await this.prisma.taxPeriod.findFirstOrThrow({ where: { id: params.taxPeriodId, companyId: params.companyId } });
    const reference = params.authorityReference.trim();
    if (period.taxType !== TaxType.VAT || period.status !== TaxPeriodStatus.FILED || !/^[a-zA-Z0-9/-]{1,48}$/.test(reference)) throw new AccountingRuleViolation('YifrehCore COR-YFR-075 — VAT payment', 'A filed VAT return and a 1–48 character authority reference using letters, numbers, slash or hyphen are required before payment.', { taxPeriodId: period.id, status: period.status });
    const existing = await this.prisma.journalEntry.findFirst({ where: { companyId: params.companyId, sourceModule: 'tax', sourceDocumentType: 'VatSettlementPayment', sourceDocumentId: `${period.id}:${reference}`, status: 'POSTED' }, select: { id: true, journalNumber: true } });
    if (existing) return { journalEntryId: existing.id, journalNumber: existing.journalNumber, replayed: true };
    const register = await this.registers.vatRegister(params.companyId, period.id);
    const payable = BigInt(register.summary.netPayableKobo);
    if (payable <= 0n) throw new AccountingRuleViolation('YifrehCore COR-YFR-075 — positive payable required', 'This filed VAT return has no net amount payable.', { netPayableKobo: payable.toString() });
    const on = new Date();
    const [bankAccount, company, branch, financialPeriod] = await Promise.all([
      this.prisma.bankAccount.findFirst({ where: { id: params.bankAccountId, companyId: params.companyId, active: true }, select: { id: true, glAccountId: true } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { baseCurrencyId: true, baseCurrency: { select: { code: true } } } }),
      this.prisma.branch.findFirst({ where: { companyId: params.companyId, active: true }, orderBy: { code: 'asc' }, select: { id: true } }),
      this.prisma.financialPeriod.findFirst({ where: { financialYear: { companyId: params.companyId }, startDate: { lte: on }, endDate: { gte: on }, status: 'OPEN' }, select: { id: true, financialYearId: true } }),
    ]);
    if (!bankAccount || !branch || !financialPeriod || company.baseCurrency.code !== 'NGN') throw new AccountingRuleViolation('YifrehCore COR-YFR-075 — payment context', 'An assigned bank account, open financial period, active branch, and NGN company are required.');
    const [settlement, bank] = await Promise.all([
      resolveApprovedMappedAccount(this.prisma, { companyId: params.companyId, application: 'YifrehCore', masterType: 'Tax settlement', masterId: period.id, postingKey: 'VAT_SETTLEMENT', on }),
      resolveApprovedMappedAccount(this.prisma, { companyId: params.companyId, application: 'YifrehCore', masterType: 'Bank', masterId: bankAccount.id, postingKey: 'BANK', on }),
    ]);
    if (bank.glAccountId !== bankAccount.glAccountId) throw new AccountingRuleViolation('YifrehCore COR-YFR-075 — bank map mismatch', 'The bank GL account differs from the workbook map for its assigned bank group.');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockVatSettlement(tx, params.companyId, settlement.glAccountId);
      const [debits, credits] = await Promise.all([
        tx.journalLine.aggregate({ where: { companyId: params.companyId, glAccountId: settlement.glAccountId, journalEntry: { status: 'POSTED', journalDate: { lte: on } } }, _sum: { debitKobo: true } }),
        tx.journalLine.aggregate({ where: { companyId: params.companyId, glAccountId: settlement.glAccountId, journalEntry: { status: 'POSTED', journalDate: { lte: on } } }, _sum: { creditKobo: true } }),
      ]);
      const available = (credits._sum.creditKobo ?? 0n) - (debits._sum.debitKobo ?? 0n);
      if (available < payable) throw new AccountingRuleViolation('YifrehCore COR-YFR-075 — settlement control limit', `The settlement control has only ${available} kobo available against a return payable of ${payable} kobo.`, { availableKobo: available.toString(), payableKobo: payable.toString() });
      const dimensions = { companyId: params.companyId, branchId: branch.id, financialYearId: financialPeriod.financialYearId, financialPeriodId: financialPeriod.id, currencyId: company.baseCurrencyId, exchangeRate: '1' };
      const lines = [
        { glAccountId: settlement.glAccountId, description: `VAT settlement paid — ${period.name}`, debit: kobo(payable), dimensions },
        { glAccountId: bankAccount.glAccountId, description: `VAT payment ${reference}`, credit: kobo(payable), dimensions },
      ];
      const posted = await this.posting.post({
        sourceModule: 'tax', sourceDocumentType: 'VatSettlementPayment', sourceDocumentId: `${period.id}:${reference}`,
        journalNumber: `VAT-PAY-${period.year}-${String(period.periodNumber).padStart(2, '0')}-${createHash('sha256').update(reference).digest('hex').slice(0, 12)}`,
        journalDate: on, narration: `Pay filed VAT liability for ${period.name} — ${reference}`,
        ...dimensions, idempotencyKey: `vat-payment:${params.companyId}:${period.id}:${reference}`, actor: params.actor,
        approvedControl: { application: 'YifrehCore', applicationRuleId: 'COR-YFR-075', dynamicAccountIds: { 'COR-YFR-075:VAT_SETTLEMENT': [settlement.glAccountId], 'COR-YFR-075:BANK': [bankAccount.glAccountId] }, expectedLineAmountsKobo: { 'COR-YFR-075:1': payable.toString(), 'COR-YFR-075:2': payable.toString() } },
        lines,
      }, tx);
      await this.audit.write({ transactionId: period.id, module: 'tax', entityType: 'TaxPeriod', entityId: period.id, status: 'PAID', action: AuditAction.POST, userId: params.actor.userId, comments: `Paid ${payable} kobo VAT for ${period.name}; authority reference ${reference}.`, metadata: { journalEntryId: posted.journalEntryId, authorityReference: reference, bankAccountId: bankAccount.id } }, tx);
      return posted;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { journalEntryId: result.journalEntryId, journalNumber: result.journalNumber, replayed: result.replayed };
  }

  /** Submit a VAT refund claim for independent approval before the bank receipt posts. */
  async requestVatRefund(params: { companyId: string; taxPeriodId: string; bankAccountId: string; authorityAdviceReference: string; amountKobo: bigint; actor: WorkflowActor }) {
    const period = await this.prisma.taxPeriod.findFirstOrThrow({ where: { id: params.taxPeriodId, companyId: params.companyId } });
    const reference = params.authorityAdviceReference.trim();
    if (period.taxType !== TaxType.VAT || period.status !== TaxPeriodStatus.FILED || !/^[a-zA-Z0-9/-]{1,48}$/.test(reference) || params.amountKobo <= 0n) {
      throw new AccountingRuleViolation('YifrehCore COR-YFR-076 — approved VAT refund claim required', 'A filed VAT return, positive amount, and valid tax authority advice reference are required.', { taxPeriodId: period.id, status: period.status });
    }
    const documentId = `${period.id}:${reference}`;
    const existing = await this.prisma.workflowTransaction.findFirst({ where: { companyId: params.companyId, module: 'tax', documentType: 'VatRefundClaim', documentId }, select: { id: true, status: true } });
    if (existing && existing.status !== 'RETURNED') return { workflowTransactionId: existing.id, status: existing.status, replayed: true };
    const register = await this.registers.vatRegister(params.companyId, period.id);
    const recoverable = -BigInt(register.summary.netPayableKobo);
    if (recoverable <= 0n || params.amountKobo > recoverable) throw new AccountingRuleViolation('YifrehCore COR-YFR-076 — net recoverable limit', 'The requested refund cannot exceed this filed return’s net recoverable VAT balance.', { requestedKobo: params.amountKobo.toString(), recoverableKobo: recoverable.toString() });
    const on = new Date();
    const [bankAccount, company, branch, financialPeriod] = await Promise.all([
      this.prisma.bankAccount.findFirst({ where: { id: params.bankAccountId, companyId: params.companyId, active: true }, select: { id: true, glAccountId: true } }),
      this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { baseCurrencyId: true, baseCurrency: { select: { code: true } } } }),
      this.prisma.branch.findFirst({ where: { companyId: params.companyId, active: true }, orderBy: { code: 'asc' }, select: { id: true } }),
      this.prisma.financialPeriod.findFirst({ where: { financialYear: { companyId: params.companyId }, startDate: { lte: on }, endDate: { gte: on }, status: 'OPEN' }, select: { id: true } }),
    ]);
    if (!bankAccount || !branch || !financialPeriod || company.baseCurrency.code !== 'NGN') throw new AccountingRuleViolation('YifrehCore COR-YFR-076 — refund posting context', 'An active registered bank, open financial period, active branch, and NGN company are required.');
    const [settlement, bank] = await Promise.all([
      resolveApprovedMappedAccount(this.prisma, { companyId: params.companyId, application: 'YifrehCore', masterType: 'Tax settlement', masterId: period.id, postingKey: 'VAT_SETTLEMENT', on }),
      resolveApprovedMappedAccount(this.prisma, { companyId: params.companyId, application: 'YifrehCore', masterType: 'Bank', masterId: bankAccount.id, postingKey: 'BANK', on }),
    ]);
    if (bank.glAccountId !== bankAccount.glAccountId) throw new AccountingRuleViolation('YifrehCore COR-YFR-076 — bank map mismatch', 'The selected bank GL account differs from its assigned workbook bank group.');
    const [debits, credits] = await Promise.all([
      this.prisma.journalLine.aggregate({ where: { companyId: params.companyId, glAccountId: settlement.glAccountId, journalEntry: { status: 'POSTED', journalDate: { lte: on } } }, _sum: { debitKobo: true } }),
      this.prisma.journalLine.aggregate({ where: { companyId: params.companyId, glAccountId: settlement.glAccountId, journalEntry: { status: 'POSTED', journalDate: { lte: on } } }, _sum: { creditKobo: true } }),
    ]);
    const debitBalance = (debits._sum.debitKobo ?? 0n) - (credits._sum.creditKobo ?? 0n);
    if (debitBalance < params.amountKobo) throw new AccountingRuleViolation('YifrehCore COR-YFR-076 — settlement debit limit', 'The VAT settlement account does not have enough debit balance to support this refund claim.', { availableKobo: debitBalance.toString(), requestedKobo: params.amountKobo.toString() });
    const submitted = await this.workflow.submit({
      companyId: params.companyId, transactionType: 'VAT_REFUND_CLAIM', module: 'tax',
      documentType: 'VatRefundClaim', documentId,
      documentReference: `VAT-REFUND-${period.year}-${String(period.periodNumber).padStart(2, '0')}-${reference}`,
      amount: kobo(params.amountKobo), currencyId: company.baseCurrencyId, branchId: branch.id,
      postingPayload: { taxPeriodId: period.id, bankAccountId: bankAccount.id, authorityAdviceReference: reference, amountKobo: params.amountKobo.toString() },
      actor: params.actor,
    });
    return { workflowTransactionId: submitted.transactionId, status: submitted.status, replayed: false };
  }

  /** Post a VAT refund only within the independent approval's amount and available debit balance. */
  async postApprovedVatRefund(params: { companyId: string; taxPeriodId: string; bankAccountId: string; authorityAdviceReference: string; amountKobo: bigint; actor: WorkflowActor; tx: Prisma.TransactionClient }) {
    const period = await params.tx.taxPeriod.findFirstOrThrow({ where: { id: params.taxPeriodId, companyId: params.companyId } });
    if (period.taxType !== TaxType.VAT || period.status !== TaxPeriodStatus.FILED) throw new AccountingRuleViolation('YifrehCore COR-YFR-076 — filed return required', 'The VAT return must remain filed through refund approval.', { taxPeriodId: period.id, status: period.status });
    const on = new Date();
    const [register, bankAccount, company, branch, financialPeriod] = await Promise.all([
      this.registers.vatRegister(params.companyId, period.id),
      params.tx.bankAccount.findFirst({ where: { id: params.bankAccountId, companyId: params.companyId, active: true }, select: { id: true, glAccountId: true } }),
      params.tx.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { baseCurrencyId: true, baseCurrency: { select: { code: true } } } }),
      params.tx.branch.findFirst({ where: { companyId: params.companyId, active: true }, orderBy: { code: 'asc' }, select: { id: true } }),
      params.tx.financialPeriod.findFirst({ where: { financialYear: { companyId: params.companyId }, startDate: { lte: on }, endDate: { gte: on }, status: 'OPEN' }, select: { id: true, financialYearId: true } }),
    ]);
    const recoverable = -BigInt(register.summary.netPayableKobo);
    if (recoverable < params.amountKobo) throw new AccountingRuleViolation('YifrehCore COR-YFR-076 — approved refund limit', 'The approved refund exceeds the return’s current net recoverable VAT balance.', { amountKobo: params.amountKobo.toString(), recoverableKobo: recoverable.toString() });
    if (!bankAccount || !branch || !financialPeriod || company.baseCurrency.code !== 'NGN') throw new AccountingRuleViolation('YifrehCore COR-YFR-076 — refund posting context', 'An active registered bank, open financial period, active branch, and NGN company are required.');
    const [settlement, bank] = await Promise.all([
      resolveApprovedMappedAccount(params.tx, { companyId: params.companyId, application: 'YifrehCore', masterType: 'Tax settlement', masterId: period.id, postingKey: 'VAT_SETTLEMENT', on }),
      resolveApprovedMappedAccount(params.tx, { companyId: params.companyId, application: 'YifrehCore', masterType: 'Bank', masterId: bankAccount.id, postingKey: 'BANK', on }),
    ]);
    if (bank.glAccountId !== bankAccount.glAccountId) throw new AccountingRuleViolation('YifrehCore COR-YFR-076 — bank map mismatch', 'The selected bank GL account differs from its assigned workbook bank group.');
    await this.lockVatSettlement(params.tx, params.companyId, settlement.glAccountId);
    const [debits, credits] = await Promise.all([
      params.tx.journalLine.aggregate({ where: { companyId: params.companyId, glAccountId: settlement.glAccountId, journalEntry: { status: 'POSTED', journalDate: { lte: on } } }, _sum: { debitKobo: true } }),
      params.tx.journalLine.aggregate({ where: { companyId: params.companyId, glAccountId: settlement.glAccountId, journalEntry: { status: 'POSTED', journalDate: { lte: on } } }, _sum: { creditKobo: true } }),
    ]);
    const available = (debits._sum.debitKobo ?? 0n) - (credits._sum.creditKobo ?? 0n);
    if (available < params.amountKobo) throw new AccountingRuleViolation('YifrehCore COR-YFR-076 — approved settlement debit limit', 'The approved refund cannot exceed the settlement control debit balance.', { availableKobo: available.toString(), amountKobo: params.amountKobo.toString() });
    const dimensions = { companyId: params.companyId, branchId: branch.id, financialYearId: financialPeriod.financialYearId, financialPeriodId: financialPeriod.id, currencyId: company.baseCurrencyId, exchangeRate: '1' };
    const documentId = `${period.id}:${params.authorityAdviceReference}`;
    const posted = await this.posting.post({
      sourceModule: 'tax', sourceDocumentType: 'VatRefund', sourceDocumentId: documentId,
      journalNumber: `VAT-REF-${period.year}-${String(period.periodNumber).padStart(2, '0')}-${createHash('sha256').update(params.authorityAdviceReference).digest('hex').slice(0, 10)}`,
      journalDate: on, narration: `VAT refund received for ${period.name} — ${params.authorityAdviceReference}`,
      ...dimensions, idempotencyKey: `vat-refund:${params.companyId}:${documentId}`, actor: params.actor,
      approvedControl: { application: 'YifrehCore', applicationRuleId: 'COR-YFR-076', dynamicAccountIds: { 'COR-YFR-076:BANK': [bankAccount.glAccountId], 'COR-YFR-076:VAT_SETTLEMENT': [settlement.glAccountId] }, expectedLineAmountsKobo: { 'COR-YFR-076:1': params.amountKobo.toString(), 'COR-YFR-076:2': params.amountKobo.toString() } },
      lines: [
        { glAccountId: bankAccount.glAccountId, description: `VAT refund received — ${params.authorityAdviceReference}`, debit: kobo(params.amountKobo), dimensions },
        { glAccountId: settlement.glAccountId, description: `VAT settlement refund — ${period.name}`, credit: kobo(params.amountKobo), dimensions },
      ],
    }, params.tx);
    await this.audit.write({ transactionId: period.id, module: 'tax', entityType: 'TaxPeriod', entityId: period.id, status: 'REFUND_RECEIVED', action: AuditAction.POST, userId: params.actor.userId, comments: `Received ${params.amountKobo} kobo VAT refund for ${period.name}; authority advice ${params.authorityAdviceReference}.`, metadata: { journalEntryId: posted.journalEntryId, authorityAdviceReference: params.authorityAdviceReference, bankAccountId: bankAccount.id } }, params.tx);
    return { journalEntryId: posted.journalEntryId };
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

  private async lockVatSettlement(tx: Prisma.TransactionClient, companyId: string, glAccountId: string): Promise<void> {
    const lockKey = `vat-settlement:${companyId}:${glAccountId}`;
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`);
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
