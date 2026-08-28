import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, WorkflowStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

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
      usefulLifeMonths: asset.usefulLifeMonths,
      costCentre: asset.costCentre ? `${asset.costCentre.code} — ${asset.costCentre.name}` : null,
      accumulatedDepreciationKobo: asset.accumulatedDepreciationKobo.toString(),
      netBookValueKobo: (asset.costKobo - asset.accumulatedDepreciationKobo).toString(),
      status: asset.status,
      disposedOn: asset.disposedOn,
      fullyDepreciated: asset.accumulatedDepreciationKobo >= asset.costKobo,
      pendingTransactionId: pending.get(asset.id) ?? null,
    }));
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
      this.resolveAccounts(asset.companyId, params.tx, ['ppe', 'payables']),
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

    const assets = await this.prisma.fixedAsset.findMany({
      where: { companyId: params.companyId, status: WorkflowStatus.POSTED, disposedOn: null },
    });

    const lines = assets
      .map((asset) => {
        const monthly = asset.costKobo / BigInt(asset.usefulLifeMonths);
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

    const period = await this.prisma.financialPeriod.findUniqueOrThrow({
      where: { id: params.financialPeriodId },
      select: { financialYearId: true, startDate: true },
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
      this.resolveAccounts(run.companyId, params.tx, ['depreciationExpense', 'accumulatedDepreciation']),
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

    const lines = run.entries.flatMap((entry) => [
      {
        glAccountId: accounts.depreciationExpense,
        description: `Depreciation — ${entry.asset.assetNumber}`,
        debit: kobo(entry.amountKobo),
        dimensions: { ...dimensions, costCentreId: entry.asset.costCentreId },
      },
      {
        glAccountId: accounts.accumulatedDepreciation,
        description: `Depreciation — ${entry.asset.assetNumber}`,
        credit: kobo(entry.amountKobo),
        dimensions: { ...dimensions, costCentreId: entry.asset.costCentreId },
      },
    ]);

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

  private async resolveAccounts<K extends string>(
    companyId: string,
    tx: Prisma.TransactionClient,
    keys: K[],
  ): Promise<Record<K, string>> {
    const numbers: Record<string, string> = {
      ppe: '1701',
      accumulatedDepreciation: '1702',
      depreciationExpense: '5501',
      payables: '2201',
    };

    const wanted = keys.map((key) => numbers[key]!);
    const accounts = await tx.gLAccount.findMany({
      where: { companyId, accountNumber: { in: wanted } },
      select: { id: true, accountNumber: true, active: true, isPostingAccount: true },
    });
    const byNumber = new Map(accounts.map((a) => [a.accountNumber, a]));

    const resolved: Record<string, string> = {};
    for (const key of keys) {
      const number = numbers[key]!;
      const account = byNumber.get(number);
      if (!account || !account.active || !account.isPostingAccount) {
        throw new AccountingRuleViolation(
          'Posting-control — Fixed assets',
          `Fixed assets need GL account ${number} (${key}) and it is missing, inactive or not a posting account.`,
          { accountNumber: number, purpose: key },
        );
      }
      resolved[key] = account.id;
    }
    return resolved as Record<K, string>;
  }
}
