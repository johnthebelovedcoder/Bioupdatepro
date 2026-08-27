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
import { CurrentCompany, CurrentUser } from '../auth/current-user.decorator';
import { OwnedRecord } from '../auth/owned-record.guard';
import { AnyRole, Roles } from '../auth/roles.guard';
import { FarmStructureService } from './farm-structure.service';
import type { WorkflowActor } from '../workflow/workflow.types';

/**
 * Master data API (§5, §6, §7, §10).
 *
 * Separate from MastersController, which serves Phase 1's core reference data
 * (companies, accounts, periods). This one owns the transacting masters.
 */
@Controller('masters')
@Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
export class MasterDataController {
  constructor(
    private readonly parties: PartyService,
    private readonly items: ItemService,
    private readonly employees: EmployeeService,
    private readonly recipes: RecipeService,
    private readonly structure: FarmStructureService,
  ) {}

  // --- Suppliers ----------------------------------------------------------

  /**
   * Register a vendor.
   *
   * The company and the actor come from the verified session, never the body.
   * They used to be read straight off the request, which let a caller name the
   * company a supplier belonged to and — worse, since nothing checked it —
   * attribute the registration to another user in the audit trail.
   *
   * The currency is resolved from the company rather than asked for: a farm
   * registering a feed supplier should not have to answer a question about
   * currency ids, and the answer is never anything but the company's own.
   */
  // PROCUREMENT_OFFICER (ROL-005) sources suppliers as part of "create PR/PO" —
  // registering a new one they intend to buy from is part of the same job.
  @Roles(
    'FARM_MANAGER',
    'FINANCE_MANAGER',
    'FINANCE_CONTROLLER',
    'PROCUREMENT_OFFICER',
    'CFO',
  )
  @Post('suppliers')
  async createSupplier(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: Record<string, unknown>,
  ) {
    const company = await this.parties.companyDefaults(companyId);
    return this.parties.createSupplier({
      ...body,
      companyId,
      actorId: actor.userId,
      defaultCurrencyId: company.baseCurrencyId,
      creditLimit:
        body.creditLimitKobo !== undefined && body.creditLimitKobo !== null
          ? kobo(BigInt(String(body.creditLimitKobo)))
          : null,
    } as Parameters<PartyService['createSupplier']>[0]);
  }

  @Get('suppliers')
  async listSuppliers(
    @CurrentCompany() companyId: string,
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

  @OwnedRecord('supplier', 'id')
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
    @CurrentCompany() companyId: string,
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

  @OwnedRecord('customer', 'id')
  @Post('customers/:id/status')
  async setCustomerStatus(
    @Param('id') id: string,
    @Body() body: { status: PartyStatus; reason?: string; actorId: string },
  ) {
    return this.parties.setCustomerStatus({ customerId: id, ...body });
  }

  @OwnedRecord('customer', 'id')
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

  /** Company and actor from the session, never the body — as for suppliers. */
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('items')
  async createItem(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: Record<string, unknown>,
  ) {
    const input: Record<string, unknown> = { ...body, companyId, actorId: actor.userId };
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
    @CurrentCompany() companyId: string,
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

  @OwnedRecord('item', 'id')
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
    @CurrentCompany() companyId: string,
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

  @OwnedRecord('employee', 'id')
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

  @OwnedRecord('employee', 'id')
  @Get('employees/:id/salary')
  async salarySnapshot(@Param('id') id: string, @Query('on') on?: string) {
    return this.employees.salarySnapshot(id, on ? new Date(on) : new Date());
  }

  @OwnedRecord('employee', 'id')
  @Get('employees/:id/payroll-readiness')
  async payrollReadiness(@Param('id') id: string, @Query('on') on?: string) {
    return this.employees.payrollReadiness(id, on ? new Date(on) : new Date());
  }

  @OwnedRecord('employee', 'id')
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

  @OwnedRecord('productRecipeVersion', 'id')
  @Post('recipes/versions/:id/activate')
  async activateVersion(@Param('id') id: string, @Body() body: { actorId: string }) {
    return this.recipes.activateVersion({ recipeVersionId: id, actorId: body.actorId });
  }

  @OwnedRecord('productRecipeVersion', 'id')
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

  /* --- Structure: farms, pens, stores, cost centres ------------------------
   *
   * None of these had an endpoint. The consequence was not subtle: a farm that
   * signed up could not create the pen its animals live in, the store its feed
   * sits in, or the cost centre every production posting requires — so the
   * whole operational side was unreachable from a fresh account.
   */

  @AnyRole('Everyone on a farm needs to know which farms and pens exist.')
  @Get('farms')
  async listFarms(@CurrentCompany() companyId: string) {
    return this.structure.listFarms(companyId);
  }

  @Roles('FARM_MANAGER', 'CFO')
  @Post('farms')
  async createFarm(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { code: string; name: string },
  ) {
    return this.structure.createFarm({ companyId, actor, ...body });
  }

  @AnyRole('Everyone on a farm needs to know which pens exist.')
  @Get('pens')
  async listPens(@CurrentCompany() companyId: string) {
    return this.structure.listPens(companyId);
  }

  @Roles('FARM_MANAGER', 'CFO')
  @Post('pens')
  async createPen(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { farmId?: string | null; code: string; name: string },
  ) {
    return this.structure.createPen({ companyId, actor, ...body });
  }

  @AnyRole('Stores are named on every stock movement.')
  @Get('warehouses')
  async listWarehouses(@CurrentCompany() companyId: string) {
    return this.structure.listWarehouses(companyId);
  }

  // STOREKEEPER (ROL-006): "Receive, issue, transfer and count inventory;
  // site scoped" — registering the store they are scoped to is part of that.
  @Roles('FARM_MANAGER', 'FINANCE_MANAGER', 'STOREKEEPER', 'CFO')
  @Post('warehouses')
  async createWarehouse(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { code: string; name: string; type: string },
  ) {
    return this.structure.createWarehouse({ companyId, actor, ...body });
  }

  /*
   * The two lists an item form cannot be filled in without.
   *
   * Offered as lists rather than free text because a mistyped unit code is
   * rejected by the API with a message about unit codes, and a mistyped VAT
   * code silently misstates recoverable input tax. Neither is a sentence a
   * farmer should have to decode.
   */
  @AnyRole('Reference lists that every create form needs to render.')
  @Get('units')
  async listUnits(@CurrentCompany() companyId: string) {
    return this.structure.listUnits(companyId);
  }

  @AnyRole('Reference lists that every create form needs to render.')
  @Get('gl-accounts')
  async listGlAccounts(@CurrentCompany() companyId: string) {
    return this.structure.listGlAccounts(companyId);
  }

  @AnyRole('Reference lists that every create form needs to render.')
  @Get('tax-codes')
  async listTaxCodes(@CurrentCompany() companyId: string) {
    return this.structure.listTaxCodes(companyId);
  }

  @AnyRole('Cost centres appear on every production posting.')
  @Get('cost-centres')
  async listCostCentres(@CurrentCompany() companyId: string) {
    return this.structure.listCostCentres(companyId);
  }

  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('cost-centres')
  async createCostCentre(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body()
    body: { code: string; name: string; parentId?: string | null; managerName?: string | null },
  ) {
    return this.structure.createCostCentre({ companyId, actor, ...body });
  }
}
