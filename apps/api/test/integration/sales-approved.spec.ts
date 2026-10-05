import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CogsRecognitionPoint, PrismaClient, ReceiptMethod, SalesInvoiceStatus, TaxType } from '@bioassetpro/database';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { PeriodService } from '../../src/periods/period.service';
import { DimensionValidatorService } from '../../src/enterprise-dimensions/dimension-validator.service';
import { PostingService } from '../../src/posting/posting.service';
import { TrialBalanceService } from '../../src/reporting/trial-balance.service';
import { WorkflowService } from '../../src/workflow/workflow.service';
import { WorkflowRoutingService } from '../../src/workflow/workflow-routing.service';
import { DelegationService } from '../../src/workflow/delegation.service';
import { NotificationService } from '../../src/workflow/notification.service';
import { TaxEngineService } from '../../src/tax/tax-engine.service';
import { TaxRegisterService } from '../../src/tax/tax-register.service';
import { TaxSetupService } from '../../src/tax/tax-setup.service';
import { PartyService } from '../../src/masters/party.service';
import { RecipeService } from '../../src/masters/recipe.service';
import { SalesPricingService } from '../../src/sales/sales-pricing.service';
import { SalesOrderService } from '../../src/sales/sales-order.service';
import { DeliveryService } from '../../src/sales/delivery.service';
import { SalesInvoiceService } from '../../src/sales/sales-invoice.service';
import { CustomerReceiptService } from '../../src/sales/customer-receipt.service';
import { CreditNoteService } from '../../src/sales/credit-note.service';
import { SalesFlowService } from '../../src/sales/sales-flow.service';
import { bankGlAccountsWithBalance } from '../../src/chart/bank-account';
import { CreditNotePostingHandler, CustomerReceiptPostingHandler, DeliveryPostingHandler, SalesInvoicePostingHandler } from '../../src/sales/sales.handlers';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { ProfitLossService } from '../../src/reporting/profit-loss.service';
import { ControlAccountReconciliationService } from '../../src/reporting/control-account-reconciliation.service';
import { WorkflowActor } from '../../src/workflow/workflow.types';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Order-to-cash on the approved five-digit chart: the company's sales
 * configuration is the workbook's own (receivables 11000, revenue 40000, cost
 * of sales 50000, finished goods 12400, withholding receivable 11400), VAT
 * comes from tax setup (output VAT 20400), and an item that names its own
 * accounts — eggs — sells to 40330 against 50330 and 12420.
 */
