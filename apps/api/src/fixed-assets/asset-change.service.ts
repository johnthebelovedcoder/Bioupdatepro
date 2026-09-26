import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ImpairmentStatus, WorkflowStatus } from '@bioassetpro/database';
import { chartVersionOf, numberFor } from '../chart/chart';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostingService } from '../posting/posting.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { allowsSelfApproval } from '../workflow/self-approval';
import { AccountingRuleViolation } from '../common/errors';
import { kobo } from '../common/money';

/** Who approves an impairment — it writes down the balance sheet. */
export const IMPAIRMENT_APPROVERS = ['FINANCE_CONTROLLER', 'CFO'];

const RULE = 'IAS 36 — Impairment of assets';

/**
 * Impairment and transfer of fixed assets (handbook §36, §46 "FA/PPE,
 * impairment").
 *
 * Impairment: raised with the recoverable amount and the evidence for it,
 * approved by the controller or CFO (not whoever raised it), then posted Dr
 * Impairment loss / Cr Accumulated depreciation and impairment. From the next
 * run, depreciation spreads what is left over the remaining life.
 *
 * Transfer: an asset moves to another cost centre with a reason and date. No
 * journal — the asset stays in the same account; depreciation posted from
 * then on carries the new cost centre.
 */
@Injectable()
export class AssetChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  async history(companyId: string, assetId: string) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: assetId, companyId }, select: { id: true } });
    if (!asset) throw new NotFoundException('No such asset in this company.');
    const [impairments, transfers] = await Promise.all([
      this.prisma.fixedAssetImpairment.findMany({ where: { companyId, assetId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.fixedAssetTransfer.findMany({ where: { companyId, assetId }, orderBy: { effectiveOn: 'desc' } }),
    ]);
    const centreIds = [...new Set(transfers.flatMap((t) => [t.fromCostCentreId, t.toCostCentreId]).filter((x): x is string => !!x))];
    const centres = await this.prisma.costCentre.findMany({ where: { companyId, id: { in: centreIds } }, select: { id: true, code: true, name: true } });
    const label = (id: string | null) => {
      const c = centres.find((x) => x.id === id);
      return c ? `${c.code} — ${c.name}` : 'none';
    };
    return {
      impairments: impairments.map((i) => ({
        id: i.id,
        impairedOn: i.impairedOn.toISOString().slice(0, 10),
        amountKobo: i.amountKobo.toString(),
        recoverableAmountKobo: i.recoverableAmountKobo.toString(),
        reason: i.reason,
        evidence: i.evidence,
        status: i.status,
        requestedById: i.requestedById,
        decisionNote: i.decisionNote,
      })),
      transfers: transfers.map((t) => ({
        id: t.id,
        effectiveOn: t.effectiveOn.toISOString().slice(0, 10),
        from: label(t.fromCostCentreId),
        to: label(t.toCostCentreId),
        reason: t.reason,
      })),
    };
  }

  /** Impairments waiting for a decision, across the register. */
  async pendingImpairments(companyId: string) {
    const rows = await this.prisma.fixedAssetImpairment.findMany({
      where: { companyId, status: ImpairmentStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: { asset: { select: { assetNumber: true, name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      assetNumber: r.asset.assetNumber,
      name: r.asset.name,
      impairedOn: r.impairedOn.toISOString().slice(0, 10),
      amountKobo: r.amountKobo.toString(),
      recoverableAmountKobo: r.recoverableAmountKobo.toString(),
      reason: r.reason,
      evidence: r.evidence,
      requestedById: r.requestedById,
    }));
  }

  async requestImpairment(params: {
    companyId: string;
    assetId: string;
    impairedOn: Date;
    recoverableAmountKobo: bigint;
    reason: string;
    evidence?: string | null;
    actor: WorkflowActor;
  }) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: params.assetId, companyId: params.companyId } });
    if (!asset) throw new NotFoundException('No such asset in this company.');
    if (asset.status !== WorkflowStatus.POSTED || asset.disposedOn) {
      throw new AccountingRuleViolation(RULE, `${asset.assetNumber} is not an in-service asset.`, { assetNumber: asset.assetNumber });
    }
    if (!params.reason?.trim()) throw new BadRequestException('Say what indicates the impairment.');
    if (params.recoverableAmountKobo < 0n) throw new BadRequestException('The recoverable amount cannot be negative.');
    const pending = await this.prisma.fixedAssetImpairment.findFirst({
      where: { companyId: params.companyId, assetId: asset.id, status: ImpairmentStatus.PENDING },
      select: { id: true },
    });
    if (pending) throw new BadRequestException(`${asset.assetNumber} already has an impairment awaiting a decision.`);
    const carrying = asset.costKobo - asset.accumulatedDepreciationKobo;
    const amount = carrying - params.recoverableAmountKobo;
    if (amount <= 0n) {
      throw new AccountingRuleViolation(
        RULE,
        `${asset.assetNumber} is carried at ${carrying} kobo; a recoverable amount of ${params.recoverableAmountKobo} kobo is not below it, so there is nothing to impair. Reversals of impairment are not recorded here.`,
        { carryingKobo: carrying.toString() },
      );
    }
    const row = await this.prisma.fixedAssetImpairment.create({
      data: {
        companyId: params.companyId,
        assetId: asset.id,
        impairedOn: params.impairedOn,
        amountKobo: amount,
        recoverableAmountKobo: params.recoverableAmountKobo,
        reason: params.reason.trim(),
        evidence: params.evidence?.trim() || null,
        requestedById: params.actor.userId,
      },
    });
    await this.audit.write({
      transactionId: asset.id,
      module: 'fixed-assets',
      entityType: 'FixedAssetImpairment',
      entityId: row.id,
      status: row.status,
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      comments: `Impairment of ${asset.assetNumber} raised: ${amount} kobo, from ${carrying} to ${params.recoverableAmountKobo}. ${row.reason}`,
    });
    return { id: row.id, amountKobo: amount.toString(), carryingKobo: carrying.toString() };
  }

  async decideImpairment(params: { companyId: string; impairmentId: string; decision: 'APPROVE' | 'REJECT'; note?: string | null; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => IMPAIRMENT_APPROVERS.includes(r))) {
      throw new ForbiddenException('An impairment is approved by the finance controller or the CFO.');
    }
    const row = await this.prisma.fixedAssetImpairment.findFirst({ where: { id: params.impairmentId, companyId: params.companyId } });
    if (!row) throw new NotFoundException('No such impairment.');
    if (row.status !== ImpairmentStatus.PENDING) throw new BadRequestException(`That impairment was already ${row.status.toLowerCase()}.`);
    if (row.requestedById === params.actor.userId && !(await allowsSelfApproval(this.prisma, params.companyId))) {
      throw new ForbiddenException('You raised this impairment, so someone else approves it.');
    }
    if (params.decision === 'REJECT') {
      if (!params.note?.trim()) throw new BadRequestException('Say why the impairment is rejected.');
      await this.prisma.fixedAssetImpairment.update({
        where: { id: row.id },
        data: { status: ImpairmentStatus.REJECTED, decidedById: params.actor.userId, decidedAt: new Date(), decisionNote: params.note.trim() },
      });
      await this.audit.write({
        transactionId: row.assetId,
        module: 'fixed-assets',
        entityType: 'FixedAssetImpairment',
        entityId: row.id,
        status: ImpairmentStatus.REJECTED,
        action: AuditAction.REJECT,
        userId: params.actor.userId,
        comments: params.note.trim(),
      });
      return { id: row.id, status: ImpairmentStatus.REJECTED };
    }

    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findUniqueOrThrow({ where: { id: row.assetId } });
      const carrying = asset.costKobo - asset.accumulatedDepreciationKobo;
      // Depreciation may have posted since it was raised; impair only to the recoverable amount.
      const amount = carrying - row.recoverableAmountKobo;
      if (amount <= 0n || asset.disposedOn) {
        throw new AccountingRuleViolation(RULE, `${asset.assetNumber} is now carried at ${carrying} kobo, not above its recoverable amount; raise it again if still impaired.`, {});
      }
      const period = await tx.financialPeriod.findFirst({
        where: { financialYear: { companyId: row.companyId }, startDate: { lte: row.impairedOn }, endDate: { gte: row.impairedOn } },
        select: { id: true, financialYearId: true, status: true, name: true },
      });
      if (!period || period.status !== 'OPEN') {
        throw new AccountingRuleViolation(RULE, `No open period covers ${row.impairedOn.toISOString().slice(0, 10)}.`, {});
      }
      const version = await chartVersionOf(tx, row.companyId);
      const [lossNumber, accumulatedNumber] = [numberFor(version, 'impairmentLoss'), numberFor(version, 'accumulatedDepreciation')];
      const accounts = await tx.gLAccount.findMany({
        where: { companyId: row.companyId, accountNumber: { in: [lossNumber, accumulatedNumber] }, active: true, isPostingAccount: true },
        select: { id: true, accountNumber: true },
      });
      const loss = accounts.find((a) => a.accountNumber === lossNumber);
      const accumulated = accounts.find((a) => a.accountNumber === accumulatedNumber);
      if (!loss || !accumulated) {
        throw new AccountingRuleViolation(
          RULE,
          `Impairment posts to ${lossNumber} (impairment loss) and ${accumulatedNumber} (accumulated depreciation and impairment); ${!loss ? lossNumber : accumulatedNumber} is missing or inactive. Add it under Setup → Accounts.`,
          { accountNumber: !loss ? lossNumber : accumulatedNumber },
        );
      }
      const company = await tx.company.findUniqueOrThrow({
        where: { id: row.companyId },
        select: { baseCurrencyId: true, branches: { where: { active: true }, take: 1, select: { id: true } } },
      });
      const dimensions = {
        companyId: row.companyId,
        branchId: company.branches[0]!.id,
        financialYearId: period.financialYearId,
        financialPeriodId: period.id,
        currencyId: company.baseCurrencyId,
        exchangeRate: '1.00000000',
        costCentreId: asset.costCentreId,
      };
      const result = await this.posting.post(
        {
          sourceModule: 'fixed-assets',
          sourceDocumentType: 'FixedAssetImpairment',
          sourceDocumentId: row.id,
          journalNumber: `IMP-${asset.assetNumber}-${row.impairedOn.toISOString().slice(0, 10)}`,
          journalDate: row.impairedOn,
          narration: `Impairment of ${asset.assetNumber} — ${asset.name}`,
          ...dimensions,
          idempotencyKey: `fixed-asset-impairment:${row.id}`,
          actor: params.actor,
          lines: [
            { glAccountId: loss.id, description: `Impairment — ${asset.assetNumber} (${row.reason})`, debit: kobo(amount), dimensions },
            { glAccountId: accumulated.id, description: `Impairment — ${asset.assetNumber}`, credit: kobo(amount), dimensions },
          ],
        },
        tx,
      );
      await tx.fixedAsset.update({
        where: { id: asset.id },
        data: { accumulatedDepreciationKobo: { increment: amount }, impairedKobo: { increment: amount } },
      });
      await tx.fixedAssetImpairment.update({
        where: { id: row.id },
        data: {
          status: ImpairmentStatus.POSTED,
          amountKobo: amount,
          journalEntryId: result.journalEntryId,
          decidedById: params.actor.userId,
          decidedAt: new Date(),
          decisionNote: params.note?.trim() || null,
        },
      });
      await this.audit.write(
        {
          transactionId: asset.id,
          module: 'fixed-assets',
          entityType: 'FixedAssetImpairment',
          entityId: row.id,
          status: ImpairmentStatus.POSTED,
          action: AuditAction.APPROVE,
          userId: params.actor.userId,
          comments: `Impairment of ${asset.assetNumber} posted: ${amount} kobo.`,
        },
        tx,
      );
      return { id: row.id, status: ImpairmentStatus.POSTED, amountKobo: amount.toString(), journalEntryId: result.journalEntryId };
    });
  }

  async transfer(params: { companyId: string; assetId: string; toCostCentreId: string | null; effectiveOn: Date; reason: string; actor: WorkflowActor }) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id: params.assetId, companyId: params.companyId } });
    if (!asset) throw new NotFoundException('No such asset in this company.');
    if (asset.disposedOn) throw new BadRequestException(`${asset.assetNumber} was disposed of; it cannot move.`);
    if (!params.reason?.trim()) throw new BadRequestException('Say why the asset is moving.');
    if (params.toCostCentreId) {
      const centre = await this.prisma.costCentre.findFirst({ where: { id: params.toCostCentreId, companyId: params.companyId, active: true }, select: { id: true } });
      if (!centre) throw new BadRequestException('No such active cost centre.');
    }
    if ((asset.costCentreId ?? null) === (params.toCostCentreId ?? null)) {
      throw new BadRequestException(`${asset.assetNumber} is already in that cost centre.`);
    }
    const [moved] = await this.prisma.$transaction([
      this.prisma.fixedAssetTransfer.create({
        data: {
          companyId: params.companyId,
          assetId: asset.id,
          fromCostCentreId: asset.costCentreId,
          toCostCentreId: params.toCostCentreId,
          effectiveOn: params.effectiveOn,
          reason: params.reason.trim(),
          movedById: params.actor.userId,
        },
      }),
      this.prisma.fixedAsset.update({ where: { id: asset.id }, data: { costCentreId: params.toCostCentreId } }),
    ]);
    await this.audit.write({
      transactionId: asset.id,
      module: 'fixed-assets',
      entityType: 'FixedAssetTransfer',
      entityId: moved.id,
      status: asset.status,
      action: AuditAction.UPDATE,
      userId: params.actor.userId,
      oldValue: { costCentreId: asset.costCentreId },
      newValue: { costCentreId: params.toCostCentreId, effectiveOn: params.effectiveOn.toISOString().slice(0, 10) },
      comments: params.reason.trim(),
    });
    return { id: moved.id };
  }
}
