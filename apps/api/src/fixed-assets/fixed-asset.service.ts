import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AuditAction, Prisma, ProductionOrderCycle, WorkflowStatus } from '@bioassetpro/database';
import { chartVersionOf, numberFor, processingOverheadNumber } from '../chart/chart';
import { resolveApprovedMappedAccount } from '../posting-control/approved-account-map';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';
import { assertBankGlAccount } from '../chart/bank-account';

/**
 * Fixed assets (US-897-025), mirroring the payroll module's shape exactly:
 * record → submit via the shared workflow engine → post on approval via the
 * shared posting engine. Two document types share this file because they
 * share the same asset register — capitalising an asset (PCR-029: Dr PPE /
 * Cr Payables) and depreciating it (PCR-030: Dr Depreciation Expense /
 * Cr Accumulated Depreciation), the latter a batch run over every in-service
 * asset for one period, the same "one run, many lines" shape PayrollRun
 * already uses for one run over many employees.
 */
@Injectable()
export class FixedAssetService {
  private readonly logger = new Logger(FixedAssetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly workflow: WorkflowService,
  ) {}

  /** The register, newest first, with what can be done to each. */
  async listAssets(companyId: string) {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { costCentre: { select: { code: true, name: true } } },
    });

    const transactions = await this.prisma.workflowTransaction.findMany({
      where: {
        companyId,
        documentId: { in: assets.map((asset) => asset.id) },
        status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
      },
      select: { id: true, documentId: true },
    });
    const pending = new Map(transactions.map((t) => [t.documentId, t.id]));

    return assets.map((asset) => ({
      id: asset.id,
      assetNumber: asset.assetNumber,
      name: asset.name,
      assetClass: asset.assetClass,
      acquisitionDate: asset.acquisitionDate,
      costKobo: asset.costKobo.toString(),
      impairedKobo: asset.impairedKobo.toString(),
      usefulLifeMonths: asset.usefulLifeMonths,
      costCentre: asset.costCentre ? `${asset.costCentre.code} — ${asset.costCentre.name}` : null,
      processingCycle: asset.processingCycle,
      accumulatedDepreciationKobo: asset.accumulatedDepreciationKobo.toString(),
      netBookValueKobo: (asset.costKobo - asset.accumulatedDepreciationKobo).toString(),
      status: asset.status,
      disposedOn: asset.disposedOn,
      fullyDepreciated: asset.accumulatedDepreciationKobo >= asset.costKobo,
      pendingTransactionId: pending.get(asset.id) ?? null,
    }));
  }

  async disposalOptions(companyId: string) {
    const [bankAccounts, customers] = await Promise.all([
      this.prisma.bankAccount.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, bankName: true, accountNumber: true } }),
      this.prisma.customer.findMany({ where: { companyId, status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
    ]);
    return {
      bankAccounts: bankAccounts.map((account) => ({ id: account.id, name: account.name, bankName: account.bankName, accountNumber: `••••${account.accountNumber.slice(-4)}` })),
      customers,
    };
  }

  /**
   * Capitalise an asset and send it for approval.
   *
   * Credits Trade Payables (2201) on posting — PCR-029's basis is "AP or
   * GRNI"; Payables is the common case for an asset bought on account, and
   * the only one this records without inventing a bank-account picker this
   * story doesn't ask for.
   */
  async capitalise(params: {
    companyId: string;
    actor: WorkflowActor;
    name: string;
    assetClass: string;
    acquisitionDate: Date;
    costKobo: bigint;
    usefulLifeMonths: number;
    costCentreId?: string | null;
  }) {
    if (params.costKobo <= 0n) {
      throw new AccountingRuleViolation(
        'Posting-control PCR-029 — Fixed asset capitalisation',
        'An asset must be capitalised at a positive cost.',
        {},
      );
    }
    if (params.usefulLifeMonths <= 0) {
      throw new AccountingRuleViolation(
        'Posting-control PCR-030 — Depreciation',
        'A useful life is required before an asset can be depreciated, so it is required at capitalisation.',
        {},
      );
    }

    const context = await this.prisma.company.findUniqueOrThrow({
      where: { id: params.companyId },
      select: { baseCurrencyId: true, branches: { where: { active: true }, take: 1, select: { id: true } } },
    });
    const branch = context.branches[0];
    if (!branch) throw new AccountingRuleViolation('§1 — Company setup', 'This company has no active branch.', {});

    const assetNumber = await this.nextAssetNumber(params.companyId);

    const asset = await this.prisma.fixedAsset.create({
      data: {
        companyId: params.companyId,
        assetNumber,
        name: params.name,
        assetClass: params.assetClass,
        acquisitionDate: params.acquisitionDate,
        costKobo: params.costKobo,
        usefulLifeMonths: params.usefulLifeMonths,
        costCentreId: params.costCentreId ?? null,
        createdById: params.actor.userId,
      },
    });

    await this.audit.write({
      transactionId: asset.id,
      module: 'fixed-assets',
      entityType: 'FixedAsset',
      entityId: asset.id,
      status: asset.status,
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      comments: `Raised capitalisation ${asset.assetNumber} — ${asset.name}.`,
    });

    const result = await this.workflow.submit({
      companyId: params.companyId,
      transactionType: 'FIXED_ASSET_CAPITALISATION',
      module: 'fixed-assets',
      documentType: 'FixedAsset',
      documentId: asset.id,
      documentReference: asset.assetNumber,
      amount: kobo(params.costKobo),
      currencyId: context.baseCurrencyId,
      branchId: branch.id,
      costCentreId: params.costCentreId ?? undefined,
      actor: params.actor,
    });

    await this.prisma.fixedAsset.update({
      where: { id: asset.id },
      data: { status: WorkflowStatus.SUBMITTED, workflowTransactionId: result.transactionId },
    });

    return {
      assetId: asset.id,
      assetNumber: asset.assetNumber,
      awaitingApproval: result.transactionId,
    };
  }

  async postApprovedCapitalisation(params: {
    assetId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const asset = await params.tx.fixedAsset.findUniqueOrThrow({ where: { id: params.assetId } });

    if (asset.status === WorkflowStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${asset.assetNumber} is already posted.`,
        { assetNumber: asset.assetNumber },
      );
    }

    // Independent reads, run together — each one taken alone is fast, but
    // this transaction shares a hard 5s budget with everything else the
    // engine does before it, and three round trips in series is the
    // difference between comfortably inside that budget and not.
    const [accounts, context, period] = await Promise.all([
      this.resolveAccounts(asset.companyId, params.tx, ['ppe', 'payables'], asset.acquisitionDate),
      params.tx.company.findUniqueOrThrow({
        where: { id: asset.companyId },
        select: {
          baseCurrencyId: true,
          branches: { where: { active: true }, take: 1, select: { id: true } },
        },
      }),
      this.currentPeriod(asset.companyId, asset.acquisitionDate, params.tx),
    ]);
    const branch = context.branches[0]!;

    const dimensions = {
      companyId: asset.companyId,
      branchId: branch.id,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      currencyId: context.baseCurrencyId,
      exchangeRate: '1.00000000',
      costCentreId: asset.costCentreId,
    };

    const result = await this.posting.post(
      {
        sourceModule: 'fixed-assets',
        sourceDocumentType: 'FixedAsset',
        sourceDocumentId: asset.id,
        journalNumber: asset.assetNumber,
        journalDate: asset.acquisitionDate,
        narration: `Capitalise ${asset.assetNumber} — ${asset.name}`,
        ...dimensions,
        idempotencyKey: `fixed-asset-capitalisation:${asset.id}`,
        ...(await chartVersionOf(params.tx, asset.companyId)) === 'APPROVED' ? { approvedControl: {
          application: 'YifrehCore',
          applicationRuleId: 'COR-YFR-016A',
          expectedLineAmountsKobo: { 'COR-YFR-016A:1': asset.costKobo.toString(), 'COR-YFR-016A:2': asset.costKobo.toString() },
        } } : {},
        actor: params.actor,
        lines: [
          {
            glAccountId: accounts.ppe,
            description: `${asset.assetNumber} — ${asset.name}`,
            debit: kobo(asset.costKobo),
            dimensions,
          },
          {
            glAccountId: accounts.payables,
            description: `${asset.assetNumber} — ${asset.name}`,
            credit: kobo(asset.costKobo),
            dimensions,
          },
        ],
      },
      params.tx,
    );

    await params.tx.fixedAsset.update({
      where: { id: asset.id },
      data: { status: WorkflowStatus.POSTED, journalEntryId: result.journalEntryId },
    });

    this.logger.log(`Posted fixed-asset capitalisation ${asset.assetNumber}`);
    return { journalEntryId: result.journalEntryId };
  }

  /**
   * One depreciation charge per in-service asset, for one period, as one run.
   *
   * Straight-line only, to start: PCR-030's basis is "approved method/useful
   * life" without mandating others, and nothing here needs a second method
   * until a client asks for one. The charge is capped at what remains of
   * cost — a fully depreciated asset is skipped, not driven negative.
   */
  async runDepreciation(params: {
    companyId: string;
    actor: WorkflowActor;
    financialPeriodId: string;
  }) {
    const existing = await this.prisma.depreciationRun.findUnique({
      where: {
        companyId_financialPeriodId: {
          companyId: params.companyId,
          financialPeriodId: params.financialPeriodId,
        },
      },
    });
    if (existing) {
      throw new AccountingRuleViolation(
        'Posting-control PCR-030 — Depreciation',
        'A depreciation run already exists for this period. Correct it with a reversal, not a second run.',
        { financialPeriodId: params.financialPeriodId },
      );
    }

    const period = await this.prisma.financialPeriod.findFirstOrThrow({
      where: { id: params.financialPeriodId, financialYear: { companyId: params.companyId } },
      select: { financialYearId: true, startDate: true, endDate: true },
    });

    // UAT-007: an asset is depreciated only once it is in service — acquired
    // by the end of the period — never for a month before it existed.
    const assets = await this.prisma.fixedAsset.findMany({
      where: { companyId: params.companyId, status: WorkflowStatus.POSTED, disposedOn: null, acquisitionDate: { lte: period.endDate } },
    });

    // After an impairment (IAS 36) the carrying amount left is spread over
    // the months of life that remain, not the original cost over the whole.
    const impaired = assets.filter((asset) => asset.impairedKobo > 0n);
    const monthsDone = impaired.length
      ? await this.prisma.depreciationEntry.groupBy({
          by: ['assetId'],
          where: { assetId: { in: impaired.map((a) => a.id) }, run: { companyId: params.companyId } },
          _count: { _all: true },
        })
      : [];

    const lines = assets
      .map((asset) => {
        const done = monthsDone.find((m) => m.assetId === asset.id)?._count._all ?? 0;
        const monthly =
          asset.impairedKobo > 0n
            ? (asset.costKobo - asset.accumulatedDepreciationKobo) / BigInt(Math.max(1, asset.usefulLifeMonths - done))
            : asset.costKobo / BigInt(asset.usefulLifeMonths);
        const remaining = asset.costKobo - asset.accumulatedDepreciationKobo;
        const amount = monthly < remaining ? monthly : remaining;
        return { assetId: asset.id, amountKobo: amount };
      })
      .filter((line) => line.amountKobo > 0n);

    if (lines.length === 0) {
      throw new AccountingRuleViolation(
        'Posting-control PCR-030 — Depreciation',
        'No in-service asset has anything left to depreciate this period.',
        {},
      );
    }

    const totalAmountKobo = lines.reduce((sum, line) => sum + line.amountKobo, 0n);

    const run = await this.prisma.depreciationRun.create({
      data: {
        companyId: params.companyId,
        financialPeriodId: params.financialPeriodId,
        totalAmountKobo,
        createdById: params.actor.userId,
        entries: { create: lines.map((line) => ({ assetId: line.assetId, amountKobo: line.amountKobo })) },
      },
    });

    const context = await this.prisma.company.findUniqueOrThrow({
      where: { id: params.companyId },
      select: {
        baseCurrencyId: true,
        branches: { where: { active: true }, take: 1, select: { id: true } },
      },
    });
    const branch = context.branches[0]!;

    const result = await this.workflow.submit({
      companyId: params.companyId,
      transactionType: 'DEPRECIATION_RUN',
      module: 'fixed-assets',
      documentType: 'DepreciationRun',
      documentId: run.id,
      documentReference: `DEP-${period.startDate.toISOString().slice(0, 7)}`,
      amount: kobo(totalAmountKobo),
      currencyId: context.baseCurrencyId,
      branchId: branch.id,
      actor: params.actor,
    });

    await this.prisma.depreciationRun.update({
      where: { id: run.id },
      data: { status: WorkflowStatus.SUBMITTED, workflowTransactionId: result.transactionId },
    });

    return {
      runId: run.id,
      assetCount: lines.length,
      totalAmountKobo: totalAmountKobo.toString(),
      awaitingApproval: result.transactionId,
    };
  }

  async postApprovedDepreciation(params: {
    runId: string;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const run = await params.tx.depreciationRun.findUniqueOrThrow({
      where: { id: params.runId },
      include: { entries: { include: { asset: true } }, financialPeriod: true },
    });

    if (run.status === WorkflowStatus.POSTED) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        'This depreciation run is already posted.',
        { runId: run.id },
      );
    }

    const [accounts, context] = await Promise.all([
      this.resolveAccounts(run.companyId, params.tx, ['depreciationExpense', 'accumulatedDepreciation'], run.financialPeriod.endDate),
      params.tx.company.findUniqueOrThrow({
        where: { id: run.companyId },
        select: {
          baseCurrencyId: true,
          branches: { where: { active: true }, take: 1, select: { id: true } },
        },
      }),
    ]);
    const branch = context.branches[0]!;

    const dimensions = {
      companyId: run.companyId,
      branchId: branch.id,
      financialYearId: run.financialPeriod.financialYearId,
      financialPeriodId: run.financialPeriodId,
      currencyId: context.baseCurrencyId,
      exchangeRate: '1.00000000',
    };

    // PCR-031: a machine that serves a processing line or the feed mill is
    // that line's overhead, not general depreciation expense. With machine
    // hours logged for this period it is split across the lines by them;
    // otherwise its one line (or general depreciation) takes it all.
    const hours = await params.tx.machineHours.findMany({
      where: { assetId: { in: run.entries.map((e) => e.assetId) }, financialPeriodId: run.financialPeriodId },
    });
    const lineAccounts = await this.processingOverheadAccounts(run.companyId, params.tx, [
      ...run.entries.map((entry) => entry.asset.processingCycle),
      ...hours.filter((h) => new Decimal(h.hours.toString()).greaterThan(0)).map((h) => h.processingCycle),
    ]);

    const lines = run.entries.flatMap((entry) => {
      const logged = hours.filter((h) => h.assetId === entry.assetId && new Decimal(h.hours.toString()).greaterThan(0));
      const debits = logged.length > 0
        ? splitByHours(entry.amountKobo, logged).map(({ cycle, amountKobo, hours: h }) => ({
            glAccountId: lineAccounts[cycle]!,
            description: `Depreciation — ${entry.asset.assetNumber} (${h} machine hours)`,
            amountKobo,
          }))
        : [{
            glAccountId: entry.asset.processingCycle ? lineAccounts[entry.asset.processingCycle]! : accounts.depreciationExpense,
            description: `Depreciation — ${entry.asset.assetNumber}`,
            amountKobo: entry.amountKobo,
          }];
      return [
        ...debits
          .filter((d) => d.amountKobo > 0n)
          .map((d) => ({
            glAccountId: d.glAccountId,
            description: d.description,
            debit: kobo(d.amountKobo),
            dimensions: { ...dimensions, costCentreId: entry.asset.costCentreId },
          })),
        {
          glAccountId: accounts.accumulatedDepreciation,
          description: `Depreciation — ${entry.asset.assetNumber}`,
          credit: kobo(entry.amountKobo),
          dimensions: { ...dimensions, costCentreId: entry.asset.costCentreId },
        },
      ];
    });

    const result = await this.posting.post(
      {
        sourceModule: 'fixed-assets',
        sourceDocumentType: 'DepreciationRun',
        sourceDocumentId: run.id,
        journalNumber: `DEP-${run.financialPeriod.startDate.toISOString().slice(0, 7)}`,
        journalDate: run.financialPeriod.startDate,
        narration: `Depreciation — ${run.financialPeriod.name}`,
        ...dimensions,
        idempotencyKey: `depreciation-run:${run.id}`,
        ...(await chartVersionOf(params.tx, run.companyId)) === 'APPROVED' ? { approvedControl: {
          application: 'YifrehCore',
          applicationRuleId: 'COR-YFR-067',
          dynamicAccountIds: {
            DEPRECIATION_EXPENSE: [...new Set(lines.filter((line) => 'debit' in line).map((line) => line.glAccountId))],
            ACCUMULATED_DEPRECIATION: [...new Set(lines.filter((line) => 'credit' in line).map((line) => line.glAccountId))],
          },
        } } : {},
        actor: params.actor,
        lines,
      },
      params.tx,
    );

    for (const entry of run.entries) {
      await params.tx.fixedAsset.update({
        where: { id: entry.assetId },
        data: { accumulatedDepreciationKobo: { increment: entry.amountKobo } },
      });
    }

    await params.tx.depreciationRun.update({
      where: { id: run.id },
      data: { status: WorkflowStatus.POSTED, journalEntryId: result.journalEntryId, postedAt: new Date() },
    });

    this.logger.log(`Posted depreciation run for ${run.financialPeriod.name} — ${run.entries.length} assets`);
    return { journalEntryId: result.journalEntryId };
  }

  /**
   * Submit an asset retirement. On the approved chart the posting follows the
   * workbook's clearing sequence (068C/068D/068E) and uses its mapped disposal
   * loss and clearing accounts. The current form records a retirement without
   * proceeds; cash and credit proceeds still need their own evidence and event
   * details before the 068A/068B paths can be used.
   */
  async dispose(params: {
    assetId: string;
    actor: WorkflowActor;
    disposedOn: Date;
    proceedsKobo?: bigint;
    proceedsMode?: 'CASH' | 'CREDIT' | null;
    bankAccountId?: string | null;
    customerId?: string | null;
  }) {
    const proceedsKobo = params.proceedsKobo ?? 0n;
    const proceedsMode = params.proceedsMode ?? null;
    const bankAccountId = params.bankAccountId ?? null;
    const customerId = params.customerId ?? null;
    const asset = await this.prisma.fixedAsset.findUniqueOrThrow({ where: { id: params.assetId } });

    if (asset.status !== WorkflowStatus.POSTED) {
      throw new AccountingRuleViolation(
        'PCR-029 — Fixed asset capitalisation',
        `${asset.assetNumber} is not yet a posted, in-service asset (status ${asset.status}).`,
        { assetNumber: asset.assetNumber },
      );
    }
    if (asset.disposedOn) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${asset.assetNumber} was already disposed on ${asset.disposedOn.toISOString().slice(0, 10)}.`,
        { assetNumber: asset.assetNumber },
      );
    }
    if (proceedsKobo < 0n) throw new AccountingRuleViolation('Fixed asset disposal proceeds', 'Proceeds cannot be negative.', {});
    if (proceedsKobo > 0n && !proceedsMode) throw new AccountingRuleViolation('Fixed asset disposal proceeds', 'Choose whether proceeds were received in cash or are due from a customer.', {});
    if (proceedsMode === 'CASH' && proceedsKobo > 0n && !bankAccountId) throw new AccountingRuleViolation('Fixed asset disposal proceeds', 'Choose the bank account that received the cash proceeds.', {});
    if (proceedsMode === 'CREDIT' && proceedsKobo > 0n && !customerId) throw new AccountingRuleViolation('Fixed asset disposal proceeds', 'Choose the customer who owes the credit proceeds.', {});
    if (proceedsMode === 'CASH' && bankAccountId) {
      const bank = await this.prisma.bankAccount.findFirst({ where: { id: bankAccountId, companyId: asset.companyId, active: true }, select: { glAccountId: true } });
      if (!bank) throw new AccountingRuleViolation('Fixed asset disposal bank', 'Choose an active bank account belonging to this company.', {});
      await assertBankGlAccount(this.prisma, asset.companyId, bank.glAccountId, 'Fixed asset disposal proceeds');
    }
    if (proceedsMode === 'CREDIT' && customerId) {
      const customer = await this.prisma.customer.findFirst({ where: { id: customerId, companyId: asset.companyId, status: 'ACTIVE' }, select: { id: true } });
      if (!customer) throw new AccountingRuleViolation('Fixed asset disposal customer', 'Choose an active customer belonging to this company.', {});
    }

    const context = await this.prisma.company.findUniqueOrThrow({
      where: { id: asset.companyId },
      select: { baseCurrencyId: true, branches: { where: { active: true }, take: 1, select: { id: true } } },
    });
    const branch = context.branches[0];
    if (!branch) throw new AccountingRuleViolation('§1 — Company setup', 'This company has no active branch.', {});

    const netBookValueKobo = asset.costKobo - asset.accumulatedDepreciationKobo;

    const result = await this.workflow.submit({
      companyId: asset.companyId,
      transactionType: 'FIXED_ASSET_DISPOSAL',
      module: 'fixed-assets',
      // Deliberately NOT 'FixedAsset' — WorkflowTransaction's own uniqueness
      // is (module, documentType, documentId) with no transactionType in the
      // key, so reusing the same documentType as capitalise() would collide
      // with that asset's own already-POSTED capitalisation transaction and
      // refuse to submit ("already in workflow"). A distinct documentType is
      // enough to give disposal its own row on the same underlying asset —
      // no new table needed, since documentId is still the asset's own id and
      // every other query here reads listAssets()'s pending lookup off
      // documentId alone, not documentType.
      documentType: 'FixedAssetDisposal',
      documentId: asset.id,
      documentReference: asset.assetNumber,
      amount: kobo(netBookValueKobo),
      currencyId: context.baseCurrencyId,
      branchId: branch.id,
      costCentreId: asset.costCentreId ?? undefined,
      actor: params.actor,
      postingPayload: {
        disposedOn: params.disposedOn.toISOString(),
        proceedsKobo: proceedsKobo.toString(),
        proceedsMode: proceedsKobo > 0n ? proceedsMode : null,
        bankAccountId: proceedsKobo > 0n && proceedsMode === 'CASH' ? bankAccountId : null,
        customerId: proceedsKobo > 0n && proceedsMode === 'CREDIT' ? customerId : null,
      },
    });

    await this.prisma.fixedAsset.update({
      where: { id: asset.id },
      data: { status: WorkflowStatus.SUBMITTED, workflowTransactionId: result.transactionId },
    });

    await this.audit.write({
      transactionId: asset.id,
      module: 'fixed-assets',
      entityType: 'FixedAsset',
      entityId: asset.id,
      status: WorkflowStatus.SUBMITTED,
      action: AuditAction.UPDATE,
      userId: params.actor.userId,
      comments: `Raised disposal of ${asset.assetNumber}, net book value ${netBookValueKobo.toString()} kobo, proceeds ${proceedsKobo.toString()} kobo${proceedsMode ? ` (${proceedsMode.toLowerCase()})` : ''}.`,
    });

    return {
      assetId: asset.id,
      assetNumber: asset.assetNumber,
      netBookValueKobo: netBookValueKobo.toString(),
      awaitingApproval: result.transactionId,
    };
  }

  async postApprovedDisposal(params: {
    assetId: string;
    disposedOn: Date;
    proceedsKobo: bigint;
    proceedsMode: 'CASH' | 'CREDIT' | null;
    bankAccountId: string | null;
    customerId: string | null;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const asset = await params.tx.fixedAsset.findUniqueOrThrow({ where: { id: params.assetId } });

    if (asset.disposedOn) {
      throw new AccountingRuleViolation(
        'Rule 2 — Posted transactions are immutable',
        `${asset.assetNumber} was already disposed.`,
        { assetNumber: asset.assetNumber },
      );
    }

    const approvedChart = await chartVersionOf(params.tx, asset.companyId) === 'APPROVED';
    if (params.proceedsKobo > 0n && !approvedChart) {
      throw new AccountingRuleViolation('Fixed asset disposal proceeds', 'Proceeds posting requires the approved disposal controls. Complete chart cutover before recording sale proceeds.', {});
    }
    if (params.proceedsKobo < 0n) throw new AccountingRuleViolation('Fixed asset disposal proceeds', 'Proceeds cannot be negative.', {});
    const [accounts, context, period, disposalLoss, disposalClearing] = await Promise.all([
      this.resolveAccounts(asset.companyId, params.tx, [
        'ppe',
        'accumulatedDepreciation',
        'depreciationExpense',
        'receivables',
      ], params.disposedOn),
      params.tx.company.findUniqueOrThrow({
        where: { id: asset.companyId },
        select: { baseCurrencyId: true, branches: { where: { active: true }, take: 1, select: { id: true } } },
      }),
      this.currentPeriod(asset.companyId, params.disposedOn, params.tx),
      approvedChart ? resolveApprovedMappedAccount(params.tx, { companyId: asset.companyId, application: 'YifrehCore', masterType: 'Asset class', masterId: asset.assetClass, postingKey: 'DISPOSAL_LOSS', on: params.disposedOn }) : Promise.resolve(null),
      approvedChart ? resolveApprovedMappedAccount(params.tx, { companyId: asset.companyId, application: 'YifrehCore', masterType: 'Asset class', masterId: asset.assetClass, postingKey: 'DISPOSAL_CLEARING', on: params.disposedOn }) : Promise.resolve(null),
    ]);
    const branch = context.branches[0]!;

    const dimensions = {
      companyId: asset.companyId,
      branchId: branch.id,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      currencyId: context.baseCurrencyId,
      exchangeRate: '1.00000000',
      costCentreId: asset.costCentreId,
    };

    const netBookValueKobo = asset.costKobo - asset.accumulatedDepreciationKobo;
    const gainKobo = params.proceedsKobo > netBookValueKobo ? params.proceedsKobo - netBookValueKobo : 0n;
    const lossKobo = netBookValueKobo > params.proceedsKobo ? netBookValueKobo - params.proceedsKobo : 0n;
    let proceedsAccountId: string | null = null;
    if (params.proceedsKobo > 0n && params.proceedsMode === 'CASH' && params.bankAccountId) {
      const bank = await params.tx.bankAccount.findFirst({ where: { id: params.bankAccountId, companyId: asset.companyId, active: true }, select: { glAccountId: true } });
      if (!bank) throw new AccountingRuleViolation('Fixed asset disposal bank', 'The selected bank account is no longer active for this company.', {});
      await assertBankGlAccount(params.tx, asset.companyId, bank.glAccountId, 'Fixed asset disposal proceeds');
      const assignedBank = await resolveApprovedMappedAccount(params.tx, { companyId: asset.companyId, application: 'YifrehCore', masterType: 'Bank', masterId: params.bankAccountId, postingKey: 'BANK', on: params.disposedOn });
      if (assignedBank.glAccountId !== bank.glAccountId) throw new AccountingRuleViolation('Approved Posting Group — bank account', 'The selected bank account GL does not match its assigned workbook bank posting group.', { bankAccountId: params.bankAccountId, bankAccountGlId: bank.glAccountId, assignedGlId: assignedBank.glAccountId });
      proceedsAccountId = bank.glAccountId;
    } else if (params.proceedsKobo > 0n && params.proceedsMode === 'CREDIT' && params.customerId) {
      const customer = await params.tx.customer.findFirst({ where: { id: params.customerId, companyId: asset.companyId, status: 'ACTIVE' }, select: { id: true } });
      if (!customer) throw new AccountingRuleViolation('Fixed asset disposal customer', 'The selected customer is no longer active for this company.', {});
      proceedsAccountId = (await resolveApprovedMappedAccount(params.tx, { companyId: asset.companyId, application: 'YifrehCore', masterType: 'Customer', masterId: customer.id, postingKey: 'AR_CONTROL', on: params.disposedOn })).glAccountId;
    }
    if (params.proceedsKobo > 0n && !proceedsAccountId) throw new AccountingRuleViolation('Fixed asset disposal proceeds', 'Choose a valid bank account or customer for the recorded proceeds.', {});
    const disposalGain = gainKobo > 0n && approvedChart
      ? await resolveApprovedMappedAccount(params.tx, { companyId: asset.companyId, application: 'YifrehCore', masterType: 'Asset class', masterId: asset.assetClass, postingKey: 'DISPOSAL_GAIN', on: params.disposedOn })
      : null;

    const lines = approvedChart ? [
      ...(asset.accumulatedDepreciationKobo > 0n ? [
        { glAccountId: accounts.accumulatedDepreciation, description: `Disposal — ${asset.assetNumber} (accumulated depreciation)`, debit: kobo(asset.accumulatedDepreciationKobo), dimensions },
        { glAccountId: disposalClearing!.glAccountId, description: `Disposal — ${asset.assetNumber} (accumulated depreciation cleared)`, credit: kobo(asset.accumulatedDepreciationKobo), dimensions },
      ] : []),
      { glAccountId: disposalClearing!.glAccountId, description: `Disposal — ${asset.assetNumber} (asset cost cleared)`, debit: kobo(asset.costKobo), dimensions },
      { glAccountId: accounts.ppe, description: `Disposal — ${asset.assetNumber}`, credit: kobo(asset.costKobo), dimensions },
      ...(params.proceedsKobo > 0n ? [
        { glAccountId: proceedsAccountId!, description: `Disposal proceeds — ${asset.assetNumber}`, debit: kobo(params.proceedsKobo), dimensions: { ...dimensions, ...(params.proceedsMode === 'CREDIT' && params.customerId ? { customerId: params.customerId } : {}) } },
        { glAccountId: disposalClearing!.glAccountId, description: `Disposal proceeds cleared — ${asset.assetNumber}`, credit: kobo(params.proceedsKobo), dimensions },
      ] : []),
      ...(lossKobo > 0n ? [
        { glAccountId: disposalLoss!.glAccountId, description: `Disposal — ${asset.assetNumber} (net book value loss)`, debit: kobo(lossKobo), dimensions },
        { glAccountId: disposalClearing!.glAccountId, description: `Disposal — ${asset.assetNumber} (loss cleared)`, credit: kobo(lossKobo), dimensions },
      ] : []),
      ...(gainKobo > 0n && disposalGain ? [
        { glAccountId: disposalClearing!.glAccountId, description: `Disposal — ${asset.assetNumber} (gain cleared)`, debit: kobo(gainKobo), dimensions },
        { glAccountId: disposalGain.glAccountId, description: `Disposal — ${asset.assetNumber} (gain)`, credit: kobo(gainKobo), dimensions },
      ] : []),
    ] : [
      ...(asset.accumulatedDepreciationKobo > 0n ? [{ glAccountId: accounts.accumulatedDepreciation, description: `Disposal — ${asset.assetNumber} (accumulated depreciation)`, debit: kobo(asset.accumulatedDepreciationKobo), dimensions }] : []),
      ...(netBookValueKobo > 0n ? [{ glAccountId: accounts.depreciationExpense, description: `Disposal — ${asset.assetNumber} (remaining net book value written off)`, debit: kobo(netBookValueKobo), dimensions }] : []),
      { glAccountId: accounts.ppe, description: `Disposal — ${asset.assetNumber}`, credit: kobo(asset.costKobo), dimensions },
    ];

    const result = await this.posting.post(
      {
        sourceModule: 'fixed-assets',
        sourceDocumentType: 'FixedAsset',
        sourceDocumentId: asset.id,
        journalNumber: `DISPOSAL-${asset.assetNumber}`,
        journalDate: params.disposedOn,
        narration: `Disposal of ${asset.assetNumber} — ${asset.name}`,
        ...dimensions,
        idempotencyKey: `fixed-asset-disposal:${asset.id}`,
        ...(approvedChart ? { approvedControl: {
          application: 'YifrehCore', applicationRuleId: 'COR-YFR-068D',
          additionalApplicationRuleIds: [
            ...(asset.accumulatedDepreciationKobo > 0n ? ['COR-YFR-068C'] : []),
            ...(params.proceedsKobo > 0n ? [params.proceedsMode === 'CASH' ? 'COR-YFR-068A' : 'COR-YFR-068B'] : []),
            ...(lossKobo > 0n ? ['COR-YFR-068E'] : []),
            ...(gainKobo > 0n ? ['COR-YFR-068F'] : []),
          ],
          expectedLineAmountsKobo: {
            'COR-YFR-068D:1': asset.costKobo.toString(), 'COR-YFR-068D:2': asset.costKobo.toString(),
            ...(asset.accumulatedDepreciationKobo > 0n ? { 'COR-YFR-068C:1': asset.accumulatedDepreciationKobo.toString(), 'COR-YFR-068C:2': asset.accumulatedDepreciationKobo.toString() } : {}),
            ...(params.proceedsKobo > 0n ? {
              [`${params.proceedsMode === 'CASH' ? 'COR-YFR-068A' : 'COR-YFR-068B'}:1`]: params.proceedsKobo.toString(),
              [`${params.proceedsMode === 'CASH' ? 'COR-YFR-068A' : 'COR-YFR-068B'}:2`]: params.proceedsKobo.toString(),
            } : {}),
            ...(lossKobo > 0n ? { 'COR-YFR-068E:1': lossKobo.toString(), 'COR-YFR-068E:2': lossKobo.toString() } : {}),
            ...(gainKobo > 0n ? { 'COR-YFR-068F:1': gainKobo.toString(), 'COR-YFR-068F:2': gainKobo.toString() } : {}),
          },
        } } : {}),
        actor: params.actor,
        lines,
      },
      params.tx,
    );

    await params.tx.fixedAsset.update({
      where: { id: asset.id },
      data: {
        status: WorkflowStatus.POSTED,
        disposedOn: params.disposedOn,
        accumulatedDepreciationKobo: asset.costKobo,
      },
    });

    this.logger.log(`Posted disposal of ${asset.assetNumber}`);
    return { journalEntryId: result.journalEntryId };
  }

  // -------------------------------------------------------------------------

  private async nextAssetNumber(companyId: string): Promise<string> {
    const count = await this.prisma.fixedAsset.count({ where: { companyId } });
    return `FA-${String(count + 1).padStart(5, '0')}`;
  }

  private async currentPeriod(companyId: string, on: Date, tx: Prisma.TransactionClient) {
    const period = await tx.financialPeriod.findFirst({
      where: {
        financialYear: { companyId },
        startDate: { lte: on },
        endDate: { gte: on },
      },
      select: { id: true, financialYearId: true, status: true, name: true },
    });
    if (!period) {
      throw new AccountingRuleViolation(
        '§9 — Financial period',
        `No financial period covers ${on.toISOString().slice(0, 10)}.`,
        {},
      );
    }
    if (period.status !== 'OPEN') {
      throw new AccountingRuleViolation(
        '§9 — Financial period',
        `${period.name} is ${period.status.toLowerCase()}. This cannot post into a closed period.`,
        {},
      );
    }
    return period;
  }

  /**
   * PCR-031 — mark a machine as serving one processing line (or none). Only
   * future depreciation follows it; posted runs are never re-pointed.
   */
  async setProcessingCycle(params: { companyId: string; assetId: string; processingCycle: ProductionOrderCycle | null; actor: WorkflowActor }) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: params.assetId, companyId: params.companyId } });
    if (!asset) throw new NotFoundException('No such asset in this company.');
    if (params.processingCycle) {
      await this.processingOverheadAccounts(params.companyId, this.prisma, [params.processingCycle]);
    }
    await this.prisma.fixedAsset.update({ where: { id: asset.id }, data: { processingCycle: params.processingCycle } });
    await this.audit.write({
      transactionId: asset.id,
      module: 'fixed-assets',
      entityType: 'FixedAsset',
      entityId: asset.id,
      status: asset.status,
      action: AuditAction.UPDATE,
      userId: params.actor.userId,
      oldValue: { processingCycle: asset.processingCycle },
      newValue: { processingCycle: params.processingCycle },
    });
    return { id: asset.id, processingCycle: params.processingCycle };
  }

  /**
   * PCR-031 by machine hours — a machine's hours on each line for a period,
   * replacing whatever was logged for it there before. A line left at zero is
   * removed. Posted depreciation is never re-split.
   */
  async setMachineHours(params: {
    companyId: string;
    assetId: string;
    financialPeriodId: string;
    hours: Partial<Record<ProductionOrderCycle, Decimal>>;
    actor: WorkflowActor;
  }) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: params.assetId, companyId: params.companyId } });
    if (!asset) throw new NotFoundException('No such asset in this company.');
    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: params.financialPeriodId, financialYear: { companyId: params.companyId } },
    });
    if (!period) throw new NotFoundException('No such period in this company.');
    const posted = await this.prisma.depreciationEntry.findFirst({
      where: { assetId: asset.id, run: { financialPeriodId: period.id, status: WorkflowStatus.POSTED } },
    });
    if (posted) {
      throw new AccountingRuleViolation(
        'PCR-031 — Manufacturing depreciation',
        `Depreciation for ${asset.assetNumber} in ${period.name} is already posted; its hours can no longer change how it was split.`,
        { assetId: asset.id, periodId: period.id },
      );
    }
    const used = Object.entries(params.hours).filter(([, h]) => h && h.greaterThan(0)) as Array<[ProductionOrderCycle, Decimal]>;
    await this.processingOverheadAccounts(params.companyId, this.prisma, used.map(([cycle]) => cycle));

    await this.prisma.$transaction(async (tx) => {
      await tx.machineHours.deleteMany({ where: { assetId: asset.id, financialPeriodId: period.id } });
      if (used.length > 0) {
        await tx.machineHours.createMany({
          data: used.map(([cycle, h]) => ({
            companyId: params.companyId,
            assetId: asset.id,
            financialPeriodId: period.id,
            processingCycle: cycle,
            hours: new Prisma.Decimal(h.toFixed(2)),
            createdById: params.actor.userId,
          })),
        });
      }
    });
    await this.audit.write({
      transactionId: asset.id,
      module: 'fixed-assets',
      entityType: 'MachineHours',
      entityId: asset.id,
      status: asset.status,
      action: AuditAction.UPDATE,
      userId: params.actor.userId,
      newValue: { period: period.name, hours: Object.fromEntries(used.map(([c, h]) => [c, h.toString()])) },
    });
    return this.machineHours(params.companyId, period.id, asset.id);
  }

  async machineHours(companyId: string, financialPeriodId: string, assetId?: string) {
    const rows = await this.prisma.machineHours.findMany({
      where: { companyId, financialPeriodId, ...(assetId ? { assetId } : {}) },
      select: { assetId: true, processingCycle: true, hours: true },
    });
    return rows.map((r) => ({ assetId: r.assetId, processingCycle: r.processingCycle, hours: r.hours.toString() }));
  }

  /** Each processing line's overhead pool — PCR-055-DR, PCR-077-DR, and the feed mill's own. */
  private async processingOverheadAccounts(
    companyId: string,
    client: Prisma.TransactionClient | PrismaService,
    cycles: Array<ProductionOrderCycle | null>,
  ): Promise<Partial<Record<ProductionOrderCycle, string>>> {
    const wanted = [...new Set(cycles.filter((c): c is ProductionOrderCycle => !!c))];
    if (wanted.length === 0) return {};
    // 621200/622100/623100 on the old charts; on the approved chart machine
    // depreciation for a processing line is depreciation expense (52400, or the
    // feed-milling conversion cost 52700) with the line kept on the asset.
    const version = await chartVersionOf(client, companyId);
    const numberOf = (cycle: ProductionOrderCycle) => processingOverheadNumber(version, cycle);
    if (version === 'APPROVED') {
      const mapped: Partial<Record<ProductionOrderCycle, string>> = {};
      for (const cycle of wanted) {
        if (cycle === ProductionOrderCycle.FEED_MILL) {
          throw new AccountingRuleViolation('Approved Account Map — feed-mill depreciation', 'The workbook does not map feed-mill depreciation to a conversion-cost account. Finance must approve the proposed account before this flow can post.', { companyId, cycle });
        }
        const prefix = cycle === ProductionOrderCycle.SNAILPRO ? 'SNP' : 'PLP';
        const application = cycle === ProductionOrderCycle.SNAILPRO ? 'YifrehSnail' : 'YifrehPoultry';
        mapped[cycle] = (await resolveApprovedMappedAccount(client, {
          companyId, application, postingGroup: `${prefix}-FA-EQUIP`, postingKey: 'DEPRECIATION_EXPENSE', on: new Date(),
        })).glAccountId;
      }
      return mapped;
    }
    const numbers = wanted.map(numberOf);
    const accounts = await client.gLAccount.findMany({
      where: { companyId, accountNumber: { in: numbers }, active: true },
      select: { id: true, accountNumber: true },
    });
    const resolved: Partial<Record<ProductionOrderCycle, string>> = {};
    for (const cycle of wanted) {
      const { name } = PROCESSING_OVERHEAD[cycle];
      const number = numberOf(cycle);
      const account = accounts.find((a) => a.accountNumber === number);
      if (!account) {
        throw new AccountingRuleViolation(
          'PCR-031 — Manufacturing depreciation',
          `Depreciation for this line posts to ${number} (${name}), which this chart does not have. Load the posting rules on Controls first.`,
          { accountNumber: number, processingCycle: cycle },
        );
      }
      resolved[cycle] = account.id;
    }
    return resolved;
  }

  private async resolveAccounts<K extends string>(
    companyId: string,
    tx: Prisma.TransactionClient,
    keys: K[],
    on = new Date(),
  ): Promise<Record<K, string>> {
    // On the company's own chart (chart.ts).
    const version = await chartVersionOf(tx, companyId);
    const numbers: Record<string, string> = version === 'APPROVED'
      ? Object.fromEntries(await Promise.all(keys.map(async (key) => {
          const map = key === 'ppe' ? ['COR-FA-EQUIP', 'FA_COST']
            : key === 'accumulatedDepreciation' ? ['COR-FA-EQUIP', 'ACCUMULATED_DEPRECIATION']
              : key === 'depreciationExpense' ? ['COR-FA-EQUIP', 'DEPRECIATION_EXPENSE']
                : key === 'receivables' ? ['COR-CUST-LOCAL', 'AR_CONTROL']
                : key === 'payables' ? ['COR-VEND-LOCAL', 'AP_CONTROL'] : null;
          if (!map) throw new AccountingRuleViolation('Approved Account Map — fixed assets', `No approved map selector is configured for ${key}.`, { key });
          const resolved = await resolveApprovedMappedAccount(tx, { companyId, application: 'YifrehCore', postingGroup: map[0]!, postingKey: map[1]!, on });
          return [key, resolved.accountNumber];
        })))
      : {
          ppe: numberFor(version, 'ppe'),
          accumulatedDepreciation: numberFor(version, 'accumulatedDepreciation'),
          depreciationExpense: numberFor(version, 'depreciationExpense'),
          receivables: numberFor(version, 'receivables'),
          payables: numberFor(version, 'tradePayables'),
        };

    const wanted = keys.map((key) => numbers[key]!);
    const accounts = await tx.gLAccount.findMany({
      where: { companyId, accountNumber: { in: wanted } },
      select: { id: true, accountNumber: true, active: true, isPostingAccount: true, isControlAccount: true },
    });
    const byNumber = new Map(accounts.map((a) => [a.accountNumber, a]));

    const resolved: Record<string, string> = {};
    for (const key of keys) {
      const number = numbers[key]!;
      const account = byNumber.get(number);
      if (!account || !account.active || (!account.isPostingAccount && !account.isControlAccount)) {
        throw new AccountingRuleViolation(
          'Posting-control — Fixed assets',
          `Fixed assets need active GL account ${number} (${key}) configured as a posting or control account.`,
          { accountNumber: number, purpose: key },
        );
      }
      resolved[key] = account.id;
    }
    return resolved as Record<K, string>;
  }
}