describe('Order-to-cash on the approved chart', () => {
  let prisma: PrismaService;
  let orders: SalesOrderService;
  let deliveries: DeliveryService;
  let invoices: SalesInvoiceService;
  let receipts: CustomerReceiptService;
  let workflow: WorkflowService;
  let trialBalance: TrialBalanceService;
  let reconciliation: ControlAccountReconciliationService;
  let flow: SalesFlowService;
  let provisioning: PostingControlProvisioningService;
  let fixture: TestFixture;
  let maker: WorkflowActor;
  let approver: WorkflowActor;
  let customerId: string;
  let itemId: string;
  let eggItemId: string;
  let warehouseId: string;
  const JAN = new Date('2026-01-15');
  const UNIT_PRICE = 1_000_00n;
  const UNIT_COST = 600_00n;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const audit = new AuditService(prisma);
    const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
    trialBalance = new TrialBalanceService(prisma);
    reconciliation = new ControlAccountReconciliationService(prisma, trialBalance);
    workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
    const tax = new TaxEngineService(prisma);
    const registers = new TaxRegisterService(prisma, tax);
    const parties = new PartyService(prisma, audit);
    const recipes = new RecipeService(prisma, audit);
    const pricing = new SalesPricingService(prisma, tax);
    orders = new SalesOrderService(prisma, audit, workflow, parties, pricing);
    deliveries = new DeliveryService(prisma, audit, posting, workflow, recipes, pricing);
    invoices = new SalesInvoiceService(prisma, audit, posting, workflow, pricing, tax, registers);
    receipts = new CustomerReceiptService(prisma, audit, posting, workflow, pricing, registers);
    const creditNotes = new CreditNoteService(prisma, audit, posting, workflow, pricing, tax, registers, recipes);
    workflow.register(new DeliveryPostingHandler(deliveries));
    workflow.register(new SalesInvoicePostingHandler(invoices));
    workflow.register(new CustomerReceiptPostingHandler(receipts));
    workflow.register(new CreditNotePostingHandler(creditNotes));
    flow = new SalesFlowService(prisma, orders, deliveries, invoices, receipts, workflow);
    provisioning = new PostingControlProvisioningService(prisma, audit);
    // The party service is used below through this handle.
    (globalThis as { __parties?: PartyService }).__parties = parties;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const acct = async (number: string) => (await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: number } })).id;

  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);
    maker = { userId: fixture.makerId, roles: ['SALES_CLERK'] };
    const approverUser = await prisma.user.create({ data: { email: 'sales-approver@test', fullName: 'Sales Approver', passwordHash: 'x', roles: ['FINANCE_MANAGER'] } });
    approver = { userId: approverUser.id, roles: approverUser.roles };

    await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'APPROVED' } });
    await provisioning.provision(fixture.companyId, null);
    await new TaxSetupService(prisma, new AuditService(prisma)).activate({ companyId: fixture.companyId, actorId: fixture.makerId, whtBasis: 'NET_OF_VAT' });
    for (const taxType of [TaxType.VAT, TaxType.WHT] as const) {
      await prisma.taxPeriod.create({
        data: { companyId: fixture.companyId, taxType, year: 2026, periodNumber: 1, name: 'January 2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31'), dueDate: new Date('2026-02-21') },
      });
    }
    for (const transactionType of ['SALES_QUOTATION', 'SALES_ORDER', 'SALES_ORDER_CREDIT_OVERRIDE', 'GOODS_ISSUE', 'SALES_INVOICE', 'CUSTOMER_RECEIPT', 'CREDIT_NOTE']) {
      await prisma.workflowDefinition.create({
        data: {
          companyId: fixture.companyId, transactionType, name: `${transactionType} route`,
          autoPostOnApproval: !['SALES_QUOTATION', 'SALES_ORDER', 'SALES_ORDER_CREDIT_OVERRIDE'].includes(transactionType), effectiveFrom: new Date('2026-01-01'),
          steps: { create: [{ level: 1, roleCode: 'FINANCE_MANAGER', name: 'Finance Manager', maxAmountKobo: null }] },
        },
      });
    }

    const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'Unit', name: 'Unit', precision: 0 } });
    warehouseId = (await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'FG-WH', name: 'Finished Goods', type: 'FINISHED_GOODS' } })).id;
    const vat = await prisma.taxCode.findFirstOrThrow({ where: { companyId: fixture.companyId, code: 'VAT-STD' } });
    const standard = { create: [{ standardCostKobo: UNIT_COST, effectiveFrom: new Date('2026-01-01') }] };
    // Names no accounts of its own: sells through the company configuration.
    itemId = (await prisma.item.create({
      data: { companyId: fixture.companyId, code: 'FG-SLIME', description: 'Cosmetic Snail Slime 100ml', unitOfMeasureId: uom.id, isManufactured: true, vatTaxCodeId: vat.id, inventoryGlAccountId: await acct('12400'), standardCosts: standard },
    })).id;
    // Eggs name their own: 40330 revenue, 50330 cost of sales, 12420 finished poultry products.
    eggItemId = (await prisma.item.create({
      data: {
        companyId: fixture.companyId, code: 'EGGS', description: 'Table eggs', unitOfMeasureId: uom.id, isManufactured: true, vatTaxCodeId: vat.id,
        inventoryGlAccountId: await acct('12420'), revenueGlAccountId: await acct('40330'), costOfSalesGlAccountId: await acct('50330'), standardCosts: standard,
      },
    })).id;
    await prisma.paymentTerm.create({ data: { companyId: fixture.companyId, code: 'NET30', name: 'Net 30', netDays: 30 } });
    const parties = (globalThis as { __parties?: PartyService }).__parties!;
    customerId = (await parties.createCustomer({
      companyId: fixture.companyId, code: 'CUS-001', name: 'Lagos Distributors', creditLimit: 10_000_000_00n as never, currencyId: fixture.currencyId,
      paymentTermCode: 'NET30', tin: 'TIN-CUS-001', actorId: fixture.makerId,
    })).id;
  });

  const period = () => ({ financialYearId: fixture.financialYearId, financialPeriodId: fixture.periodIds[0]! });

  async function receiveStock(item: string, quantity: number) {
    await prisma.stockMovement.create({
      data: {
        companyId: fixture.companyId, branchId: fixture.branchId, itemId: item, warehouseId, direction: 'IN', quantity: quantity.toString(), unitCostKobo: UNIT_COST,
        valueKobo: UNIT_COST * BigInt(quantity), sourceModule: 'test-fixture', sourceDocumentType: 'OpeningStock', sourceDocumentId: `FIXTURE-${item}`,
        documentReference: 'Test fixture opening stock', movementDate: new Date('2026-01-01'),
      },
    });
  }

  async function sell(item: string, quantity = 100) {
    await receiveStock(item, quantity);
    const order = await orders.createOrder({
      companyId: fixture.companyId, orderNumber: `SO-${Math.random().toString(36).slice(2, 8)}`, customerId, orderDate: JAN, currencyId: fixture.currencyId,
      branchId: fixture.branchId, warehouseId, lines: [{ lineNumber: 1, itemId: item, quantity, unitPriceKobo: UNIT_PRICE }], actor: maker,
    });
    const submitted = await orders.submitOrder({ salesOrderId: order.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.syncStatus(order.id);
    const full = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    const delivery = await deliveries.create({
      salesOrderId: full.id, deliveryNumber: 'DN-001', deliveryDate: JAN, ...period(),
      lines: full.lines.map((line) => ({ salesOrderLineId: line.id, quantity: line.quantity.toString() })), actor: maker,
    });
    const delivered = await deliveries.submit({ deliveryNoteId: delivery.id, actor: maker });
    await workflow.approve({ transactionId: delivered.transactionId, actor: approver });
    await orders.syncStatus(full.id);
    const invoice = await invoices.createFromOrder({ salesOrderId: full.id, invoiceNumber: 'INV-001', invoiceDate: JAN, ...period(), actor: maker });
    const submittedInvoice = await invoices.submit({ invoiceId: invoice.id, actor: maker });
    await workflow.approve({ transactionId: submittedInvoice.transactionId, actor: approver });
    return prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
  }

  async function balance(accountNumber: string) {
    const sums = await prisma.journalLine.aggregate({
      where: { glAccountId: await acct(accountNumber), journalEntry: { status: 'POSTED' } },
      _sum: { debitKobo: true, creditKobo: true },
    });
    return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
  }

  it('gives the company the workbook’s sales configuration, and reports it ready', async () => {
    const config = await prisma.salesConfiguration.findFirstOrThrow({
      where: { companyId: fixture.companyId },
      include: { receivableAccount: true, revenueAccount: true, costOfSalesAccount: true, inventoryAccount: true, whtReceivableAccount: true },
    });
    expect([
      config.receivableAccount.accountNumber, config.revenueAccount.accountNumber, config.costOfSalesAccount.accountNumber,
      config.inventoryAccount.accountNumber, config.whtReceivableAccount?.accountNumber,
    ]).toEqual(['11000', '40000', '50000', '12400', '11400']);
    const status = await provisioning.status(fixture.companyId);
    expect(status.targetChart.configurationsOutsideTarget.filter((c) => c.configuration === 'Sales')).toEqual([]);
  });

  it('delivers, invoices and is paid on the workbook’s receivable, revenue, cost of sales, VAT and bank accounts', async () => {
    const invoice = await sell(itemId);
    expect(await balance('11000')).toBe(10_750_000n); // ₦100,000 + ₦7,500 VAT receivable
    expect(await balance('40000')).toBe(-10_000_000n); // revenue
    expect(await balance('20400')).toBe(-750_000n); // output VAT
    expect(await balance('50000')).toBe(6_000_000n); // cost of sales, once, at delivery
    expect(await balance('12400')).toBe(-6_000_000n); // out of finished goods control
    expect((await trialBalance.build({ companyId: fixture.companyId })).balanced).toBe(true);
    // Cost of sales is cost of sales on the profit and loss, not operating expense.
    const profit = await new ProfitLossService(trialBalance).build({ companyId: fixture.companyId });
    expect(profit.costOfSalesKobo).toBe('6000000');
    expect(profit.grossProfitKobo).toBe('4000000');
    expect(profit.operatingExpenseKobo).toBe('0');

    const receipt = await receipts.create({
      companyId: fixture.companyId, receiptNumber: 'RCT-001', customerId, receiptDate: JAN, method: ReceiptMethod.BANK_TRANSFER, bankGlAccountId: await acct('10100'),
      branchId: fixture.branchId, currencyId: fixture.currencyId, ...period(), amountKobo: invoice.grossAmountKobo, whtAmountKobo: 0n,
      allocations: [{ invoiceId: invoice.id, amountKobo: invoice.grossAmountKobo }], actor: maker,
    });
    const submitted = await receipts.submit({ receiptId: receipt.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    expect(await balance('10100')).toBe(10_750_000n);
    expect(await balance('11000')).toBe(0n);
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(SalesInvoiceStatus.PAID);
  });

  it('stops listing an order as ready to ship or invoice once that document is waiting for approval', async () => {
    await receiveStock(itemId, 10);
    const order = await orders.createOrder({
      companyId: fixture.companyId, orderNumber: 'SO-READY', customerId, orderDate: JAN, currencyId: fixture.currencyId,
      branchId: fixture.branchId, warehouseId, lines: [{ lineNumber: 1, itemId, quantity: 10, unitPriceKobo: UNIT_PRICE }], actor: maker,
    });
    const submitted = await orders.submitOrder({ salesOrderId: order.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.syncStatus(order.id);
    const find = async () => (await flow.listOrders(fixture.companyId)).find((o) => o.id === order.id)!;
    expect((await find()).canDeliver).toBe(true);

    const full = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    const delivery = await deliveries.create({
      salesOrderId: full.id, deliveryNumber: 'DN-READY', deliveryDate: JAN, ...period(),
      lines: full.lines.map((line) => ({ salesOrderLineId: line.id, quantity: line.quantity.toString() })), actor: maker,
    });
    const delivered = await deliveries.submit({ deliveryNoteId: delivery.id, actor: maker });
    expect((await find()).canDeliver).toBe(false); // already on a delivery awaiting approval
    await workflow.approve({ transactionId: delivered.transactionId, actor: approver });
    await orders.syncStatus(full.id);
    expect((await find()).canInvoice).toBe(true);

    const invoice = await invoices.createFromOrder({ salesOrderId: full.id, invoiceNumber: 'INV-READY', invoiceDate: JAN, ...period(), actor: maker });
    expect((await find()).canInvoice).toBe(false); // billed, awaiting approval
    await invoices.submit({ invoiceId: invoice.id, actor: maker });
    expect((await find()).canInvoice).toBe(false);
  });

  it('keeps how a sale was paid and offers its receipt until one is raised', async () => {
    const order = await orders.createOrder({
      companyId: fixture.companyId, orderNumber: 'SO-CASH', customerId, orderDate: JAN, currencyId: fixture.currencyId,
      branchId: fixture.branchId, warehouseId, receivedAtSaleMethod: 'CASH',
      lines: [{ lineNumber: 1, itemId, quantity: 5, unitPriceKobo: UNIT_PRICE }], actor: maker,
    });
    await receiveStock(itemId, 5);
    const submitted = await orders.submitOrder({ salesOrderId: order.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.syncStatus(order.id);
    const full = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    const delivery = await deliveries.create({
      salesOrderId: full.id, deliveryNumber: 'DN-CASH', deliveryDate: JAN, ...period(),
      lines: full.lines.map((line) => ({ salesOrderLineId: line.id, quantity: line.quantity.toString() })), actor: maker,
    });
    const delivered = await deliveries.submit({ deliveryNoteId: delivery.id, actor: maker });
    await workflow.approve({ transactionId: delivered.transactionId, actor: approver });
    await orders.syncStatus(full.id);
    const invoice = await invoices.createFromOrder({ salesOrderId: full.id, invoiceNumber: 'INV-CASH', invoiceDate: JAN, ...period(), actor: maker });
    const sub = await invoices.submit({ invoiceId: invoice.id, actor: maker });
    await workflow.approve({ transactionId: sub.transactionId, actor: approver });

    const row = (await flow.receivableInvoices(fixture.companyId)).find((r) => r.id === invoice.id)!;
    expect(row.receivedAtSaleMethod).toBe('CASH');
    expect(row.receiptPending).toBe(false);

    const receipt = await receipts.create({
      companyId: fixture.companyId, receiptNumber: 'RCT-CASH', customerId, receiptDate: JAN, method: ReceiptMethod.CASH, bankGlAccountId: await acct('10100'),
      branchId: fixture.branchId, currencyId: fixture.currencyId, ...period(), amountKobo: invoice.grossAmountKobo, whtAmountKobo: 0n,
      allocations: [{ invoiceId: invoice.id, amountKobo: invoice.grossAmountKobo }], actor: maker,
    });
    await receipts.submit({ receiptId: receipt.id, actor: maker });
    const after = (await flow.receivableInvoices(fixture.companyId)).find((r) => r.id === invoice.id)!;
    expect(after.receiptPending).toBe(true);
  });

  it('reports what each bank account holds, so a payment screen can warn before overdrawing it', async () => {
    const invoice = await sell(itemId);
    expect((await bankGlAccountsWithBalance(prisma, fixture.companyId)).find((a) => a.accountNumber === '10100')?.balanceKobo).toBe('0');
    const receipt = await receipts.create({
      companyId: fixture.companyId, receiptNumber: 'RCT-BAL', customerId, receiptDate: JAN, method: ReceiptMethod.BANK_TRANSFER, bankGlAccountId: await acct('10100'),
      branchId: fixture.branchId, currencyId: fixture.currencyId, ...period(), amountKobo: invoice.grossAmountKobo, whtAmountKobo: 0n,
      allocations: [{ invoiceId: invoice.id, amountKobo: invoice.grossAmountKobo }], actor: maker,
    });
    const submitted = await receipts.submit({ receiptId: receipt.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    expect((await bankGlAccountsWithBalance(prisma, fixture.companyId)).find((a) => a.accountNumber === '10100')?.balanceKobo).toBe('10750000');
  });

  it('sells an item that names its own accounts to them: eggs to 40330, 50330 and 12420', async () => {
    await sell(eggItemId);
    expect(await balance('40330')).toBe(-10_000_000n);
    expect(await balance('50330')).toBe(6_000_000n);
    expect(await balance('12420')).toBe(-6_000_000n);
    expect(await balance('40000')).toBe(0n); // the default revenue account is untouched
    expect(await balance('50000')).toBe(0n);
  });

  it('keeps the receivables control equal to the open invoices', async () => {
    await sell(itemId);
    const rows = await reconciliation.reconcile(fixture.companyId);
    const receivables = rows.find((row) => row.accountNumber === '11000');
    expect(receivables, JSON.stringify(rows)).toBeDefined();
    expect(receivables!.reconciled).toBe(true);
  });
  it('recognises cost of sales once, at invoice, when the company chooses that point', async () => {
    await prisma.salesConfiguration.updateMany({ where: { companyId: fixture.companyId }, data: { cogsRecognitionPoint: CogsRecognitionPoint.INVOICE } });
    await sell(itemId);
    expect(await balance('50000')).toBe(6_000_000n);
    expect(await balance('12400')).toBe(-6_000_000n);
    expect((await trialBalance.build({ companyId: fixture.companyId })).balanced).toBe(true);
  });
});
