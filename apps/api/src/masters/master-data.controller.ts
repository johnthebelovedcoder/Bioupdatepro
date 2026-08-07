import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  EmploymentStatus,
  ItemType,
  PartyStatus,
} from '@bioassetpro/database';
import { PartyService } from './party.service';
import { ItemService } from './item.service';
import { EmployeeService } from './employee.service';
import { RecipeService } from './recipe.service';
import { kobo } from '../common/money';

/**
 * Master data API (§5, §6, §7, §10).
 *
 * Separate from MastersController, which serves Phase 1's core reference data
 * (companies, accounts, periods). This one owns the transacting masters.
 */
@Controller('masters')
export class MasterDataController {
  constructor(
    private readonly parties: PartyService,
    private readonly items: ItemService,
    private readonly employees: EmployeeService,
    private readonly recipes: RecipeService,
  ) {}

  // --- Suppliers ----------------------------------------------------------

  @Post('suppliers')
  async createSupplier(@Body() body: Record<string, unknown>) {
    const input = body;
    return this.parties.createSupplier({
      ...input,
      creditLimit:
        input.creditLimitKobo !== undefined && input.creditLimitKobo !== null
          ? kobo(BigInt(String(input.creditLimitKobo)))
          : null,
    } as Parameters<PartyService['createSupplier']>[0]);
  }

