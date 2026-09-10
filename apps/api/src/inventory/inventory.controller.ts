import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryTransferService } from './inventory-transfer.service';
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.guard';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * General inventory transfer and write-off over HTTP (§14 — PCR-012/013/014,
 * US-897-008). API-only this pass, following the same build order every
 * other engine this session used: the domain logic first, a screen later.
 *
 * Role-gated only — no maker-checker workflow ladder. The RACI sheet names
 * "Stores Supervisor" and "Controller + Operations" as approvers, but
 * neither role exists in this app's seeded roster; every route here is
 * simplified to role-gating, the same documented simplification already
 * accepted for Feed Mill's own RACI shortcut.
 */
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: InventoryTransferService,
  ) {}

  // Raw findMany() until now — id, itemId, fromWarehouseId as bare UUIDs.
  // Fine for a script, not for a screen: the first real page needs names,
  // not foreign keys to look up itself.
  @Roles('STOREKEEPER', 'FARM_MANAGER', 'FARM_ACCOUNTANT', 'PRODUCTION_LEAD')
  @Get('transfers')
  async listTransfers(@CurrentCompany() companyId: string) {
    const rows = await this.prisma.inventoryTransfer.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        item: { select: { code: true, description: true, unitOfMeasure: { select: { code: true } } } },
        fromWarehouse: { select: { code: true, name: true } },
        toWarehouse: { select: { code: true, name: true } },
        createdBy: { select: { fullName: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      transferNumber: row.transferNumber,
      itemCode: row.item.code,
      itemName: row.item.description,
      unit: row.item.unitOfMeasure.code,
      fromWarehouse: row.fromWarehouse.name,
      toWarehouse: row.toWarehouse.name,
      quantity: row.quantity.toString(),
      valueKobo: row.valueKobo.toString(),
      status: row.status,
      issuedAt: row.issuedAt,
      receivedAt: row.receivedAt,
      createdBy: row.createdBy.fullName,
    }));
  }

  @Roles('STOREKEEPER', 'FARM_MANAGER', 'FARM_ACCOUNTANT', 'PRODUCTION_LEAD')
  @Post('transfers')
  async issueTransfer(
    @CurrentUser() actor: WorkflowActor,
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      branchId: string;
      itemId: string;
      fromWarehouseId: string;
      toWarehouseId: string;
      quantity: string;
      transferNumber: string;
    },
  ) {
    return this.transfers.issueTransfer({ ...body, companyId, actor });
  }

  @Roles('STOREKEEPER', 'FARM_MANAGER', 'FARM_ACCOUNTANT', 'PRODUCTION_LEAD')
  @Post('transfers/:id/receive')
  async receiveTransfer(@Param('id') id: string, @CurrentUser() actor: WorkflowActor) {
    return this.transfers.receiveTransfer({ transferId: id, actor });
  }

  @Roles('STOREKEEPER', 'FARM_MANAGER', 'FARM_ACCOUNTANT', 'PRODUCTION_LEAD')
  @Get('write-offs')
  async listWriteOffs(@CurrentCompany() companyId: string) {
    const rows = await this.prisma.inventoryWriteOff.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      include: {
        item: { select: { code: true, description: true, unitOfMeasure: { select: { code: true } } } },
        warehouse: { select: { code: true, name: true } },
        createdBy: { select: { fullName: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      itemCode: row.item.code,
      itemName: row.item.description,
      unit: row.item.unitOfMeasure.code,
      warehouse: row.warehouse.name,
      quantity: row.quantity.toString(),
      valueKobo: row.valueKobo.toString(),
      reason: row.reason,
      createdBy: row.createdBy.fullName,
      createdAt: row.createdAt,
    }));
  }

  @Roles('STOREKEEPER', 'FARM_MANAGER', 'FARM_ACCOUNTANT', 'PRODUCTION_LEAD')
  @Post('write-offs')
  async writeOff(
    @CurrentUser() actor: WorkflowActor,
    @CurrentCompany() companyId: string,
    @Body()
    body: {
      branchId: string;
      itemId: string;
      warehouseId: string;
      quantity: string;
      reason: string;
    },
  ) {
    return this.transfers.writeOff({ ...body, companyId, actor });
  }
}
