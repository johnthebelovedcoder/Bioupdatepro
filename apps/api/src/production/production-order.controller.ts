import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductionOrderService } from './production-order.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { AnyRole, Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';
import type { AllocationOutput, CostAllocationMethod } from './cost-allocation.service';

/**
 * Production orders over HTTP — the SnailPro processing slice (US-897-016
 * through 020). API-only this pass, following the same build order P2P and
 * O2C already used: the domain engine first, a screen in a later pass.
 */
@Controller('production-orders')
export class ProductionOrderController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: ProductionOrderService,
  ) {}

  @AnyRole('Every processing order and where it stands.')
  @Get()
  async list(@CurrentCompany() companyId: string) {
    return this.prisma.productionOrder.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: { components: true, outputs: true, lossEvents: true },
    });
  }

  @AnyRole('One processing order in full.')
  @Get(':id')
  async get(@Param('id') id: string) {
    await this.orders.syncOrderStatus(id);
    return this.prisma.productionOrder.findUniqueOrThrow({
      where: { id },
      include: { components: true, outputs: true, lossEvents: true },
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
