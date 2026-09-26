import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AuditAction, FeedQualityDisposition, Prisma, ProductionOrderCycle, ProductionOrderStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkflowActor } from '../workflow/workflow.types';
import { allowsSelfApproval } from '../workflow/self-approval';

/** Who may set a quality spec, or release or reject a tested batch. */
export const QUALITY_ROLES = ['QA_OFFICER', 'PRODUCTION_LEAD', 'FARM_MANAGER', 'FINANCE_CONTROLLER', 'CFO'];

type Percent = Decimal.Value | null | undefined;

/**
 * Feed quality plan (handbook §26 "Quality plan … Quarantine until release",
 * FR-FM-02). A spec sets the limits a finished feed must meet; each feed order
 * has its output sampled and tested against it, and someone other than the
 * tester releases it. Until then the batch cannot be received into finished
 * feed stock (ProductionOrderService.recordOutputs checks), so nothing
 * untested can be issued to a flock. A failed or rejected batch goes out as
 * abnormal loss or rework, not into stock.
 */
@Injectable()
export class FeedQualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async specs(companyId: string) {
    const specs = await this.prisma.feedQualitySpec.findMany({ where: { companyId } });
    const items = await this.prisma.item.findMany({
      where: { companyId, id: { in: specs.map((s) => s.itemId) } },
      select: { id: true, code: true, description: true },
    });
    return specs.map((s) => {
      const item = items.find((i) => i.id === s.itemId);
      return {
        id: s.id,
        itemId: s.itemId,
        itemCode: item?.code ?? '',
        description: item?.description ?? '',
        minProteinPercent: s.minProteinPercent?.toString() ?? null,
        maxMoisturePercent: s.maxMoisturePercent?.toString() ?? null,
        maxAflatoxinPpb: s.maxAflatoxinPpb?.toString() ?? null,
        samplingNote: s.samplingNote,
        updatedAt: s.updatedAt,
      };
    });
  }

  async setSpec(params: {
    companyId: string;
    itemId: string;
    minProteinPercent?: Percent;
    maxMoisturePercent?: Percent;
    maxAflatoxinPpb?: Percent;
    samplingNote?: string | null;
    actor: WorkflowActor;
  }) {
    if (!params.actor.roles.some((r) => QUALITY_ROLES.includes(r))) {
      throw new ForbiddenException('Quality limits are set by QA, the production lead, the farm manager or finance control.');
    }
    const item = await this.prisma.item.findFirst({ where: { id: params.itemId, companyId: params.companyId }, select: { id: true, code: true } });
    if (!item) throw new NotFoundException('No such item.');
    const values = {
      minProteinPercent: dec(params.minProteinPercent, 'Minimum protein'),
      maxMoisturePercent: dec(params.maxMoisturePercent, 'Maximum moisture'),
      maxAflatoxinPpb: dec(params.maxAflatoxinPpb, 'Maximum aflatoxin'),
    };
    if (!values.minProteinPercent && !values.maxMoisturePercent && !values.maxAflatoxinPpb) {
      throw new BadRequestException('Set at least one limit — protein, moisture or aflatoxin.');
    }
    const before = await this.prisma.feedQualitySpec.findFirst({ where: { companyId: params.companyId, itemId: item.id } });
    const spec = await this.prisma.feedQualitySpec.upsert({
      where: { companyId_itemId: { companyId: params.companyId, itemId: item.id } },
      create: { companyId: params.companyId, itemId: item.id, ...values, samplingNote: params.samplingNote?.trim() || null, setById: params.actor.userId },
      update: { ...values, samplingNote: params.samplingNote?.trim() || null, setById: params.actor.userId },
    });
    await this.audit.write({
      transactionId: spec.id,
      module: 'production',
      entityType: 'FeedQualitySpec',
      entityId: spec.id,
      status: 'ACTIVE',
      action: before ? AuditAction.UPDATE : AuditAction.CREATE,
      userId: params.actor.userId,
      oldValue: before ? plain(before) : undefined,
      newValue: plain(spec),
      comments: `Quality limits for ${item.code}.`,
    });
    return { id: spec.id };
  }

  /** A feed order's tests, newest first, with the spec each output item must meet. */
  async testsFor(companyId: string, productionOrderId: string) {
    const order = await this.prisma.productionOrder.findFirst({
      where: { id: productionOrderId, companyId },
      select: { id: true, recipeVersion: { select: { recipe: { select: { outputItemId: true } } } } },
    });
    if (!order) throw new NotFoundException('No such production order.');
    const tests = await this.prisma.feedQualityTest.findMany({ where: { companyId, productionOrderId: order.id }, orderBy: { createdAt: 'desc' } });
    const spec = await this.prisma.feedQualitySpec.findFirst({ where: { companyId, itemId: order.recipeVersion.recipe.outputItemId } });
    return {
      spec: spec ? plain(spec) : null,
      tests: tests.map((t) => ({
        id: t.id,
        itemId: t.itemId,
        sampledOn: t.sampledOn.toISOString().slice(0, 10),
        proteinPercent: t.proteinPercent?.toString() ?? null,
        moisturePercent: t.moisturePercent?.toString() ?? null,
        aflatoxinPpb: t.aflatoxinPpb?.toString() ?? null,
        contaminationNote: t.contaminationNote,
        passed: t.passed,
        failures: t.failures,
        disposition: t.disposition,
        testedById: t.testedById,
        decidedById: t.decidedById,
        decisionNote: t.decisionNote,
      })),
    };
  }

  /** Record a sample's results; pass or fail is worked out against the item's spec. */
  async recordTest(params: {
    companyId: string;
    productionOrderId: string;
    sampledOn: Date;
    proteinPercent?: Percent;
    moisturePercent?: Percent;
    aflatoxinPpb?: Percent;
    contaminationNote?: string | null;
    actor: WorkflowActor;
  }) {
    const order = await this.prisma.productionOrder.findFirst({
      where: { id: params.productionOrderId, companyId: params.companyId },
      select: { id: true, orderNumber: true, status: true, processingCycle: true, recipeVersion: { select: { recipe: { select: { outputItemId: true } } } } },
    });
    if (!order) throw new NotFoundException('No such production order.');
    if (order.processingCycle !== ProductionOrderCycle.FEED_MILL) throw new BadRequestException('Quality tests here are for feed mill orders.');
    if (order.status !== ProductionOrderStatus.IN_PRODUCTION) {
      throw new BadRequestException(`${order.orderNumber} is ${order.status}; a batch is tested once it is milled and before it is received.`);
    }
    const itemId = order.recipeVersion.recipe.outputItemId;
    const spec = await this.prisma.feedQualitySpec.findFirst({ where: { companyId: params.companyId, itemId } });
    if (!spec) throw new BadRequestException('This feed has no quality spec; set its limits first.');

    const protein = dec(params.proteinPercent, 'Protein');
    const moisture = dec(params.moisturePercent, 'Moisture');
    const aflatoxin = dec(params.aflatoxinPpb, 'Aflatoxin');
    const failures: string[] = [];
    if (spec.minProteinPercent) {
      if (!protein) failures.push('Protein not tested.');
      else if (protein.lt(spec.minProteinPercent)) failures.push(`Protein ${protein}% is below ${spec.minProteinPercent}%.`);
    }
    if (spec.maxMoisturePercent) {
      if (!moisture) failures.push('Moisture not tested.');
      else if (moisture.gt(spec.maxMoisturePercent)) failures.push(`Moisture ${moisture}% is above ${spec.maxMoisturePercent}%.`);
    }
    if (spec.maxAflatoxinPpb) {
      if (!aflatoxin) failures.push('Aflatoxin not tested.');
      else if (aflatoxin.gt(spec.maxAflatoxinPpb)) failures.push(`Aflatoxin ${aflatoxin} ppb is above ${spec.maxAflatoxinPpb} ppb.`);
    }
    if (params.contaminationNote?.trim()) failures.push(`Contamination: ${params.contaminationNote.trim()}`);

    const test = await this.prisma.feedQualityTest.create({
      data: {
        companyId: params.companyId,
        productionOrderId: order.id,
        itemId,
        sampledOn: params.sampledOn,
        proteinPercent: protein,
        moisturePercent: moisture,
        aflatoxinPpb: aflatoxin,
        contaminationNote: params.contaminationNote?.trim() || null,
        passed: failures.length === 0,
        failures,
        testedById: params.actor.userId,
      },
    });
    await this.audit.write({
      transactionId: order.id,
      module: 'production',
      entityType: 'FeedQualityTest',
      entityId: test.id,
      status: test.disposition,
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      newValue: plain(test),
      comments: `${order.orderNumber} sample ${test.passed ? 'passed' : `failed: ${failures.join(' ')}`}`,
    });
    return { id: test.id, passed: test.passed, failures };
  }

  /**
   * Release or reject a tested batch. Someone other than the tester decides;
   * a failed sample can only be rejected.
   */
  async decide(params: { companyId: string; testId: string; decision: 'RELEASE' | 'REJECT'; note?: string | null; actor: WorkflowActor }) {
    if (!params.actor.roles.some((r) => QUALITY_ROLES.includes(r))) {
      throw new ForbiddenException('A batch is released or rejected by QA, the production lead, the farm manager or finance control.');
    }
    const test = await this.prisma.feedQualityTest.findFirst({ where: { id: params.testId, companyId: params.companyId } });
    if (!test) throw new NotFoundException('No such quality test.');
    if (test.disposition !== FeedQualityDisposition.PENDING) throw new BadRequestException(`That test was already ${test.disposition.toLowerCase()}.`);
    if (test.testedById === params.actor.userId && !(await allowsSelfApproval(this.prisma, params.companyId))) {
      throw new ForbiddenException('Someone other than the tester releases or rejects the batch.');
    }
    if (params.decision === 'RELEASE' && !test.passed) {
      throw new BadRequestException(`This sample failed (${test.failures.join(' ')}); it can only be rejected.`);
    }
    if (params.decision === 'REJECT' && !params.note?.trim()) throw new BadRequestException('Say why the batch is rejected.');
    const disposition = params.decision === 'RELEASE' ? FeedQualityDisposition.RELEASED : FeedQualityDisposition.REJECTED;
    await this.prisma.feedQualityTest.update({
      where: { id: test.id },
      data: { disposition, decidedById: params.actor.userId, decidedAt: new Date(), decisionNote: params.note?.trim() || null },
    });
    await this.audit.write({
      transactionId: test.productionOrderId,
      module: 'production',
      entityType: 'FeedQualityTest',
      entityId: test.id,
      status: disposition,
      action: params.decision === 'RELEASE' ? AuditAction.APPROVE : AuditAction.REJECT,
      userId: params.actor.userId,
      comments: params.note?.trim() || undefined,
    });
    return { id: test.id, disposition };
  }
}

function dec(value: Percent, label: string): Prisma.Decimal | null {
  if (value === undefined || value === null || value === '') return null;
  const d = new Decimal(value);
  if (d.isNaN() || d.lt(0)) throw new BadRequestException(`${label} must be a number, zero or more.`);
  return new Prisma.Decimal(d.toFixed(2));
}

function plain<T extends object>(row: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v === null || v === undefined ? v : typeof v === 'object' ? v.toString() : v]));
}
