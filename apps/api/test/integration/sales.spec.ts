import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CogsRecognitionPoint,
  CreditNoteReason,
  PartyStatus,
  PrismaClient,
  QuotationStatus,
  ReceiptMethod,
  ReturnCondition,
  SalesInvoiceStatus,
  SalesOrderStatus,
  TaxType,
} from '@bioassetpro/database';
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
import { PartyService } from '../../src/masters/party.service';
import { RecipeService } from '../../src/masters/recipe.service';
import { SalesPricingService } from '../../src/sales/sales-pricing.service';
import { SalesOrderService } from '../../src/sales/sales-order.service';
import { DeliveryService } from '../../src/sales/delivery.service';
import { SalesInvoiceService } from '../../src/sales/sales-invoice.service';
import { CustomerReceiptService } from '../../src/sales/customer-receipt.service';
import { CreditNoteService } from '../../src/sales/credit-note.service';
import {
  CreditNotePostingHandler,
  CustomerReceiptPostingHandler,
  DeliveryPostingHandler,
  SalesInvoicePostingHandler,
} from '../../src/sales/sales.handlers';
import { WorkflowActor } from '../../src/workflow/workflow.types';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Phase 8 — Order-to-Cash (§6).
 *
 * The identity this phase must hold: cost of sales is recognised exactly ONCE
 * per movement of goods, whichever recognition point the company configures.
 * §6 instructs it to be posted at both delivery and invoice, so this suite
 * proves the resolution works in both directions and that the database refuses
 * a second recognition regardless.
 *
 * Alongside that: the trial balance still balances, the VAT register still
 * reconciles to the ledger (Phase 3's identity), and open-item ageing agrees
 * with the receivable control account.
 */
describe('Order-to-Cash (§6)', () => {
  let prisma: PrismaService;
  let orders: SalesOrderService;
  let deliveries: DeliveryService;
  let invoices: SalesInvoiceService;
  let receipts: CustomerReceiptService;
  let creditNotes: CreditNoteService;
  let workflow: WorkflowService;
  let trialBalance: TrialBalanceService;
  let registers: TaxRegisterService;
  let parties: PartyService;
  let fixture: TestFixture;

  let maker: WorkflowActor;
  let approver: WorkflowActor;

  let customerId: string;
  let itemId: string;
  let warehouseId: string;
  let vatPeriodId: string;

  const JAN = new Date('2026-01-15');

  // The item sells for ₦1,000.00 and costs ₦600.00.
  const UNIT_PRICE = 1_000_00n;
  const UNIT_COST = 600_00n;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const audit = new AuditService(prisma);
    const idempotency = new IdempotencyService(prisma);
    const periodService = new PeriodService(prisma);
    const dimensions = new DimensionValidatorService(prisma);
    const posting = new PostingService(prisma, audit, idempotency, periodService, dimensions);
    trialBalance = new TrialBalanceService(prisma);

    const routing = new WorkflowRoutingService(prisma);
    const delegations = new DelegationService(prisma, audit);
    const notifications = new NotificationService(prisma);
    workflow = new WorkflowService(prisma, routing, delegations, notifications, audit);

    const tax = new TaxEngineService(prisma);
    registers = new TaxRegisterService(prisma, tax);
    parties = new PartyService(prisma, audit);
    const recipes = new RecipeService(prisma, audit);
    const pricing = new SalesPricingService(prisma, tax);

    orders = new SalesOrderService(prisma, audit, workflow, parties, pricing);
    deliveries = new DeliveryService(prisma, audit, posting, workflow, recipes, pricing);
    invoices = new SalesInvoiceService(prisma, audit, posting, workflow, pricing, tax, registers);
    receipts = new CustomerReceiptService(prisma, audit, posting, workflow, pricing, registers);
    creditNotes = new CreditNoteService(
      prisma, audit, posting, workflow, pricing, tax, registers, recipes,
    );

    workflow.register(new DeliveryPostingHandler(deliveries));
    workflow.register(new SalesInvoicePostingHandler(invoices));
    workflow.register(new CustomerReceiptPostingHandler(receipts));
    workflow.register(new CreditNotePostingHandler(creditNotes));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);

    maker = { userId: fixture.makerId, roles: ['SALES_CLERK'] };
    const approverUser = await prisma.user.create({
      data: {
        email: 'sales-approver@test',
        fullName: 'Sales Approver',
        passwordHash: 'x',
        roles: ['FINANCE_MANAGER'],
      },
    });
    approver = { userId: approverUser.id, roles: approverUser.roles };

    await seedTax();
    await seedSalesConfiguration();
    await seedWorkflowRoutes();
    await seedMasters();
  });

  // -- fixtures -------------------------------------------------------------

  async function seedTax() {
    await prisma.taxConfiguration.create({
      data: {
        companyId: fixture.companyId,
        rounding: 'HALF_UP',
        whtBasis: 'NET_OF_VAT',
        effectiveFrom: new Date('2026-01-01'),
      },
    });

    const vat = await prisma.taxCode.create({
      data: {
        companyId: fixture.companyId,
        code: 'VAT-STD',
        name: 'VAT standard',
        taxType: TaxType.VAT,
        rates: { create: [{ rate: '0.07500000', effectiveFrom: new Date('2026-01-01') }] },
      },
    });
    await prisma.taxGLMapping.createMany({
      data: [
        {
          companyId: fixture.companyId,
          taxCodeId: vat.id,
          direction: 'INPUT',
          glAccountId: fixture.accounts['1601']!,
          effectiveFrom: new Date('2026-01-01'),
        },
        {
          companyId: fixture.companyId,
          taxCodeId: vat.id,
          direction: 'OUTPUT',
          glAccountId: fixture.accounts['2120']!,
          effectiveFrom: new Date('2026-01-01'),
        },
      ],
    });

    const wht = await prisma.taxCode.create({
      data: {
        companyId: fixture.companyId,
        code: 'WHT-CONTRACT',
        name: 'WHT contracts',
        taxType: TaxType.WHT,
        whtCategory: 'Contracts/Supplies',
      },
    });
    await prisma.taxGLMapping.createMany({
      data: [
        {
          companyId: fixture.companyId,
          taxCodeId: wht.id,
          direction: 'PAYABLE',
          glAccountId: fixture.accounts['2130']!,
          effectiveFrom: new Date('2026-01-01'),
        },
        {
          companyId: fixture.companyId,
          taxCodeId: wht.id,
          direction: 'RECEIVABLE',
          glAccountId: fixture.accounts['1602']!,
          effectiveFrom: new Date('2026-01-01'),
        },
      ],
    });

    const period = await prisma.taxPeriod.create({
      data: {
        companyId: fixture.companyId,
        taxType: TaxType.VAT,
        year: 2026,
        periodNumber: 1,
        name: 'January 2026',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
        dueDate: new Date('2026-02-21'),
      },
    });
    vatPeriodId = period.id;

    await prisma.taxPeriod.create({
      data: {
        companyId: fixture.companyId,
        taxType: TaxType.WHT,
        year: 2026,
        periodNumber: 1,
        name: 'January 2026',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-01-31'),
        dueDate: new Date('2026-02-21'),
      },
    });
  }

  async function seedSalesConfiguration(
    cogsRecognitionPoint: CogsRecognitionPoint = CogsRecognitionPoint.DELIVERY,
  ) {
    await prisma.salesConfiguration.deleteMany({ where: { companyId: fixture.companyId } });

    // A receivable account distinct from bank, so the AR control balance is a
    // meaningful figure rather than everything netted into one account.
    const receivable =
      (await prisma.gLAccount.findFirst({
        where: { companyId: fixture.companyId, accountNumber: '1201' },
      })) ??
      (await prisma.gLAccount.create({
        data: {
          companyId: fixture.companyId,
          accountNumber: '1201',
          name: 'Trade Receivables',
          accountType: 'ASSET',
          normalBalance: 'DEBIT',
        },
      }));
    fixture.accounts['1201'] = receivable.id;

    const costOfSales =
      (await prisma.gLAccount.findFirst({
        where: { companyId: fixture.companyId, accountNumber: '5001' },
      })) ??
      (await prisma.gLAccount.create({
        data: {
          companyId: fixture.companyId,
          accountNumber: '5001',
          name: 'Cost of Sales',
          accountType: 'EXPENSE',
          normalBalance: 'DEBIT',
        },
      }));
    fixture.accounts['5001'] = costOfSales.id;

    await prisma.salesConfiguration.create({
      data: {
        companyId: fixture.companyId,
        cogsRecognitionPoint,
        receivableGlAccountId: receivable.id,
        revenueGlAccountId: fixture.accounts['4101']!,
        costOfSalesGlAccountId: costOfSales.id,
        inventoryGlAccountId: fixture.accounts['1401']!,
        whtReceivableGlAccountId: fixture.accounts['1602']!,
        effectiveFrom: new Date('2026-01-01'),
      },
    });
  }

  async function seedWorkflowRoutes() {
    const types = [
      'SALES_QUOTATION',
      'SALES_ORDER',
      'SALES_ORDER_CREDIT_OVERRIDE',
      'GOODS_ISSUE',
      'SALES_INVOICE',
      'CUSTOMER_RECEIPT',
      'CREDIT_NOTE',
    ];
    for (const transactionType of types) {
      await prisma.workflowDefinition.create({
        data: {
          companyId: fixture.companyId,
          transactionType,
          name: `${transactionType} route`,
          // Quotations and orders approve without posting; the rest post.
          autoPostOnApproval: !['SALES_QUOTATION', 'SALES_ORDER', 'SALES_ORDER_CREDIT_OVERRIDE']
            .includes(transactionType),
          effectiveFrom: new Date('2026-01-01'),
          steps: {
            create: [
              {
                level: 1,
                roleCode: 'FINANCE_MANAGER',
                name: 'Finance Manager',
                maxAmountKobo: null,
              },
            ],
          },
        },
      });
    }
  }

  async function seedMasters() {
    const uom = await prisma.unitOfMeasure.create({
      data: { companyId: fixture.companyId, code: 'Unit', name: 'Unit', precision: 0 },
    });

    const warehouse = await prisma.warehouse.create({
      data: {
        companyId: fixture.companyId,
        branchId: fixture.branchId,
        code: 'FG-WH',
        name: 'Finished Goods',
        type: 'FINISHED_GOODS',
      },
    });
    warehouseId = warehouse.id;

    const vatCode = await prisma.taxCode.findFirstOrThrow({
      where: { companyId: fixture.companyId, code: 'VAT-STD' },
    });

    const item = await prisma.item.create({
      data: {
        companyId: fixture.companyId,
        code: 'FG-SLIME',
        description: 'Cosmetic Snail Slime 100ml',
        unitOfMeasureId: uom.id,
        isManufactured: true,
        vatTaxCodeId: vatCode.id,
        inventoryGlAccountId: fixture.accounts['1401']!,
        revenueGlAccountId: fixture.accounts['4101']!,
        standardCosts: {
          create: [{ standardCostKobo: UNIT_COST, effectiveFrom: new Date('2026-01-01') }],
        },
      },
    });
    itemId = item.id;

    await prisma.paymentTerm.create({
      data: { companyId: fixture.companyId, code: 'NET30', name: 'Net 30', netDays: 30 },
    });

    const customer = await parties.createCustomer({
      companyId: fixture.companyId,
      code: 'CUS-001',
      name: 'Lagos Distributors',
      creditLimit: 10_000_000_00n as never,
      currencyId: fixture.currencyId,
      paymentTermCode: 'NET30',
      tin: 'TIN-CUS-001',
      actorId: fixture.makerId,
    });
    customerId = customer.id;
  }

  // -- helpers --------------------------------------------------------------

  const period = () => ({
    financialYearId: fixture.financialYearId,
    financialPeriodId: fixture.periodIds[0]!,
  });

  /**
   * Stock at the delivery warehouse, checked since US-897-022
   * (`DeliveryService.create` refuses to take stock negative — Consolidated
   * Reference §14). Tagged `OpeningStock` so tests that count real stock
   * movements (a return, a delivery's own OUT) can exclude this fixture
   * receipt rather than mistake it for the thing under test.
   */
  async function receiveStock(quantity: number) {
    await prisma.stockMovement.create({
      data: {
        companyId: fixture.companyId,
        branchId: fixture.branchId,
        itemId,
        warehouseId,
        direction: 'IN',
        quantity: quantity.toString(),
        unitCostKobo: UNIT_COST,
        valueKobo: UNIT_COST * BigInt(quantity),
        sourceModule: 'test-fixture',
        sourceDocumentType: 'OpeningStock',
        sourceDocumentId: 'FIXTURE-STOCK-001',
        documentReference: 'Test fixture opening stock',
        movementDate: new Date('2026-01-01'),
      },
    });
  }

  async function makeApprovedOrder(quantity = 100, unitPrice = UNIT_PRICE) {
    await receiveStock(quantity);

    const order = await orders.createOrder({
      companyId: fixture.companyId,
      orderNumber: `SO-${Math.random().toString(36).slice(2, 8)}`,
      customerId,
      orderDate: JAN,
      currencyId: fixture.currencyId,
      branchId: fixture.branchId,
      warehouseId,
      costCentreId: fixture.costCentreId,
      lines: [{ lineNumber: 1, itemId, quantity, unitPriceKobo: unitPrice }],
      actor: maker,
    });

    const submitted = await orders.submitOrder({ salesOrderId: order.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.syncStatus(order.id);

    return prisma.salesOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { lines: true },
    });
  }

  async function deliverAll(orderId: string, deliveryNumber = 'DN-001') {
    const order = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: true },
    });

    const delivery = await deliveries.create({
      salesOrderId: order.id,
      deliveryNumber,
      deliveryDate: JAN,
      ...period(),
      lines: order.lines.map((line) => ({
        salesOrderLineId: line.id,
        quantity: line.quantity.toString(),
      })),
      actor: maker,
    });

    const submitted = await deliveries.submit({
      deliveryNoteId: delivery.id,
      actor: maker,
    });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.syncStatus(order.id);
    return delivery;
  }

  async function invoiceAll(orderId: string, invoiceNumber = 'INV-001') {
    const invoice = await invoices.createFromOrder({
      salesOrderId: orderId,
      invoiceNumber,
      invoiceDate: JAN,
      ...period(),
      actor: maker,
    });
    const submitted = await invoices.submit({ invoiceId: invoice.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    return prisma.salesInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
  }

  async function accountBalance(accountNumber: string): Promise<bigint> {
    const account = await prisma.gLAccount.findFirstOrThrow({
      where: { companyId: fixture.companyId, accountNumber },
    });
    const movement = await prisma.journalLine.aggregate({
      where: { glAccountId: account.id, journalEntry: { status: 'POSTED' } },
      _sum: { debitKobo: true, creditKobo: true },
    });
    return (movement._sum.debitKobo ?? 0n) - (movement._sum.creditKobo ?? 0n);
  }

  // =========================================================================

  describe('quotation and order (§6)', () => {
    it('prices a quotation with VAT from the shared engine', async () => {
      const quotation = await orders.createQuotation({
        companyId: fixture.companyId,
        quoteNumber: 'QT-001',
        customerId,
        quoteDate: JAN,
        validUntil: new Date('2026-02-15'),
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        lines: [{ lineNumber: 1, itemId, quantity: 100, unitPriceKobo: UNIT_PRICE }],
        actor: maker,
      });

      // 100 x ₦1,000 = ₦100,000 net; VAT at 7.5% = ₦7,500.
      expect(quotation.netAmountKobo).toBe(10_000_000n);
      expect(quotation.vatAmountKobo).toBe(750_000n);
      expect(quotation.grossAmountKobo).toBe(10_750_000n);
    });

    it('converts an approved quotation at the quoted price', async () => {
      const quotation = await orders.createQuotation({
        companyId: fixture.companyId,
        quoteNumber: 'QT-002',
        customerId,
        quoteDate: JAN,
        validUntil: new Date('2026-02-15'),
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        lines: [{ lineNumber: 1, itemId, quantity: 50, unitPriceKobo: UNIT_PRICE }],
        actor: maker,
      });
      const submitted = await orders.submitQuotation({
        quotationId: quotation.id,
        actor: maker,
      });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
      await prisma.salesQuotation.update({
        where: { id: quotation.id },
        data: { status: QuotationStatus.APPROVED },
      });

      const order = await orders.convertQuotation({
        quotationId: quotation.id,
        orderNumber: 'SO-FROM-QT',
        orderDate: JAN,
        warehouseId,
        actor: maker,
      });

      expect(order.grossAmountKobo).toBe(quotation.grossAmountKobo);
      const after = await prisma.salesQuotation.findUniqueOrThrow({
        where: { id: quotation.id },
      });
      expect(after.status).toBe(QuotationStatus.CONVERTED);
    });

    it('refuses to convert an expired quotation', async () => {
      const quotation = await orders.createQuotation({
        companyId: fixture.companyId,
        quoteNumber: 'QT-EXP',
        customerId,
        quoteDate: JAN,
        validUntil: new Date('2026-01-20'),
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        lines: [{ lineNumber: 1, itemId, quantity: 10, unitPriceKobo: UNIT_PRICE }],
        actor: maker,
      });
      await prisma.salesQuotation.update({
        where: { id: quotation.id },
        data: { status: QuotationStatus.APPROVED },
      });

      await expect(
        orders.convertQuotation({
          quotationId: quotation.id,
          orderNumber: 'SO-LATE',
          orderDate: new Date('2026-02-01'),
          warehouseId,
          actor: maker,
        }),
      ).rejects.toThrow(/expired/i);
    });

    it('refuses any sales document for a blocked customer', async () => {
      await parties.setCustomerStatus({
        customerId,
        status: PartyStatus.BLOCKED,
        reason: 'Overdue',
        actorId: fixture.makerId,
      });

      await expect(
        orders.createOrder({
          companyId: fixture.companyId,
          orderNumber: 'SO-BLOCKED',
          customerId,
          orderDate: JAN,
          currencyId: fixture.currencyId,
          branchId: fixture.branchId,
          warehouseId,
          lines: [{ lineNumber: 1, itemId, quantity: 1, unitPriceKobo: UNIT_PRICE }],
          actor: maker,
        }),
      ).rejects.toThrow(/BLOCKED/);
    });
  });

  describe('credit control routes rather than blocks (§6)', () => {
    it('routes a passing order to the standard ladder', async () => {
      const order = await orders.createOrder({
        companyId: fixture.companyId,
        orderNumber: 'SO-OK',
        customerId,
        orderDate: JAN,
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        warehouseId,
        lines: [{ lineNumber: 1, itemId, quantity: 10, unitPriceKobo: UNIT_PRICE }],
        actor: maker,
      });

      const submitted = await orders.submitOrder({ salesOrderId: order.id, actor: maker });
      expect(submitted.creditCheck.passed).toBe(true);
      expect(submitted.routedAs).toBe('SALES_ORDER');
    });

    it('routes a failing order to the credit override ladder, not to a refusal', async () => {
      await prisma.customer.update({
        where: { id: customerId },
        data: { creditLimitKobo: 100_00n, creditLimitSet: true },
      });

      const order = await orders.createOrder({
        companyId: fixture.companyId,
        orderNumber: 'SO-OVER',
        customerId,
        orderDate: JAN,
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        warehouseId,
        lines: [{ lineNumber: 1, itemId, quantity: 100, unitPriceKobo: UNIT_PRICE }],
        actor: maker,
      });

      const submitted = await orders.submitOrder({ salesOrderId: order.id, actor: maker });
      expect(submitted.creditCheck.passed).toBe(false);
      expect(submitted.routedAs).toBe('SALES_ORDER_CREDIT_OVERRIDE');

      const after = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.creditOverride).toBe(true);
      expect(after.creditCheckReasons).toMatch(/Credit limit exceeded/i);
    });
  });

  // =========================================================================

  describe('THE IDENTITY: cost of sales is recognised exactly once', () => {
    it('recognises at delivery when configured so, and not again at invoice', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);

      // 100 x ₦600 = ₦60,000.
      expect(await accountBalance('5001')).toBe(6_000_000n);
      expect(await accountBalance('1401')).toBe(-6_000_000n);

      await invoiceAll(order.id);

      // Unchanged by the invoice.
      expect(await accountBalance('5001')).toBe(6_000_000n);
      expect(await accountBalance('1401')).toBe(-6_000_000n);

      const lines = await prisma.deliveryNoteLine.findMany({});
      expect(lines.every((l) => l.cogsPostedAt === CogsRecognitionPoint.DELIVERY)).toBe(true);
    });

    it('recognises at invoice when configured so, and not at delivery', async () => {
      await seedSalesConfiguration(CogsRecognitionPoint.INVOICE);

      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);

      // Nothing has hit cost of sales yet.
      expect(await accountBalance('5001')).toBe(0n);

      await invoiceAll(order.id);

      expect(await accountBalance('5001')).toBe(6_000_000n);
      expect(await accountBalance('1401')).toBe(-6_000_000n);

      const lines = await prisma.deliveryNoteLine.findMany({});
      expect(lines.every((l) => l.cogsPostedAt === CogsRecognitionPoint.INVOICE)).toBe(true);
    });

    it('refuses a second recognition at the database, whatever the code does', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);

      const line = await prisma.deliveryNoteLine.findFirstOrThrow({});
      expect(line.cogsPostedAt).toBe(CogsRecognitionPoint.DELIVERY);

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE delivery_note_lines SET cogs_posted_at = 'INVOICE' WHERE id = $1::uuid`,
          line.id,
        ),
      ).rejects.toThrow(/already recognised/i);
    });

    it('leaves the trial balance balanced across the whole cycle', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      await receiveFull(invoice.id, 'RCT-001');

      const tb = await trialBalance.build({ companyId: fixture.companyId });
      expect(tb.balanced).toBe(true);
    });
  });

  // =========================================================================

  describe('invoice posting (§6)', () => {
    it('posts Dr Receivable / Cr Revenue / Cr Output VAT', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      expect(invoice.netAmountKobo).toBe(10_000_000n);
      expect(invoice.vatAmountKobo).toBe(750_000n);
      expect(invoice.grossAmountKobo).toBe(10_750_000n);

      expect(await accountBalance('1201')).toBe(10_750_000n);
      expect(await accountBalance('4101')).toBe(-10_000_000n);
      expect(await accountBalance('2120')).toBe(-750_000n);
    });

    it('writes a VAT register entry that reconciles to the ledger (Phase 3)', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      await invoiceAll(order.id);

      const register = await registers.vatRegister(fixture.companyId, vatPeriodId);
      expect(register.summary.outputTaxKobo).toBe('750000');

      const reconciliation = await registers.reconcile(fixture.companyId, vatPeriodId);
      expect(reconciliation.agrees).toBe(true);
    });

    it('invoices only what has been delivered', async () => {
      const order = await makeApprovedOrder(100);

      // Nothing delivered yet.
      await expect(
        invoices.createFromOrder({
          salesOrderId: order.id,
          invoiceNumber: 'INV-EARLY',
          invoiceDate: JAN,
          ...period(),
          actor: maker,
        }),
      ).rejects.toThrow(/nothing delivered and uninvoiced/i);

      // Deliver 40 of 100, then invoice: only 40 should bill.
      const line = order.lines[0]!;
      const delivery = await deliveries.create({
        salesOrderId: order.id,
        deliveryNumber: 'DN-PART',
        deliveryDate: JAN,
        ...period(),
        lines: [{ salesOrderLineId: line.id, quantity: 40 }],
        actor: maker,
      });
      const submitted = await deliveries.submit({
        deliveryNoteId: delivery.id,
        actor: maker,
      });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      const invoice = await invoiceAll(order.id, 'INV-PART');
      expect(invoice.netAmountKobo).toBe(4_000_000n); // 40 x ₦1,000
    });

    it('sets the due date from the customer payment terms', async () => {
      const order = await makeApprovedOrder(10);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      // NET30 from 15 January.
      expect(invoice.dueDate?.toISOString().slice(0, 10)).toBe('2026-02-14');
    });

    it('refuses to change a posted invoice, at the database', async () => {
      const order = await makeApprovedOrder(10);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE sales_invoices SET status = 'DRAFT' WHERE id = $1::uuid`,
          invoice.id,
        ),
      ).rejects.toThrow(/is posted/i);
    });
  });

  describe('delivery (§6)', () => {
    it('refuses over-delivery', async () => {
      const order = await makeApprovedOrder(100);
      const line = order.lines[0]!;

      await expect(
        deliveries.create({
          salesOrderId: order.id,
          deliveryNumber: 'DN-OVER',
          deliveryDate: JAN,
          ...period(),
          lines: [{ salesOrderLineId: line.id, quantity: 101 }],
          actor: maker,
        }),
      ).rejects.toThrow(/Over-delivery/i);
    });

    it('refuses delivery against an unapproved order', async () => {
      const order = await orders.createOrder({
        companyId: fixture.companyId,
        orderNumber: 'SO-DRAFT',
        customerId,
        orderDate: JAN,
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        warehouseId,
        lines: [{ lineNumber: 1, itemId, quantity: 10, unitPriceKobo: UNIT_PRICE }],
        actor: maker,
      });

      await expect(
        deliveries.create({
          salesOrderId: order.id,
          deliveryNumber: 'DN-DRAFT',
          deliveryDate: JAN,
          ...period(),
          lines: [{ salesOrderLineId: order.lines[0]!.id, quantity: 10 }],
          actor: maker,
        }),
      ).rejects.toThrow(/only delivered against an approved order/i);
    });

    it('records an outward stock movement and moves the order to delivered', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);

      // Excludes the fixture's own opening-stock receipt (makeApprovedOrder)
      // — this is about the delivery's OWN movement, not the stock it drew on.
      const movements = await prisma.stockMovement.findMany({
        where: { direction: 'OUT' },
      });
      expect(movements).toHaveLength(1);
      expect(movements[0]!.direction).toBe('OUT');
      expect(movements[0]!.valueKobo).toBe(6_000_000n);

      const onHand = await deliveries.stockOnHand({
        companyId: fixture.companyId,
        itemId,
      });
      // 100 received (fixture), 100 delivered — net zero.
      expect(onHand.quantity).toBe('0.000000');

      const after = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.status).toBe(SalesOrderStatus.FULLY_DELIVERED);
    });

    it('keeps the stock ledger append-only', async () => {
      const order = await makeApprovedOrder(10);
      await deliverAll(order.id);
      const movement = await prisma.stockMovement.findFirstOrThrow({});

      await expect(
        prisma.$executeRawUnsafe(
          `DELETE FROM stock_movements WHERE id = $1::uuid`,
          movement.id,
        ),
      ).rejects.toThrow(/append-only/i);
    });
  });

  // =========================================================================

  async function receiveFull(invoiceId: string, receiptNumber: string, wht = 0n) {
    const invoice = await prisma.salesInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    const open = invoice.grossAmountKobo - invoice.settledAmountKobo;

    const receipt = await receipts.create({
      companyId: fixture.companyId,
      receiptNumber,
      customerId,
      receiptDate: JAN,
      method: ReceiptMethod.BANK_TRANSFER,
      bankGlAccountId: fixture.accounts['1101']!,
      branchId: fixture.branchId,
      currencyId: fixture.currencyId,
      ...period(),
      amountKobo: open - wht,
      whtAmountKobo: wht,
      whtCreditNoteReference: wht > 0n ? 'WHT-CN-001' : null,
      whtCreditNoteDate: wht > 0n ? JAN : null,
      whtTaxCode: wht > 0n ? 'WHT-CONTRACT' : null,
      allocations: [{ invoiceId, amountKobo: open }],
      actor: maker,
    });

    const submitted = await receipts.submit({ receiptId: receipt.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    return receipt;
  }

  describe('customer receipt (§6)', () => {
    it('posts Dr Bank / Cr Receivable and settles the invoice', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      await receiveFull(invoice.id, 'RCT-001');

      expect(await accountBalance('1101')).toBe(10_750_000n);
      expect(await accountBalance('1201')).toBe(0n);

      const settled = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(settled.status).toBe(SalesInvoiceStatus.PAID);
      expect(settled.settledAmountKobo).toBe(settled.grossAmountKobo);
    });

    it('posts Dr Bank / Dr WHT Receivable / Cr Receivable when tax is withheld', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      // The customer withheld ₦5,000 and issued a certificate.
      await receiveFull(invoice.id, 'RCT-WHT', 500_000n);

      expect(await accountBalance('1101')).toBe(10_250_000n);
      expect(await accountBalance('1602')).toBe(500_000n);
      expect(await accountBalance('1201')).toBe(0n);

      const register = await registers.whtRegister(fixture.companyId, (
        await prisma.taxPeriod.findFirstOrThrow({
          where: { companyId: fixture.companyId, taxType: TaxType.WHT },
        })
      ).id);
      expect(register.summary.receivableKobo).toBe('500000');
      expect(register.summary.receivableWithoutCreditNote).toBe(0);
    });

    it('refuses withholding with no credit note reference', async () => {
      const order = await makeApprovedOrder(10);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);
      const open = invoice.grossAmountKobo;

      await expect(
        receipts.create({
          companyId: fixture.companyId,
          receiptNumber: 'RCT-NOCN',
          customerId,
          receiptDate: JAN,
          method: ReceiptMethod.BANK_TRANSFER,
          bankGlAccountId: fixture.accounts['1101']!,
          branchId: fixture.branchId,
          currencyId: fixture.currencyId,
          ...period(),
          amountKobo: open - 100_00n,
          whtAmountKobo: 100_00n,
          allocations: [{ invoiceId: invoice.id, amountKobo: open }],
          actor: maker,
        }),
      ).rejects.toThrow(/WHT credit note reference/i);
    });

    it('refuses allocations that do not total the receipt', async () => {
      const order = await makeApprovedOrder(10);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      await expect(
        receipts.create({
          companyId: fixture.companyId,
          receiptNumber: 'RCT-MISMATCH',
          customerId,
          receiptDate: JAN,
          method: ReceiptMethod.CASH,
          bankGlAccountId: fixture.accounts['1101']!,
          branchId: fixture.branchId,
          currencyId: fixture.currencyId,
          ...period(),
          amountKobo: 1_000_00n,
          allocations: [{ invoiceId: invoice.id, amountKobo: 500_00n }],
          actor: maker,
        }),
      ).rejects.toThrow(/Every kobo of a receipt must be allocated/i);
    });

    it('refuses over-allocation to an invoice', async () => {
      const order = await makeApprovedOrder(10);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);
      const tooMuch = invoice.grossAmountKobo + 1_00n;

      await expect(
        receipts.create({
          companyId: fixture.companyId,
          receiptNumber: 'RCT-OVER',
          customerId,
          receiptDate: JAN,
          method: ReceiptMethod.CASH,
          bankGlAccountId: fixture.accounts['1101']!,
          branchId: fixture.branchId,
          currencyId: fixture.currencyId,
          ...period(),
          amountKobo: tooMuch,
          allocations: [{ invoiceId: invoice.id, amountKobo: tooMuch }],
          actor: maker,
        }),
      ).rejects.toThrow(/only .* is outstanding/i);
    });

    it('marks an invoice part-paid on a partial receipt', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      const receipt = await receipts.create({
        companyId: fixture.companyId,
        receiptNumber: 'RCT-PART',
        customerId,
        receiptDate: JAN,
        method: ReceiptMethod.BANK_TRANSFER,
        bankGlAccountId: fixture.accounts['1101']!,
        branchId: fixture.branchId,
        currencyId: fixture.currencyId,
        ...period(),
        amountKobo: 5_000_000n,
        allocations: [{ invoiceId: invoice.id, amountKobo: 5_000_000n }],
        actor: maker,
      });
      const submitted = await receipts.submit({ receiptId: receipt.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      const after = await prisma.salesInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(after.status).toBe(SalesInvoiceStatus.PART_PAID);
      expect(await accountBalance('1201')).toBe(5_750_000n);
    });
  });

  // =========================================================================

  describe('credit note and sales return (§6)', () => {
    it('posts Dr Revenue / Dr Output VAT / Cr Receivable for a pricing error', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      const creditNote = await creditNotes.create({
        companyId: fixture.companyId,
        creditNoteNumber: 'CN-001',
        customerId,
        invoiceId: invoice.id,
        creditNoteDate: JAN,
        reason: CreditNoteReason.PRICING_ERROR,
        branchId: fixture.branchId,
        currencyId: fixture.currencyId,
        ...period(),
        lines: [{ lineNumber: 1, itemId, quantity: 10, unitPriceKobo: UNIT_PRICE }],
        actor: maker,
      });

      const submitted = await creditNotes.submit({
        creditNoteId: creditNote.id,
        actor: maker,
      });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      // ₦10,000 net credited plus ₦750 VAT.
      expect(await accountBalance('4101')).toBe(-9_000_000n);
      expect(await accountBalance('2120')).toBe(-675_000n);
      expect(await accountBalance('1201')).toBe(9_675_000n);

      // No goods came back, so cost of sales is untouched.
      expect(await accountBalance('5001')).toBe(6_000_000n);
    });

    it('returns resaleable goods to stock and reverses their cost', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      const creditNote = await creditNotes.create({
        companyId: fixture.companyId,
        creditNoteNumber: 'CN-RET',
        customerId,
        invoiceId: invoice.id,
        creditNoteDate: JAN,
        reason: CreditNoteReason.RETURNED_GOODS,
        branchId: fixture.branchId,
        currencyId: fixture.currencyId,
        ...period(),
        lines: [{ lineNumber: 1, itemId, quantity: 10, unitPriceKobo: UNIT_PRICE }],
        salesReturn: {
          returnNumber: 'RET-001',
          warehouseId,
          returnDate: JAN,
          lines: [
            { itemId, quantity: 10, condition: ReturnCondition.RESALEABLE },
          ],
        },
        actor: maker,
      });

      const submitted = await creditNotes.submit({
        creditNoteId: creditNote.id,
        actor: maker,
      });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      // 10 x ₦600 = ₦6,000 back into stock, off cost of sales.
      expect(await accountBalance('5001')).toBe(5_400_000n);
      expect(await accountBalance('1401')).toBe(-5_400_000n);

      // Excludes the fixture's own opening-stock receipt — this is about the
      // return's OWN inward movement.
      const inward = await prisma.stockMovement.findMany({
        where: { direction: 'IN', sourceDocumentType: { not: 'OpeningStock' } },
      });
      expect(inward).toHaveLength(1);
      expect(inward[0]!.valueKobo).toBe(600_000n);
    });

    it('does not return damaged goods to stock at cost', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      const creditNote = await creditNotes.create({
        companyId: fixture.companyId,
        creditNoteNumber: 'CN-DMG',
        customerId,
        invoiceId: invoice.id,
        creditNoteDate: JAN,
        reason: CreditNoteReason.RETURNED_GOODS,
        branchId: fixture.branchId,
        currencyId: fixture.currencyId,
        ...period(),
        lines: [{ lineNumber: 1, itemId, quantity: 10, unitPriceKobo: UNIT_PRICE }],
        salesReturn: {
          returnNumber: 'RET-DMG',
          warehouseId,
          returnDate: JAN,
          lines: [{ itemId, quantity: 10, condition: ReturnCondition.DAMAGED }],
        },
        actor: maker,
      });

      const submitted = await creditNotes.submit({
        creditNoteId: creditNote.id,
        actor: maker,
      });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      // Customer credited, but the goods are worthless — cost of sales stands.
      expect(await accountBalance('5001')).toBe(6_000_000n);
      expect(
        await prisma.stockMovement.count({
          where: { direction: 'IN', sourceDocumentType: { not: 'OpeningStock' } },
        }),
      ).toBe(0);
    });

    it('requires a return document when the reason is returned goods', async () => {
      const order = await makeApprovedOrder(10);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      await expect(
        creditNotes.create({
          companyId: fixture.companyId,
          creditNoteNumber: 'CN-NORET',
          customerId,
          invoiceId: invoice.id,
          creditNoteDate: JAN,
          reason: CreditNoteReason.RETURNED_GOODS,
          branchId: fixture.branchId,
          currencyId: fixture.currencyId,
          ...period(),
          lines: [{ lineNumber: 1, itemId, quantity: 1, unitPriceKobo: UNIT_PRICE }],
          actor: maker,
        }),
      ).rejects.toThrow(/must record the return itself/i);
    });

    it('records the VAT reduction as a tax adjustment, not a negative register row', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);

      const creditNote = await creditNotes.create({
        companyId: fixture.companyId,
        creditNoteNumber: 'CN-VAT',
        customerId,
        invoiceId: invoice.id,
        creditNoteDate: JAN,
        reason: CreditNoteReason.PRICING_ERROR,
        branchId: fixture.branchId,
        currencyId: fixture.currencyId,
        ...period(),
        lines: [{ lineNumber: 1, itemId, quantity: 10, unitPriceKobo: UNIT_PRICE }],
        actor: maker,
      });
      const submitted = await creditNotes.submit({
        creditNoteId: creditNote.id,
        actor: maker,
      });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      const adjustments = await prisma.taxAdjustment.findMany({});
      expect(adjustments).toHaveLength(1);
      expect(adjustments[0]!.taxKobo).toBe(-75_000n);
    });
  });

  // =========================================================================

  describe('open-item ageing agrees with the receivable control account', () => {
    it('ages each invoice by its own due date', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      await invoiceAll(order.id, 'INV-AGE-1');

      const second = await makeApprovedOrder(50);
      await deliverAll(second.id, 'DN-002');
      await invoiceAll(second.id, 'INV-AGE-2');

      const ageing = await receipts.ageing({
        companyId: fixture.companyId,
        asAt: new Date('2026-03-31'),
      });

      expect(ageing).toHaveLength(1);
      const customerRow = ageing[0]!;
      expect(customerRow.invoices).toHaveLength(2);

      // Both invoices are due 14 February, so at 31 March both are 45 days old
      // — the 30-59 bucket, aged from the DUE date and not the invoice date.
      const bucketTotal = customerRow.buckets.reduce(
        (s, b) => s + BigInt(b.amountKobo),
        0n,
      );
      expect(bucketTotal.toString()).toBe(customerRow.totalKobo);

      // The open-item total must equal the AR control account.
      expect(BigInt(customerRow.totalKobo)).toBe(await accountBalance('1201'));
    });

    it('drops a fully settled invoice out of the ageing', async () => {
      const order = await makeApprovedOrder(100);
      await deliverAll(order.id);
      const invoice = await invoiceAll(order.id);
      await receiveFull(invoice.id, 'RCT-CLEAR');

      const ageing = await receipts.ageing({
        companyId: fixture.companyId,
        asAt: new Date('2026-03-31'),
      });
      expect(ageing).toHaveLength(0);
      expect(await accountBalance('1201')).toBe(0n);
    });
  });
});
