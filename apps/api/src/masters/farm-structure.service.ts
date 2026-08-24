import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Farms and the houses, pens and sections inside them.
 *
 * The most basic master data in the product and the last to get an endpoint,
 * which had a consequence nobody noticed until somebody tried to use the app
 * for real: a farm that signed up could not create a single pen, so it could
 * not place a batch, so the entire livestock side was unreachable. Every pen
 * in existence had arrived from a seed script.
 *
 * A pen is deliberately thin — a code, a name, and the farm it belongs to.
 * Capacity, house type and environmental limits are real things a farm cares
 * about, but none of them are in the source documents yet, and inventing a
 * capacity field would put a number on screen that nobody had measured.
 */
@Injectable()
export class FarmStructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listFarms(companyId: string) {
    return this.prisma.farm.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        active: true,
        _count: { select: { pens: true } },
      },
    });
  }

  async listPens(companyId: string) {
    const pens = await this.prisma.penHouse.findMany({
      // Scoped through the farm, because a pen has no company of its own.
      where: { farm: { companyId } },
      orderBy: [{ farm: { code: 'asc' } }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        active: true,
        farm: { select: { id: true, code: true, name: true } },
        _count: { select: { livestockGroups: true } },
      },
    });

    return pens.map((pen) => ({
      id: pen.id,
      code: pen.code,
      name: pen.name,
      active: pen.active,
      farmId: pen.farm.id,
      farmName: pen.farm.name,
      // What is living in it right now — the one figure that makes this list
      // worth reading rather than a directory of names.
      populations: pen._count.livestockGroups,
    }));
  }

  async createFarm(params: {
    companyId: string;
    actor: WorkflowActor;
    code: string;
    name: string;
  }) {
    const code = params.code.trim().toUpperCase();
    const name = params.name.trim();
    if (!code || !name) throw new BadRequestException('A farm needs a code and a name.');

    const branch = await this.prisma.branch.findFirst({
      where: { companyId: params.companyId, active: true },
      orderBy: { code: 'asc' },
    });
    if (!branch) {
      throw new BadRequestException('This company has no branch to attach a farm to.');
    }

    const clash = await this.prisma.farm.findFirst({
      where: { companyId: params.companyId, code },
    });
    if (clash) throw new ConflictException(`A farm with the code ${code} already exists.`);

    const farm = await this.prisma.farm.create({
      data: { companyId: params.companyId, branchId: branch.id, code, name },
    });

    await this.audit.write({
      transactionId: farm.id,
      module: 'MASTERS',
      entityType: 'Farm',
      entityId: farm.id,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      ipAddress: params.actor.ipAddress ?? null,
      device: params.actor.device ?? null,
      comments: `Created farm ${code} — ${name}`,
    });

    return farm;
  }

  async createPen(params: {
    companyId: string;
    actor: WorkflowActor;
    farmId?: string | null;
    code: string;
    name: string;
  }) {
    const code = params.code.trim().toUpperCase();
    const name = params.name.trim();
    if (!code || !name) throw new BadRequestException('A pen needs a code and a name.');

    /*
     * The farm is verified to belong to the caller's company rather than
     * trusted. Without this a valid pen could be attached to another tenant's
     * farm by sending its id — the company guard would not object, because the
     * request names no company at all.
     */
    const farm = params.farmId
      ? await this.prisma.farm.findFirst({
          where: { id: params.farmId, companyId: params.companyId },
        })
      : await this.prisma.farm.findFirst({
          where: { companyId: params.companyId, active: true },
          orderBy: { code: 'asc' },
        });

    if (!farm) {
      throw new NotFoundException(
        params.farmId ? 'No such farm.' : 'Create a farm before adding pens to it.',
      );
    }

    const clash = await this.prisma.penHouse.findFirst({
      where: { farmId: farm.id, code },
    });
    if (clash) {
      throw new ConflictException(`${farm.name} already has a pen with the code ${code}.`);
    }

    const pen = await this.prisma.penHouse.create({
      data: { farmId: farm.id, code, name },
    });

    await this.audit.write({
      transactionId: pen.id,
      module: 'MASTERS',
      entityType: 'PenHouse',
      entityId: pen.id,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      ipAddress: params.actor.ipAddress ?? null,
      device: params.actor.device ?? null,
      comments: `Created ${code} — ${name} on ${farm.name}`,
    });

    return pen;
  }

  /* --- Reference lists --------------------------------------------------- */

  /** Units of measure this company has. */
  async listUnits(companyId: string) {
    return this.prisma.unitOfMeasure.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
  }

  /**
   * Postable GL accounts, for the account pickers on an item.
   *
   * An inventory item is refused without a default inventory account, because
   * goods receipt posts Dr Inventory / Cr GRNI and has nowhere to debit
   * otherwise. That rule lives in the item service; this is what lets a form
   * satisfy it instead of guessing an account number.
   */
  async listGlAccounts(companyId: string) {
    return this.prisma.gLAccount.findMany({
      where: { companyId, active: true, isPostingAccount: true },
      orderBy: { accountNumber: 'asc' },
      select: { id: true, accountNumber: true, name: true, accountType: true },
    });
  }

  /** Tax codes this company has, for the VAT picker on an item. */
  async listTaxCodes(companyId: string) {
    return this.prisma.taxCode.findMany({
      where: { companyId, active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, taxType: true },
    });
  }

  /* --- Warehouses ------------------------------------------------------- */

  async listWarehouses(companyId: string) {
    return this.prisma.warehouse.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, type: true, active: true },
    });
  }

  /**
   * A store. Feed, medication, produce — anywhere stock physically sits.
   *
   * The type is not decoration: goods receipt, issue and the finished-goods
   * posting all look for a store of the right kind, so a farm with only a
   * GENERAL store finds its produce has nowhere to go at harvest.
   */
  async createWarehouse(params: {
    companyId: string;
    actor: WorkflowActor;
    code: string;
    name: string;
    type: string;
  }) {
    const code = params.code.trim().toUpperCase();
    const name = params.name.trim();
    if (!code || !name) throw new BadRequestException('A store needs a code and a name.');

    const allowed = [
      'RAW_MATERIAL',
      'WORK_IN_PROGRESS',
      'FINISHED_GOODS',
      'BY_PRODUCT',
      'GENERAL',
    ];
    const type = allowed.includes(params.type) ? params.type : 'GENERAL';

    const branch = await this.prisma.branch.findFirst({
      where: { companyId: params.companyId, active: true },
      orderBy: { code: 'asc' },
    });
    if (!branch) throw new BadRequestException('This company has no branch.');

    const clash = await this.prisma.warehouse.findFirst({
      where: { companyId: params.companyId, code },
    });
    if (clash) throw new ConflictException(`A store with the code ${code} already exists.`);

    const warehouse = await this.prisma.warehouse.create({
      data: {
        companyId: params.companyId,
        branchId: branch.id,
        code,
        name,
        type: type as never,
      },
    });

    await this.audit.write({
      transactionId: warehouse.id,
      module: 'MASTERS',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      ipAddress: params.actor.ipAddress ?? null,
      device: params.actor.device ?? null,
      comments: `Created store ${code} — ${name} (${type})`,
    });

    return warehouse;
  }

  /* --- Cost centres ----------------------------------------------------- */

  async listCostCentres(companyId: string) {
    const centres = await this.prisma.costCentre.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        active: true,
        managerName: true,
        parent: { select: { code: true, name: true } },
      },
    });
    return centres.map((centre) => ({
      id: centre.id,
      code: centre.code,
      name: centre.name,
      active: centre.active,
      managerName: centre.managerName,
      parentName: centre.parent?.name ?? null,
    }));
  }

  /**
   * A cost centre — what a cost is attributed to.
   *
   * Not optional bookkeeping detail: the work-in-progress account refuses any
   * line without one, so a farm with no cost centres cannot post a feed issue
   * at all. That rule comes from the source workbooks, not from here.
   */
  async createCostCentre(params: {
    companyId: string;
    actor: WorkflowActor;
    code: string;
    name: string;
    parentId?: string | null;
    managerName?: string | null;
  }) {
    const code = params.code.trim().toUpperCase();
    const name = params.name.trim();
    if (!code || !name) throw new BadRequestException('A cost centre needs a code and a name.');

    const clash = await this.prisma.costCentre.findFirst({
      where: { companyId: params.companyId, code },
    });
    if (clash) throw new ConflictException(`A cost centre with the code ${code} already exists.`);

    // A parent from another company would silently graft this farm's costs
    // onto another tenant's hierarchy.
    if (params.parentId) {
      const parent = await this.prisma.costCentre.findFirst({
        where: { id: params.parentId, companyId: params.companyId },
      });
      if (!parent) throw new NotFoundException('No such parent cost centre.');
    }

    const centre = await this.prisma.costCentre.create({
      data: {
        companyId: params.companyId,
        code,
        name,
        effectiveDate: new Date(),
        ...(params.parentId ? { parentId: params.parentId } : {}),
        ...(params.managerName?.trim() ? { managerName: params.managerName.trim() } : {}),
      },
    });

    await this.audit.write({
      transactionId: centre.id,
      module: 'MASTERS',
      entityType: 'CostCentre',
      entityId: centre.id,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: params.actor.userId,
      ipAddress: params.actor.ipAddress ?? null,
      device: params.actor.device ?? null,
      comments: `Created cost centre ${code} — ${name}`,
    });

    return centre;
  }
}