/** PCR-031-DR "Processing/Feed-mill OH Expense", per line. */
export const PROCESSING_OVERHEAD: Record<ProductionOrderCycle, { number: string; name: string }> = {
  SNAILPRO: { number: '621200', name: 'Snail Processing Overhead Expense' },
  POULTRYPRO: { number: '622100', name: 'Poultry Processing Conversion Expense' },
  FEED_MILL: { number: '623100', name: 'Feed Mill Overhead Expense' },
};

/** Largest-remainder split of a depreciation amount across lines by machine hours. */
function splitByHours(
  amountKobo: bigint,
  rows: Array<{ processingCycle: ProductionOrderCycle; hours: Prisma.Decimal }>,
): Array<{ cycle: ProductionOrderCycle; hours: string; amountKobo: bigint }> {
  const total = rows.reduce((sum, r) => sum.plus(r.hours.toString()), new Decimal(0));
  const exact = rows.map((r) => new Decimal(amountKobo.toString()).mul(r.hours.toString()).div(total));
  const shares = exact.map((e) => BigInt(e.floor().toFixed(0)));
  let left = amountKobo - shares.reduce((sum, x) => sum + x, 0n);
  const order = exact
    .map((e, i) => ({ i, frac: e.minus(e.floor()) }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0n) break;
    shares[i] = shares[i]! + 1n;
    left -= 1n;
  }
  return rows.map((r, i) => ({ cycle: r.processingCycle, hours: r.hours.toString(), amountKobo: shares[i]! }));
}
