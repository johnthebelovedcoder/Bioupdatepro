import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductionOrderService } from './production-order.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { AnyRole, Roles } from '../auth/roles.guard';
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
  ) {}

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

  @AnyRole('One processing order in full.')
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
      orderNumber: string;
      plannedOutputQuantity: string;
    },
  ) {
    return this.orders.createFromHarvest({ ...body, actor });
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
    return this.orders.createFeedOrder({ ...body, companyId, actor });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_MANAGER', 'FARM_ACCOUNTANT')
  @Post(':id/submit')
  async submit(@Param('id') id: string, @CurrentUser() actor: WorkflowActor) {
    return this.orders.submit({ productionOrderId: id, actor });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT')
  @Post(':id/issue')
  async issue(@Param('id') id: string, @CurrentUser() actor: WorkflowActor) {
    return this.orders.issueMaterials({ productionOrderId: id, actor });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT')
  @Post(':id/confirm-conversion')
  async confirmConversion(
    @Param('id') id: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: { standardConversionCostKobo: string; actualLabourCostKobo: string; actualOverheadCostKobo: string },
  ) {
    return this.orders.confirmConversion({
      productionOrderId: id,
      standardConversionCostKobo: BigInt(body.standardConversionCostKobo),
      actualLabourCostKobo: BigInt(body.actualLabourCostKobo),
      actualOverheadCostKobo: BigInt(body.actualOverheadCostKobo),
      actor,
    });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT')
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

  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT')
  @Post(':id/outputs')
  async recordOutputs(
    @Param('id') id: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: {
      method: CostAllocationMethod;
      warehouseId: string;
      outputs: Array<{
        itemId: string;
        outputType: 'MAIN' | 'BY_PRODUCT';
        quantity: string;
        salePricePerUnitKobo?: string;
        costsToSellPerUnitKobo?: string;
        weight?: string;
      }>;
    },
  ) {
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
      outputs,
      warehouseId: body.warehouseId,
      actor,
    });
  }

  @Roles('PRODUCTION_LEAD', 'FARM_ACCOUNTANT')
  @Post(':id/settle')
  async settle(@Param('id') id: string, @CurrentUser() actor: WorkflowActor) {
    return this.orders.settle({ productionOrderId: id, actor });
  }
}