  @Get('suppliers')
  async listSuppliers(
    @Query('companyId') companyId: string,
    @Query('status') status?: PartyStatus,
  ) {
    const rows = await this.parties.listSuppliers(companyId, status);
    return rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      status: s.status,
      tin: s.tin,
      whtCategory: s.whtTaxCode?.whtCategory ?? null,
      paymentTerm: s.paymentTerm?.code ?? null,
      netDays: s.paymentTerm?.netDays ?? null,
      creditLimitKobo: s.creditLimitSet ? s.creditLimitKobo.toString() : null,
    }));
  }

  @Post('suppliers/:id/status')
  async setSupplierStatus(
    @Param('id') id: string,
    @Body() body: { status: PartyStatus; reason?: string; actorId: string },
  ) {
    return this.parties.setSupplierStatus({ supplierId: id, ...body });
  }

  // --- Customers ----------------------------------------------------------

  @Post('customers')
  async createCustomer(@Body() body: Record<string, unknown>) {
    const input = body;
    return this.parties.createCustomer({
      ...input,
      creditLimit:
        input.creditLimitKobo !== undefined && input.creditLimitKobo !== null
          ? kobo(BigInt(String(input.creditLimitKobo)))
          : null,
      customerSince: input.customerSince ? new Date(String(input.customerSince)) : null,
    } as Parameters<PartyService['createCustomer']>[0]);
  }

  @Get('customers')
  async listCustomers(
    @Query('companyId') companyId: string,
    @Query('status') status?: PartyStatus,
  ) {
    const rows = await this.parties.listCustomers(companyId, status);
    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      status: c.status,
      tin: c.tin,
      whtCategory: c.whtTaxCode?.whtCategory ?? null,
      creditLimitKobo: c.creditLimitSet ? c.creditLimitKobo.toString() : null,
      riskRating: c.riskRating,
    }));
  }

  @Post('customers/:id/status')
  async setCustomerStatus(
    @Param('id') id: string,
    @Body() body: { status: PartyStatus; reason?: string; actorId: string },
  ) {
    return this.parties.setCustomerStatus({ customerId: id, ...body });
  }

  @Post('customers/:id/credit-check')
  async creditCheck(
    @Param('id') id: string,
    @Body() body: { proposedAmountKobo: string | number; receivableGlAccountId?: string },
  ) {
    return this.parties.creditCheck({
      customerId: id,
      proposedAmount: kobo(BigInt(body.proposedAmountKobo)),
      receivableGlAccountId: body.receivableGlAccountId ?? null,
    });
  }

  // --- Items --------------------------------------------------------------

  @Post('items')
  async createItem(@Body() body: Record<string, unknown>) {
    const input = body;
    return this.items.create({
      ...input,
      standardCost:
        input.standardCostKobo !== undefined && input.standardCostKobo !== null
          ? kobo(BigInt(String(input.standardCostKobo)))
          : null,
      standardCostFrom: input.standardCostFrom
        ? new Date(String(input.standardCostFrom))
        : null,
    } as Parameters<ItemService['create']>[0]);
  }

  @Get('items')
  async listItems(
    @Query('companyId') companyId: string,
    @Query('itemType') itemType?: ItemType,
  ) {
    const rows = await this.items.list(companyId, itemType);
    return rows.map((i) => ({
      id: i.id,
      code: i.code,
      description: i.description,
      itemType: i.itemType,
      isBiologicalFeed: i.isBiologicalFeed,
      unitOfMeasure: i.unitOfMeasure.code,
      vatCode: i.vatTaxCode?.code ?? null,
      standardCostKobo: i.standardCosts[0]?.standardCostKobo.toString() ?? null,
    }));
  }

  @Post('items/:id/standard-cost')
  async setStandardCost(
    @Param('id') id: string,
    @Body()
    body: {
      costKobo: string | number;
      effectiveFrom: string;
      sourceReference?: string;
      actorId: string;
    },
  ) {
    return this.items.setStandardCost({
      itemId: id,
      cost: kobo(BigInt(body.costKobo)),
      effectiveFrom: new Date(body.effectiveFrom),
      sourceReference: body.sourceReference ?? null,
      actorId: body.actorId,
    });
  }

  // --- Employees ----------------------------------------------------------

  @Post('employees')
  async createEmployee(@Body() body: Record<string, unknown>) {
    const input = body;
    return this.employees.create({
      ...input,
      employmentDate: new Date(String(input.employmentDate)),
      dateOfBirth: input.dateOfBirth ? new Date(String(input.dateOfBirth)) : null,
    } as unknown as Parameters<EmployeeService['create']>[0]);
  }

  @Get('employees')
  async listEmployees(
    @Query('companyId') companyId: string,
    @Query('status') status?: EmploymentStatus,
  ) {
    const rows = await this.employees.list(companyId, status);
    return rows.map((e) => ({
      id: e.id,
      employeeNumber: e.employeeNumber,
      name: `${e.firstName} ${e.surname}`,
      employmentStatus: e.employmentStatus,
      payrollActive: e.payrollActive,
      department: e.department?.code ?? null,
      costCentre: e.costCentre?.code ?? null,
      taxState: e.taxState,
    }));
  }

  @Post('employees/:id/salary-component')
  async setSalaryComponent(
    @Param('id') id: string,
    @Body()
    body: {
      componentCode: string;
      amountKobo?: string | number;
      rate?: string;
      effectiveFrom: string;
      actorId: string;
    },
  ) {
    return this.employees.setSalaryComponent({
      employeeId: id,
      componentCode: body.componentCode,
      amount:
        body.amountKobo !== undefined && body.amountKobo !== null
          ? kobo(BigInt(body.amountKobo))
          : null,
      rate: body.rate ?? null,
      effectiveFrom: new Date(body.effectiveFrom),
      actorId: body.actorId,
    });
  }

  @Get('employees/:id/salary')
  async salarySnapshot(@Param('id') id: string, @Query('on') on?: string) {
    return this.employees.salarySnapshot(id, on ? new Date(on) : new Date());
  }

  @Get('employees/:id/payroll-readiness')
  async payrollReadiness(@Param('id') id: string, @Query('on') on?: string) {
    return this.employees.payrollReadiness(id, on ? new Date(on) : new Date());
  }

  @Post('employees/:id/activate-payroll')
  async activatePayroll(
    @Param('id') id: string,
    @Body() body: { actorId: string; on?: string },
  ) {
    return this.employees.activateForPayroll({
      employeeId: id,
      on: body.on ? new Date(body.on) : new Date(),
      actorId: body.actorId,
    });
  }

  // --- Recipes ------------------------------------------------------------

  @Post('recipes/versions')
  async createDraftVersion(
    @Body()
    body: {
      recipeId: string;
      batchSize: string;
      expectedYieldPercent?: string;
      effectiveFrom: string;
      copyFromVersionId?: string;
      notes?: string;
    },
  ) {
    return this.recipes.createDraftVersion({
      ...body,
      effectiveFrom: new Date(body.effectiveFrom),
      expectedYieldPercent: body.expectedYieldPercent ?? null,
      copyFromVersionId: body.copyFromVersionId ?? null,
      notes: body.notes ?? null,
    });
  }

  @Post('recipes/versions/:id/activate')
  async activateVersion(@Param('id') id: string, @Body() body: { actorId: string }) {
    return this.recipes.activateVersion({ recipeVersionId: id, actorId: body.actorId });
  }

  @Get('recipes/versions/:id/explode')
  async explode(
    @Param('id') id: string,
    @Query('quantity') quantity: string,
    @Query('on') on?: string,
  ) {
    return this.recipes.explode({
      recipeVersionId: id,
      quantity,
      on: on ? new Date(on) : new Date(),
    });
  }
}
