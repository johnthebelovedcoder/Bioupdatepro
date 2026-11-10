import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, ItemType, Prisma } from '@bioassetpro/database';
import { AuditService } from '../audit/audit.service';
import type { WorkflowActor } from '../workflow/workflow.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PostingGroupAssignmentService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  listGroups(params: { companyId: string; application?: string; masterType?: string }) {
    return this.prisma.approvedPostingGroup.findMany({
      where: {
        companyId: params.companyId,
        status: 'Active',
        ...(params.application ? { application: params.application } : {}),
        ...(params.masterType ? { masterType: params.masterType } : {}),
      },
      orderBy: [{ application: 'asc' }, { masterType: 'asc' }, { postingGroup: 'asc' }],
    });
  }

  listAssignments(params: { companyId: string; masterType?: string; masterId?: string }) {
    return this.prisma.postingGroupAssignment.findMany({
      where: {
        companyId: params.companyId,
        ...(params.masterType ? { masterType: params.masterType } : {}),
        ...(params.masterId ? { masterId: params.masterId } : {}),
      },
      include: { approvedPostingGroup: true, assignedBy: { select: { fullName: true } } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
  }

  async assign(params: {
    companyId: string;
    actor: WorkflowActor;
    application: string;
    postingGroup: string;
    masterType: string;
    masterId: string;
    effectiveFrom: Date;
    effectiveTo?: Date | null;
  }) {
    const masterId = params.masterId.trim();
    if (!masterId || masterId.length > 200) throw new BadRequestException('Select a master record for the posting group.');
    if (params.effectiveTo && params.effectiveTo < params.effectiveFrom) throw new BadRequestException('The end date must be on or after the start date.');

    return this.prisma.$transaction(async (tx) => {
      const group = await tx.approvedPostingGroup.findFirst({
        where: {
          companyId: params.companyId,
          application: params.application,
          postingGroup: params.postingGroup,
          masterType: params.masterType,
          status: 'Active',
          effectiveFrom: { lte: params.effectiveFrom },
        },
      });
      if (!group) throw new BadRequestException('That active workbook posting group does not match this application and master type.');
      await this.assertMasterExists(tx, params.companyId, params.masterType, masterId);

      const overlapping = await tx.postingGroupAssignment.findFirst({
        where: {
          companyId: params.companyId,
          masterType: params.masterType,
          masterId,
          status: 'Active',
          approvedPostingGroup: { application: params.application },
          effectiveFrom: { lte: params.effectiveTo ?? new Date('9999-12-31T00:00:00.000Z') },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: params.effectiveFrom } }],
        },
        include: { approvedPostingGroup: { select: { application: true, postingGroup: true } } },
      });
      if (overlapping) {
        throw new ConflictException(`This master already has ${overlapping.approvedPostingGroup.application} / ${overlapping.approvedPostingGroup.postingGroup} assigned during that date range. End the earlier assignment first.`);
      }

      const assignment = await tx.postingGroupAssignment.create({
        data: {
          companyId: params.companyId,
          approvedPostingGroupId: group.id,
          masterType: params.masterType,
          masterId,
          effectiveFrom: params.effectiveFrom,
          effectiveTo: params.effectiveTo ?? null,
          assignedById: params.actor.userId,
        },
        include: { approvedPostingGroup: true, assignedBy: { select: { fullName: true } } },
      });
      await this.audit.write({
        transactionId: assignment.id,
        module: 'posting-control',
        entityType: 'PostingGroupAssignment',
        entityId: assignment.id,
        status: assignment.status,
        action: AuditAction.CONFIG_CHANGE,
        userId: params.actor.userId,
        comments: `Assigned ${assignment.approvedPostingGroup.application} / ${assignment.approvedPostingGroup.postingGroup} to ${params.masterType} ${masterId}.`,
        newValue: { application: params.application, postingGroup: params.postingGroup, masterType: params.masterType, masterId, effectiveFrom: params.effectiveFrom.toISOString(), effectiveTo: params.effectiveTo?.toISOString() ?? null },
      }, tx);
      return assignment;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async end(params: { companyId: string; assignmentId: string; effectiveTo: Date; actor: WorkflowActor }) {
    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.postingGroupAssignment.findFirst({
        where: { id: params.assignmentId, companyId: params.companyId },
        include: { approvedPostingGroup: true },
      });
      if (!assignment) throw new NotFoundException('Posting group assignment not found in this company.');
      if (params.effectiveTo < assignment.effectiveFrom) throw new BadRequestException('The end date must be on or after the assignment start date.');
      const next = await tx.postingGroupAssignment.findFirst({
        where: {
          companyId: params.companyId,
          masterType: assignment.masterType,
          masterId: assignment.masterId,
          status: 'Active',
          approvedPostingGroup: { application: assignment.approvedPostingGroup.application },
          effectiveFrom: { gt: assignment.effectiveFrom },
        },
        orderBy: { effectiveFrom: 'asc' },
        select: { effectiveFrom: true },
      });
      if (next && params.effectiveTo >= next.effectiveFrom) throw new ConflictException('The end date would overlap a later assignment for this master.');
      const updated = await tx.postingGroupAssignment.update({
        where: { id: assignment.id },
        data: { effectiveTo: params.effectiveTo },
        include: { approvedPostingGroup: true },
      });
      await this.audit.write({
        transactionId: assignment.id,
        module: 'posting-control',
        entityType: 'PostingGroupAssignment',
        entityId: assignment.id,
        status: updated.status,
        action: AuditAction.CONFIG_CHANGE,
        userId: params.actor.userId,
        comments: `Ended ${assignment.approvedPostingGroup.application} / ${assignment.approvedPostingGroup.postingGroup} assignment on ${params.effectiveTo.toISOString().slice(0, 10)}.`,
        oldValue: { effectiveTo: assignment.effectiveTo?.toISOString() ?? null },
        newValue: { effectiveTo: params.effectiveTo.toISOString() },
      }, tx);
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async assertMasterExists(client: Prisma.TransactionClient, companyId: string, masterType: string, masterId: string): Promise<void> {
    const idOrKey = (id: string) => ({ OR: [{ id }, { code: id }] });
    let exists = false;
    switch (masterType) {
      case 'Item':
        exists = Boolean(await client.item.findFirst({ where: { companyId, ...idOrKey(masterId) }, select: { id: true } }));
        break;
      case 'Production order':
        exists = Boolean(await client.productionOrder.findFirst({ where: { companyId, id: masterId }, select: { id: true } }));
        break;
      case 'Lifecycle stage':
        exists = Boolean(await client.speciesBreedStage.findFirst({ where: { id: masterId, speciesBreed: { companyId } }, select: { id: true } }));
        break;
      case 'Vendor':
        exists = Boolean(await client.supplier.findFirst({ where: { companyId, ...idOrKey(masterId) }, select: { id: true } }));
        break;
      case 'Customer':
        exists = Boolean(await client.customer.findFirst({ where: { companyId, ...idOrKey(masterId) }, select: { id: true } }));
        break;
      case 'Tax code':
        exists = Boolean(await client.taxCode.findFirst({ where: { companyId, ...idOrKey(masterId) }, select: { id: true } }));
        break;
      case 'Tax settlement':
        exists = Boolean(await client.taxPeriod.findFirst({ where: { companyId, id: masterId }, select: { id: true } }));
        break;
      case 'Asset class':
        exists = Boolean(await client.fixedAsset.findFirst({ where: { companyId, assetClass: masterId }, select: { id: true } }));
        break;
      case 'Bank':
        exists = Boolean(await client.bankAccount.findFirst({ where: { companyId, id: masterId }, select: { id: true } }));
        break;
      case 'Sales class':
        exists = Boolean(await client.item.findFirst({ where: { companyId, category: masterId }, select: { id: true } }));
        break;
      case 'Service category':
      case 'Service line':
        exists = Boolean(await client.item.findFirst({ where: { companyId, itemType: ItemType.SERVICE, category: masterId }, select: { id: true } }));
        break;
      case 'Work centre':
        exists = Boolean(await client.routingOperation.findFirst({ where: { companyId, OR: [{ id: masterId }, { operationName: masterId }] }, select: { id: true } }))
          || Boolean(await client.costCentre.findFirst({ where: { companyId, ...idOrKey(masterId) }, select: { id: true } }));
        break;
      case 'Payroll group':
        exists = Boolean(await client.employee.findFirst({ where: { companyId, id: masterId }, select: { id: true } }));
        break;
      case 'Finance setup':
        exists = masterId === companyId;
        break;
      default:
        throw new BadRequestException(`Unsupported workbook master type: ${masterType}.`);
    }
    if (!exists) throw new NotFoundException(`${masterType} ${masterId} was not found in this company.`);
  }
}
