import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BiologicalAssetService } from '../biological-assets/biological-asset.service';
import { AccountingRuleViolation } from '../common/errors';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Closing a batch — the step that had no screen at all. `LivestockGroup` has
 * always had a CLOSED status and a closedOn date; nothing ever set them, so
 * finished and trial batches stayed "active" for ever: in every picker, in
 * every population count, and in every month's share of wages and overhead.
 *
 * A batch closes when it has no animals left. If some are still recorded —
 * a trial batch, or a count nobody reconciled — they can be written off in
 * the same step, through the SAME path a death on the daily round takes
 * (MortalityRecord + BiologicalAssetService.postMortality), so their carrying
 * value and their share of rearing cost leave the books the way any loss
 * does, not by quietly zeroing a number. Closing never deletes anything: a
 * closed batch is where a finished cycle's profit is read.
 */
@Injectable()
export class BatchCloseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly biologicalAssets: BiologicalAssetService,
    private readonly audit: AuditService,
  ) {}

  async close(params: {
    companyId: string;
    /** The batch's code — how the farm and the web app name it. */
    groupCode: string;
    closedOn: Date;
    reason: string;
    writeOffRemaining: boolean;
    actor: WorkflowActor;
  }): Promise<{ code: string; writtenOff: number; lossPosted: boolean; note?: string }> {
    const reason = params.reason.trim();
    if (!reason) throw new BadRequestException('Say why the batch is closing.');

    const group = await this.prisma.livestockGroup.findFirst({
      where: { code: params.groupCode, companyId: params.companyId },
    });
    if (!group) throw new NotFoundException('No such batch in this company.');
    if (group.status === 'CLOSED') throw new BadRequestException(`${group.code} is already closed.`);
    if (params.closedOn < group.startedOn) {
      throw new BadRequestException(`${group.code} started on ${day(group.startedOn)}; it cannot close before that.`);
    }

    const remaining = group.population;
    if (remaining > 0 && !params.writeOffRemaining) {
      throw new AccountingRuleViolation(
        'Batch close — population',
        `${group.code} still has ${remaining} animal${remaining === 1 ? '' : 's'} recorded. Record their sale, harvest or ` +
          `deaths first, or close with "write off what is left".`,
        { groupId: group.id, population: remaining },
      );
    }

    let mortalityId: string | null = null;
    if (remaining > 0) {
      // The write-off is a death record like any other, on the closing day.
      mortalityId = await this.prisma.$transaction(async (tx) => {
        const round =
          (await tx.dailyRecord.findUnique({ where: { groupId_recordedOn: { groupId: group.id, recordedOn: params.closedOn } } })) ??
          (await tx.dailyRecord.create({
            data: {
              companyId: group.companyId,
              groupId: group.id,
              recordedOn: params.closedOn,
              recordedById: params.actor.userId,
              notes: `Batch closed: ${reason}`,
            },
          }));
        const mortality = await tx.mortalityRecord.create({
          data: {
            dailyRecordId: round.id,
            quantity: remaining,
            causes: ['Written off when the batch was closed'],
            // Not the ordinary course of a cycle: a count that did not
            // reconcile, or a batch that should not have been there.
            classification: 'ABNORMAL',
            notes: reason,
          },
        });
        await tx.livestockGroup.update({ where: { id: group.id }, data: { population: { decrement: remaining } } });
        return mortality.id;
      });
    }

    // Posted after the write-off committed, exactly as a round's deaths are.
    const outcome = mortalityId
      ? await this.biologicalAssets.postMortality({ mortalityRecordId: mortalityId, actor: params.actor })
      : { posted: false };

    await this.prisma.livestockGroup.update({
      where: { id: group.id },
      data: { status: 'CLOSED', closedOn: params.closedOn },
    });
    await this.audit.write({
      transactionId: group.id,
      module: 'operations',
      entityType: 'LivestockGroup',
      entityId: group.id,
      status: 'CLOSED',
      action: AuditAction.UPDATE,
      userId: params.actor.userId,
      comments: reason,
      newValue: { closedOn: day(params.closedOn), writtenOff: remaining, lossPosted: outcome.posted },
    });

    return {
      code: group.code,
      writtenOff: remaining,
      lossPosted: outcome.posted,
      ...('reason' in outcome && outcome.reason && remaining > 0 ? { note: outcome.reason } : {}),
    };
  }
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}
