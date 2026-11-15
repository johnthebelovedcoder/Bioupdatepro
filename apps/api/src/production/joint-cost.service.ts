import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@bioassetpro/database';
import Decimal from 'decimal.js';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { AccountingRuleViolation } from '../common/errors';
import type { CostAllocationMethod } from './cost-allocation.service';

export const JOINT_COST_METHODS: CostAllocationMethod[] = ['SALES_VALUE', 'NRV', 'WEIGHT', 'STANDARD_PERCENTAGE', 'MANUAL'];

/** Who may approve a joint-cost price: those who answer for costing. */
const PRICE_APPROVERS = ['FINANCE_CONTROLLER', 'FINANCE_MANAGER', 'CFO', 'ADMINISTRATOR'];

/**
 * Joint-cost controls (JOINT_COST_ALLOCATION, handbook §62).
 *
 * One released method for every processing order — NRV at split-off unless
 * the CFO releases another — and the selling prices and further-processing
 * costs NRV reads come from approved, effective-dated prices, never from the
 * order being costed.
 */
@Injectable()
export class JointCostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async releasedMethod(companyId: string): Promise<CostAllocationMethod> {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { jointCostMethod: true } });
    if (!JOINT_COST_METHODS.includes(company.jointCostMethod as CostAllocationMethod)) {
      throw new AccountingRuleViolation(
        'JOINT_COST_ALLOCATION — supported released method',
        `The stored method ${company.jointCostMethod} is not supported. Finance must release a supported joint-cost method before processing outputs.`,
        { method: company.jointCostMethod },
      );
    }
    return company.jointCostMethod as CostAllocationMethod;
  }

  async releaseMethod(params: { companyId: string; method: string; actor: WorkflowActor }) {
    if (!JOINT_COST_METHODS.includes(params.method as CostAllocationMethod)) {
      throw new BadRequestException(`"${params.method}" is not a joint-cost method. Use one of ${JOINT_COST_METHODS.join(', ')}.`);
    }
    const before = await this.releasedMethod(params.companyId);
    await this.prisma.company.update({ where: { id: params.companyId }, data: { jointCostMethod: params.method } });
    await this.audit.write({
      transactionId: params.companyId,
      module: 'production',
      entityType: 'Company',
      entityId: params.companyId,
      status: 'ACTIVE',
      action: AuditAction.CONFIG_CHANGE,
      userId: params.actor.userId,
      comments: `Released joint-cost method changed from ${before} to ${params.method}.`,
      oldValue: { jointCostMethod: before },
      newValue: { jointCostMethod: params.method },
    });
    return { method: params.method };
  }

  async listPrices(companyId: string) {
    const rows = await this.prisma.jointOutputPrice.findMany({
      where: { companyId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: {
        item: { select: { code: true, description: true } },
        proposedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      itemId: r.itemId,
      itemCode: r.item.code,
      itemDescription: r.item.description,
      sellingPricePerUnitKobo: r.sellingPricePerUnitKobo.toString(),
      furtherCostPerUnitKobo: r.furtherCostPerUnitKobo.toString(),
      effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
      evidenceReference: r.evidenceReference,
      status: r.status,
      proposedBy: r.proposedBy.fullName,
      approvedBy: r.approvedBy?.fullName ?? null,
      rejectionReason: r.rejectionReason,
    }));
  }

  async listStandardAllocations(companyId: string) {
    const rows = await this.prisma.jointOutputStandardAllocation.findMany({
      where: { companyId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      include: {
        item: { select: { code: true, description: true } },
        proposedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      itemCode: row.item.code,
      itemDescription: row.item.description,
      allocationPercentage: row.allocationPercentage.toString(),
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      evidenceReference: row.evidenceReference,
      status: row.status,
      proposedBy: row.proposedBy.fullName,
      approvedBy: row.approvedBy?.fullName ?? null,
      rejectionReason: row.rejectionReason,
    }));
  }

  async proposeStandardAllocation(params: {
    companyId: string;
    itemId: string;
    allocationPercentage: string;
    effectiveFrom: Date;
    evidenceReference: string;
    actor: WorkflowActor;
  }) {
    const item = await this.prisma.item.findFirst({ where: { id: params.itemId, companyId: params.companyId, active: true } });
    if (!item) throw new NotFoundException('No active item with that output code.');
    const percentage = new Decimal(params.allocationPercentage);
    if (!percentage.isFinite() || percentage.isNegative() || percentage.greaterThan(100) || percentage.decimalPlaces() > 4) {
      throw new BadRequestException('Allocation percentage must be from 0 to 100 with at most four decimal places.');
    }
    if (!params.evidenceReference?.trim()) throw new BadRequestException('Name the evidence or approved basis for this standard allocation.');
    const allocation = await this.prisma.jointOutputStandardAllocation.create({
      data: {
        companyId: params.companyId,
        itemId: item.id,
        allocationPercentage: percentage.toFixed(4),
        effectiveFrom: params.effectiveFrom,
        evidenceReference: params.evidenceReference.trim(),
        proposedById: params.actor.userId,
      },
    });
    await this.audit.write({
      transactionId: allocation.id,
      module: 'production',
      entityType: 'JointOutputStandardAllocation',
      entityId: allocation.id,
      status: 'PENDING',
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      comments: `Proposed ${percentage.toFixed(4)}% for ${item.code} from ${params.effectiveFrom.toISOString().slice(0, 10)}.`,
    });
    return allocation;
  }

  async decideStandardAllocation(params: {
    companyId: string;
    allocationId: string;
    approve: boolean;
    reason?: string;
    actor: WorkflowActor;
  }) {
    if (!params.actor.roles.some((role) => PRICE_APPROVERS.includes(role))) {
      throw new ForbiddenException('Only the finance controller, finance manager or CFO approves standard joint-cost allocations.');
    }
    const allocation = await this.prisma.jointOutputStandardAllocation.findFirst({
      where: { id: params.allocationId, companyId: params.companyId },
    });
    if (!allocation) throw new NotFoundException('No such standard allocation.');
    if (allocation.status !== 'PENDING') throw new BadRequestException(`That allocation was already ${allocation.status.toLowerCase()}.`);
    if (params.approve && allocation.proposedById === params.actor.userId) {
      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { allowSelfApproval: true } });
      if (!company.allowSelfApproval) throw new ForbiddenException('You proposed this allocation, so someone else must approve it.');
    }
    if (!params.approve && !params.reason?.trim()) throw new BadRequestException('Say why the allocation is rejected.');
    const decided = await this.prisma.jointOutputStandardAllocation.update({
      where: { id: allocation.id },
      data: params.approve
        ? { status: 'APPROVED', approvedById: params.actor.userId, approvedAt: new Date() }
        : { status: 'REJECTED', approvedById: params.actor.userId, approvedAt: new Date(), rejectionReason: params.reason!.trim() },
    });
    await this.audit.write({
      transactionId: allocation.id,
      module: 'production',
      entityType: 'JointOutputStandardAllocation',
      entityId: allocation.id,
      status: decided.status,
      action: params.approve ? AuditAction.APPROVE : AuditAction.REJECT,
      userId: params.actor.userId,
      comments: params.approve ? 'Approved.' : params.reason!.trim(),
    });
    return decided;
  }

  async proposePrice(params: {
    companyId: string;
    itemId: string;
    sellingPricePerUnitKobo: bigint;
    furtherCostPerUnitKobo: bigint;
    effectiveFrom: Date;
    evidenceReference: string;
    actor: WorkflowActor;
  }) {
    const item = await this.prisma.item.findFirst({ where: { id: params.itemId, companyId: params.companyId } });
    if (!item) throw new NotFoundException('No such item.');
    if (params.sellingPricePerUnitKobo <= 0n) throw new BadRequestException('A selling price is required.');
    if (params.furtherCostPerUnitKobo < 0n || params.furtherCostPerUnitKobo >= params.sellingPricePerUnitKobo) {
      throw new BadRequestException('Further-processing and selling cost must be zero or more and less than the selling price.');
    }
    if (!params.evidenceReference?.trim()) throw new BadRequestException('Name the evidence for this price — a price list, quotation or recent sale.');
    const price = await this.prisma.jointOutputPrice.create({
      data: {
        companyId: params.companyId,
        itemId: item.id,
        sellingPricePerUnitKobo: params.sellingPricePerUnitKobo,
        furtherCostPerUnitKobo: params.furtherCostPerUnitKobo,
        effectiveFrom: params.effectiveFrom,
        evidenceReference: params.evidenceReference.trim(),
        proposedById: params.actor.userId,
      },
    });
    await this.audit.write({
      transactionId: price.id,
      module: 'production',
      entityType: 'JointOutputPrice',
      entityId: price.id,
      status: 'PENDING',
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      comments: `Proposed ${item.code} at ${params.sellingPricePerUnitKobo} kobo less ${params.furtherCostPerUnitKobo} from ${params.effectiveFrom.toISOString().slice(0, 10)}.`,
    });
    return price;
  }

  async decide(params: { companyId: string; priceId: string; approve: boolean; reason?: string; actor: WorkflowActor }) {
    if (!params.actor.roles.some((role) => PRICE_APPROVERS.includes(role))) {
      throw new ForbiddenException('Only the finance controller, finance manager or CFO approves joint-cost prices.');
    }
    const price = await this.prisma.jointOutputPrice.findFirst({ where: { id: params.priceId, companyId: params.companyId } });
    if (!price) throw new NotFoundException('No such price.');
    if (price.status !== 'PENDING') throw new BadRequestException(`That price was already ${price.status.toLowerCase()}.`);
    if (params.approve && price.proposedById === params.actor.userId) {
      const company = await this.prisma.company.findUniqueOrThrow({ where: { id: params.companyId }, select: { allowSelfApproval: true } });
      if (!company.allowSelfApproval) throw new ForbiddenException('You proposed this price, so someone else must approve it.');
    }
    if (!params.approve && !params.reason?.trim()) throw new BadRequestException('Say why the price is rejected.');
    const decided = await this.prisma.jointOutputPrice.update({
      where: { id: price.id },
      data: params.approve
        ? { status: 'APPROVED', approvedById: params.actor.userId, approvedAt: new Date() }
        : { status: 'REJECTED', approvedById: params.actor.userId, approvedAt: new Date(), rejectionReason: params.reason!.trim() },
    });
    await this.audit.write({
      transactionId: price.id,
      module: 'production',
      entityType: 'JointOutputPrice',
      entityId: price.id,
      status: decided.status,
      action: params.approve ? AuditAction.APPROVE : AuditAction.REJECT,
      userId: params.actor.userId,
      comments: params.approve ? 'Approved.' : params.reason!.trim(),
    });
    return decided;
  }

  /**
   * The approved price of each item effective on `on` — the latest approved
   * price from on or before that day. Refuses, naming them, when any is missing.
   */
  async pricesOn(companyId: string, itemIds: string[], on: Date) {
    const prices = await this.prisma.jointOutputPrice.findMany({
      where: { companyId, itemId: { in: itemIds }, status: 'APPROVED', effectiveFrom: { lte: on } },
      orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }],
      include: { item: { select: { code: true } } },
    });
    const byItem = new Map<string, (typeof prices)[number]>();
    for (const p of prices) if (!byItem.has(p.itemId)) byItem.set(p.itemId, p);
    const missing = itemIds.filter((id) => !byItem.has(id));
    if (missing.length > 0) {
      const items = await this.prisma.item.findMany({ where: { companyId, id: { in: missing } }, select: { code: true } });
      throw new AccountingRuleViolation(
        'Handbook §62.5 — Joint-cost prices',
        `No approved selling price for ${items.map((i) => i.code).join(', ')} on ${on.toISOString().slice(0, 10)}. ` +
          'Propose one under Production → Joint-cost prices and have it approved.',
        { missing: items.map((i) => i.code) },
      );
    }
    return byItem;
  }

  async standardAllocationsOn(companyId: string, itemIds: string[], on: Date) {
    const rows = await this.prisma.jointOutputStandardAllocation.findMany({
      where: { companyId, itemId: { in: itemIds }, status: 'APPROVED', effectiveFrom: { lte: on } },
      orderBy: [{ effectiveFrom: 'desc' }, { approvedAt: 'desc' }],
      include: { item: { select: { code: true } } },
    });
    const byItem = new Map<string, (typeof rows)[number]>();
    for (const row of rows) if (!byItem.has(row.itemId)) byItem.set(row.itemId, row);
    const missing = itemIds.filter((id) => !byItem.has(id));
    if (missing.length) {
      const items = await this.prisma.item.findMany({ where: { companyId, id: { in: missing } }, select: { code: true } });
      throw new AccountingRuleViolation(
        'JOINT_COST_ALLOCATION — approved standard percentages',
        `No approved standard percentage is effective for ${items.map((item) => item.code).join(', ')} on ${on.toISOString().slice(0, 10)}.`,
        { missing: items.map((item) => item.code) },
      );
    }
    const total = [...byItem.values()].reduce(
      (sum, row) => sum.plus(row.allocationPercentage.toString()),
      new Decimal(0),
    );
    if (!total.equals(100)) {
      throw new AccountingRuleViolation(
        'JOINT_COST_ALLOCATION — approved standard percentages',
        `The effective approved standard percentages for this order total ${total.toString()}%, not 100%. Update and approve the effective-dated percentages before completing the order.`,
        { itemIds, totalPercentage: total.toString(), on: on.toISOString().slice(0, 10) },
      );
    }
    return new Map([...byItem].map(([itemId, row]) => [itemId, row.allocationPercentage.toString()]));
  }
}
