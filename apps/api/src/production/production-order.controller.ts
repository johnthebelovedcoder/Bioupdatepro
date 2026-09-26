import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductionOrderService } from './production-order.service';
import { JointCostService } from './joint-cost.service';
import { StandardCostService } from './standard-cost.service';
import { VarianceProrationService } from './variance-proration.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { AnyRole, Roles } from '../auth/roles.guard';
import { OwnedRecord } from '../auth/owned-record.guard';
import type { WorkflowActor } from '../workflow/workflow.types';
import type { AllocationOutput, CostAllocationMethod } from './cost-allocation.service';

/**
 * Production orders over HTTP — SnailPro, PoultryPro and Feed Mill
 * processing (US-897-016 through 020). API-only this pass, following the
 * same build order P2P and O2C already used: the domain engine first, a
 * screen in a later pass.
 */
@Controller('production-orders')
export class ProductionOrderController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: ProductionOrderService,
    private readonly joint: JointCostService,
    private readonly standards: StandardCostService,
    private readonly prorations: VarianceProrationService,
  ) {}

  // --- POL-009 variance proration -------------------------------------------

  @AnyRole('Where a year’s variance went is part of the costing record.')
  @Get('standard-costs/variance-prorations')
  async listProrations(@CurrentCompany() companyId: string) {
    return this.prorations.list(companyId);
  }

  @AnyRole('What proration would do is part of the costing record.')
  @Get('standard-costs/variance-proration')
  async previewProration(@CurrentCompany() companyId: string, @Query('financialYearId') financialYearId: string) {
    if (!financialYearId) throw new BadRequestException('financialYearId is required.');
    return this.prorations.preview(companyId, financialYearId);
  }

  @Roles('FINANCE_CONTROLLER', 'CFO')
  @Post('standard-costs/variance-proration')
  async prorate(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Body() body: { financialYearId: string }) {
    return this.prorations.prorate({ companyId, financialYearId: String(body?.financialYearId ?? ''), actor });
  }

  @Roles('FINANCE_CONTROLLER', 'CFO')
  @Post('standard-costs/variance-prorations/:id/reverse')
  async reverseProration(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Param('id') id: string) {
    return this.prorations.reverse({ companyId, prorationId: id, actor });
  }

  /**
   * Harvests with no processing order against them yet — what a "raise an
   * order" screen picks from. `createFromHarvest()` refuses a harvest that
   * already has one (a second order would double-count the WIP debit), so
   * offering an already-linked harvest here would just be a guaranteed
   * rejection on submit.
   */
  @Roles('PRODUCTION_LEAD', 'FARM_MANAGER', 'FARM_ACCOUNTANT')
  @Get('available-harvests')
  async availableHarvests(@CurrentCompany() companyId: string) {
    const rows = await this.prisma.harvestRecord.findMany({
      where: { companyId, productionOrder: null },
      orderBy: { harvestedOn: 'desc' },
      include: { group: { select: { code: true, speciesKey: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      date: row.harvestedOn.toISOString().slice(0, 10),
      groupCode: row.group.code,
      speciesKey: row.group.speciesKey,
      count: row.count,
      weightKg: row.weightKg.toString(),
      grade: row.grade,
    }));
  }

  @AnyRole('Every processing order and where it stands.')
  @Get()
  async list(@CurrentCompany() companyId: string) {
    return this.prisma.productionOrder.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        components: true,
        outputs: true,
        lossEvents: true,
        recipeVersion: { include: { recipe: { include: { outputItem: true } } } },
      },
    });
  }

  /* --- Joint-cost controls (handbook §62) --------------------------------- */

  @AnyRole('The joint-cost method and prices are how an order will be costed; everyone costing one needs them.')
  @Get('joint-cost')
  async jointCost(@CurrentCompany() companyId: string) {
    return { method: await this.joint.releasedMethod(companyId), prices: await this.joint.listPrices(companyId) };
  }

  @Roles('CFO')
  @Post('joint-cost/method')
  async releaseJointCostMethod(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor, @Body() body: { method: string }) {
    return this.joint.releaseMethod({ companyId, method: String(body?.method ?? ''), actor });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('joint-cost/prices')
  async proposeJointPrice(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { itemId: string; sellingPricePerUnitKobo: string; furtherCostPerUnitKobo?: string; effectiveFrom: string; evidenceReference: string },
  ) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(body?.effectiveFrom ?? '')) throw new BadRequestException('effectiveFrom must be a date, YYYY-MM-DD.');
    if (!/^[0-9]+$/.test(body?.sellingPricePerUnitKobo ?? '') || (body.furtherCostPerUnitKobo && !/^[0-9]+$/.test(body.furtherCostPerUnitKobo))) {
      throw new BadRequestException('Prices are whole kobo.');
    }
    const price = await this.joint.proposePrice({
      companyId,
      itemId: body.itemId,
      sellingPricePerUnitKobo: BigInt(body.sellingPricePerUnitKobo),
      furtherCostPerUnitKobo: BigInt(body.furtherCostPerUnitKobo ?? '0'),
      effectiveFrom: new Date(`${body.effectiveFrom}T00:00:00.000Z`),
      evidenceReference: String(body.evidenceReference ?? ''),
      actor,
    });
    return { id: price.id, status: price.status };
  }

  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('joint-cost/prices/:priceId/decide')
  async decideJointPrice(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('priceId') priceId: string,
    @Body() body: { approve: boolean; reason?: string },
  ) {
    const decided = await this.joint.decide({ companyId, priceId, approve: body?.approve === true, reason: body?.reason, actor });
    return { id: decided.id, status: decided.status };
  }

  // --- Standard costing (POL-001, SOP-049/050) ------------------------------

  @AnyRole('The costing policy and released standards are what every production posting is valued at.')
  @Get('standard-costs')
  async standardCosts(@CurrentCompany() companyId: string) {
    const [policies, versions, recipes] = await Promise.all([
      this.standards.policies(companyId),
      this.standards.list(companyId),
      this.prisma.productRecipeVersion.findMany({
        where: { recipe: { companyId }, status: { not: 'DRAFT' } },
        select: { id: true, version: true, status: true, batchSize: true, recipe: { select: { code: true, name: true } } },
        orderBy: [{ recipe: { code: 'asc' } }, { version: 'desc' }],
      }),
    ]);
    return {
      policies,
      versions,
      recipeVersions: recipes.map((r) => ({
        id: r.id,
        label: `${r.recipe.code} v${r.version} — ${r.recipe.name}`,
        status: r.status,
        batchSize: r.batchSize.toString(),
      })),
    };
  }

  @Roles('CFO', 'FINANCE_CONTROLLER')
  @Post('standard-costs/policy')
  async configureCostingPolicy(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      financialYearId: string;
      varianceTolerancePercent?: string | number;
      varianceDisposition?: 'COGS' | 'PRORATE';
      prorationThresholdKobo?: string;
    },
  ) {
    if (body?.prorationThresholdKobo !== undefined && !/^[0-9]+$/.test(String(body.prorationThresholdKobo))) {
      throw new BadRequestException('prorationThresholdKobo is a whole number of kobo.');
    }
    const policy = await this.standards.configurePolicy({
      companyId,
      financialYearId: String(body?.financialYearId ?? ''),
      varianceTolerancePercent: body?.varianceTolerancePercent,
      varianceDisposition: body?.varianceDisposition,
      prorationThresholdKobo: body?.prorationThresholdKobo !== undefined ? BigInt(body.prorationThresholdKobo) : undefined,
      actor,
    });
    return { id: policy.id };
  }

  @Roles('FARM_ACCOUNTANT', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('standard-costs/roll-up')
  async previewStandard(@CurrentCompany() companyId: string, @Body() body: { recipeVersionId: string; on?: string }) {
    const rolled = await this.standards.rollUp(companyId, String(body?.recipeVersionId ?? ''), body?.on ? new Date(body.on) : new Date());
    return {
      ...rolled,
      materialKobo: rolled.materialKobo.toString(),
      packagingKobo: rolled.packagingKobo.toString(),
      labourKobo: rolled.labourKobo.toString(),
      machineKobo: rolled.machineKobo.toString(),
      overheadKobo: rolled.overheadKobo.toString(),
      depreciationKobo: rolled.depreciationKobo.toString(),
      totalKobo: rolled.totalKobo.toString(),
      unitCostKobo: rolled.unitCostKobo.toString(),
    };
  }

  @Roles('FARM_ACCOUNTANT', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('standard-costs')
  async prepareStandard(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { recipeVersionId: string; effectiveFrom: string },
  ) {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(body?.effectiveFrom ?? '')) throw new BadRequestException('effectiveFrom must be a date, YYYY-MM-DD.');
    const version = await this.standards.prepare({ companyId, recipeVersionId: String(body.recipeVersionId ?? ''), effectiveFrom: new Date(body.effectiveFrom), actor });
    return { id: version.id, versionNumber: version.versionNumber, unitCostKobo: version.unitCostKobo.toString() };
  }

  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('standard-costs/:versionId/decide')
  async decideStandard(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Param('versionId') versionId: string,
    @Body() body: { approve: boolean; reason?: string },
  ) {
    const decided = await this.standards.decide({ companyId, versionId, approve: body?.approve === true, reason: body?.reason, actor });
    return { id: decided.id, status: decided.status };
  }

  @AnyRole('One processing order in full.')
  /*
   * Every route addressed by an order id checks that the order is this
   * company's. The service looks orders up by id alone, so without this any
   * production lead could read, issue against or settle another company's
   * order by naming its id.
   */
  @OwnedRecord('productionOrder', 'id')
  @Get(':id')
  async get(@Param('id') id: string) {
    await this.orders.syncOrderStatus(id);
    return this.prisma.productionOrder.findUniqueOrThrow({
      where: { id },
      include: {
        components: { include: { componentItem: { select: { code: true, description: true } } } },
        outputs: { include: { item: { select: { code: true, description: true } } } },
        lossEvents: true,
        recipeVersion: { include: { recipe: { include: { outputItem: true } } } },
        sourceGroup: { select: { code: true, speciesKey: true } },
        harvestRecord: { select: { harvestedOn: true, count: true, weightKg: true } },
      },
    });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_MANAGER', 'FARM_ACCOUNTANT')
  @Post()
  async create(
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      harvestRecordId: string;
      recipeVersionId: string;
      warehouseId: string;
      plannedOutputQuantity: string;
    },
  ) {
    // The number is the system's, never the caller's (Numbering_Parameters).
    return this.orders.createFromHarvest({ ...body, orderNumber: undefined, actor });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_MANAGER', 'FARM_ACCOUNTANT')
  @Post('feed')
  async createFeedOrder(
    @CurrentUser() actor: WorkflowActor,
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      branchId: string;
      farmId: string;
      warehouseId: string;
      recipeVersionId: string;
      orderNumber: string;
      plannedOutputQuantity: string;
    },
  ) {
    return this.orders.createFeedOrder({ ...body, orderNumber: undefined, companyId, actor });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_MANAGER', 'FARM_ACCOUNTANT')
  @OwnedRecord('productionOrder', 'id')
  @Post(':id/submit')
  async submit(@Param('id') id: string, @CurrentUser() actor: WorkflowActor) {
    return this.orders.submit({ productionOrderId: id, actor });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT')
  @OwnedRecord('productionOrder', 'id')
  @Post(':id/issue')
  async issue(
    @Param('id') id: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { actualQuantities?: Record<string, string | number> } = {},
  ) {
    return this.orders.issueMaterials({ productionOrderId: id, actualQuantities: body?.actualQuantities, actor });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT')
  @OwnedRecord('productionOrder', 'id')
  @Post(':id/confirm-conversion')
  async confirmConversion(
    @Param('id') id: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      /** Only when the recipe has no routing; otherwise derived from actual hours × approved rates. */
      standardConversionCostKobo?: string;
      /** Actual hours per routing operation, by operation name or line id. */
      actualHours?: Record<string, string | number>;
      actualLabourCostKobo: string;
      actualOverheadCostKobo: string;
    },
  ) {
    return this.orders.confirmConversion({
      productionOrderId: id,
      ...(body.standardConversionCostKobo ? { standardConversionCostKobo: BigInt(body.standardConversionCostKobo) } : {}),
      ...(body.actualHours ? { actualHours: body.actualHours } : {}),
      actualLabourCostKobo: BigInt(body.actualLabourCostKobo),
      actualOverheadCostKobo: BigInt(body.actualOverheadCostKobo),
      actor,
    });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT')
  @OwnedRecord('productionOrder', 'id')
  @Post(':id/loss')
  async recordLoss(
    @Param('id') id: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { quantity: string; costKobo: string; reason: string },
  ) {
    return this.orders.recordAbnormalLoss({
      productionOrderId: id,
      quantity: body.quantity,
      costKobo: BigInt(body.costKobo),
      reason: body.reason,
      actor,
    });
  }

  /** Poultry plant intake: received, dead on arrival and condemned (handbook §29). */
  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT', 'QA_OFFICER')
  @OwnedRecord('productionOrder', 'id')
  @Post(':id/intake')
  async recordIntake(
    @Param('id') id: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      plantReceivedCount: number;
      plantReceivedWeightKg: string;
      deadOnArrivalCount?: number;
      deadOnArrivalWeightKg?: string;
      condemnedCount?: number;
      condemnedWeightKg?: string;
      condemnationReason?: string;
      inspectedBy?: string;
    },
  ) {
    return this.orders.recordIntake({
      productionOrderId: id,
      plantReceivedCount: Number(body.plantReceivedCount),
      plantReceivedWeightKg: body.plantReceivedWeightKg,
      deadOnArrivalCount: Number(body.deadOnArrivalCount ?? 0),
      deadOnArrivalWeightKg: body.deadOnArrivalWeightKg || '0',
      condemnedCount: Number(body.condemnedCount ?? 0),
      condemnedWeightKg: body.condemnedWeightKg || '0',
      condemnationReason: body.condemnationReason ?? null,
      inspectedBy: body.inspectedBy ?? null,
      actor,
    });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT')
  @OwnedRecord('productionOrder', 'id')
  @Post(':id/outputs')
  async recordOutputs(
    @Param('id') id: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      /** Optional; the company's released method is used and another is refused. */
      method?: CostAllocationMethod;
      warehouseId: string;
      /** Normal process loss in kg, for an order from a harvest (mass balance). */
      normalLossQuantity?: string;
      outputs: Array<{
        itemId: string;
        outputType: 'MAIN' | 'BY_PRODUCT';
        quantity: string;
        salePricePerUnitKobo?: string;
        costsToSellPerUnitKobo?: string;
        weight?: string;
        grade?: string;
        /** YYYY-MM-DD. */
        expiryDate?: string;
        storageTemperatureC?: string;
      }>;
    },
  ) {
    for (const o of body.outputs) {
      if (o.expiryDate && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(o.expiryDate)) {
        throw new BadRequestException('expiryDate must be a date, YYYY-MM-DD.');
      }
    }
    const outputs: AllocationOutput[] = body.outputs.map((o) => ({
      itemId: o.itemId,
      outputType: o.outputType,
      quantity: o.quantity,
      salePricePerUnitKobo: o.salePricePerUnitKobo !== undefined ? BigInt(o.salePricePerUnitKobo) : undefined,
      costsToSellPerUnitKobo: o.costsToSellPerUnitKobo !== undefined ? BigInt(o.costsToSellPerUnitKobo) : undefined,
      weight: o.weight,
    }));

    return this.orders.recordOutputs({
      productionOrderId: id,
      method: body.method,
      normalLossQuantity: body.normalLossQuantity,
      outputs,
      warehouseId: body.warehouseId,
      details: body.outputs.map((o) => ({
        grade: o.grade ?? null,
        expiryDate: o.expiryDate ? new Date(`${o.expiryDate}T00:00:00.000Z`) : null,
        storageTemperatureC: o.storageTemperatureC ?? null,
      })),
      actor,
    });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT')
  @OwnedRecord('productionOrder', 'id')
  @Post(':id/settle')
  async settle(@Param('id') id: string, @CurrentUser() actor: WorkflowActor, @Body() body: { varianceReason?: string } = {}) {
    return this.orders.settle({ productionOrderId: id, varianceReason: body?.varianceReason, actor });
  }

  /** The order's variances against its standard, and the year's tolerance. */
  @AnyRole('How far an order is from its standard, and whether settling it needs a reason.')
  @OwnedRecord('productionOrder', 'id')
  @Get(':id/variance')
  async variance(@Param('id') id: string) {
    return this.orders.varianceCheck(id);
  }
}
