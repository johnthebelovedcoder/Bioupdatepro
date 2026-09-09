import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ItemType,
  MatchStatus,
  PartyStatus,
  PaymentMethod,
  PrismaClient,
  PurchaseOrderStatus,
  QualityStatus,
  SupplierInvoiceStatus,
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
import { ProcurementConfigService } from '../../src/procurement/procurement-config.service';
import { PurchaseOrderService } from '../../src/procurement/purchase-order.service';
import { GoodsReceiptService } from '../../src/procurement/goods-receipt.service';
import { StockMovementService } from '../../src/inventory/stock-movement.service';
import { SupplierInvoiceService } from '../../src/procurement/supplier-invoice.service';
import { SupplierPaymentService } from '../../src/procurement/supplier-payment.service';
import {
  GoodsReceiptExceptionPostingHandler,
  GoodsReceiptPostingHandler,
  SupplierInvoiceExceptionPostingHandler,
  SupplierInvoicePostingHandler,
  SupplierPaymentPostingHandler,
} from '../../src/procurement/procurement.handlers';
import { WorkflowActor } from '../../src/workflow/workflow.types';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Phase 7 — Procure-to-Pay (§5).
 *
 * THE IDENTITY: for a purchase order fully received and fully invoiced, the
 * GRNI balance must be exactly zero.
 *
 * §5 instructs both the receipt AND the invoice to debit inventory, which would
 * recognise it twice. GRNI — the account §5 itself names — is the resolution:
 * receipt debits inventory and credits GRNI, invoice debits GRNI to clear it.
 * These tests prove it clears, that it does not clear early on a part invoice,
 * and that the database refuses over-invoicing that would take it negative.
 */
describe('Procure-to-Pay (§5)', () => {
  let prisma: PrismaService;
  let orders: PurchaseOrderService;
  let receipts: GoodsReceiptService;
  let invoices: SupplierInvoiceService;
  let payments: SupplierPaymentService;
  let workflow: WorkflowService;
  let trialBalance: TrialBalanceService;
  let registers: TaxRegisterService;
  let parties: PartyService;
  let fixture: TestFixture;

  let maker: WorkflowActor;
  let approver: WorkflowActor;

  let supplierId: string;
  let inventoryItemId: string;
  let expenseItemId: string;
  let warehouseId: string;
  let vatPeriodId: string;
  let whtPeriodId: string;

  const JAN = new Date('2026-01-15');

  // 100 units at ₦600.00 = ₦60,000.00 net, VAT 7.5% = ₦4,500.00.
  const UNIT_PRICE = 600_00n;
  const QUANTITY = 100;

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
    const config = new ProcurementConfigService(prisma);

    const stockMovements = new StockMovementService(prisma);

    orders = new PurchaseOrderService(prisma, audit, workflow, tax);
    receipts = new GoodsReceiptService(prisma, audit, posting, workflow, config, stockMovements);
    invoices = new SupplierInvoiceService(
      prisma, audit, posting, workflow, tax, registers, config,
    );
    payments = new SupplierPaymentService(
      prisma, audit, posting, workflow, tax, registers, config,
    );

    workflow.register(new GoodsReceiptPostingHandler(receipts));
    workflow.register(new GoodsReceiptExceptionPostingHandler(receipts));
    workflow.register(new SupplierInvoicePostingHandler(invoices));
    workflow.register(new SupplierInvoiceExceptionPostingHandler(invoices));
    workflow.register(new SupplierPaymentPostingHandler(payments));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);

    maker = { userId: fixture.makerId, roles: ['BUYER'] };
    const approverUser = await prisma.user.create({
      data: {
        email: 'p2p-approver@test',
        fullName: 'P2P Approver',
        passwordHash: 'x',
        roles: ['FINANCE_MANAGER'],
      },
    });
    approver = { userId: approverUser.id, roles: approverUser.roles };

    await seedTax();
    await seedProcurementConfig();
    await seedWorkflowRoutes();
    await seedMasters();
  });

  // -- fixtures -------------------------------------------------------------

  async function seedTax(withWhtRate = false) {
    await prisma.taxConfiguration.deleteMany({ where: { companyId: fixture.companyId } });
    await prisma.taxConfiguration.create({
      data: {
        companyId: fixture.companyId,
        rounding: 'HALF_UP',
        whtBasis: 'NET_OF_VAT',
        effectiveFrom: new Date('2026-01-01'),
      },
    });

    const existingVat = await prisma.taxCode.findFirst({
      where: { companyId: fixture.companyId, code: 'VAT-STD' },
    });
    if (!existingVat) {
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
            companyId: fixture.companyId, taxCodeId: vat.id, direction: 'INPUT',
            glAccountId: fixture.accounts['1601']!, effectiveFrom: new Date('2026-01-01'),
          },
          {
            companyId: fixture.companyId, taxCodeId: vat.id, direction: 'OUTPUT',
            glAccountId: fixture.accounts['2120']!, effectiveFrom: new Date('2026-01-01'),
          },
        ],
      });
    }

    const existingWht = await prisma.taxCode.findFirst({
      where: { companyId: fixture.companyId, code: 'WHT-CONTRACT' },
    });
    if (!existingWht) {
      const wht = await prisma.taxCode.create({
        data: {
          companyId: fixture.companyId,
          code: 'WHT-CONTRACT',
          name: 'WHT contracts',
          taxType: TaxType.WHT,
          whtCategory: 'Contracts/Supplies',
          // Rates are deliberately absent by default — Phase 3's blocker.
          ...(withWhtRate
            ? { rates: { create: [{ rate: '0.05000000', effectiveFrom: new Date('2026-01-01') }] } }
            : {}),
        },
      });
      await prisma.taxGLMapping.createMany({
        data: [
          {
            companyId: fixture.companyId, taxCodeId: wht.id, direction: 'PAYABLE',
            glAccountId: fixture.accounts['2130']!, effectiveFrom: new Date('2026-01-01'),
          },
          {
            companyId: fixture.companyId, taxCodeId: wht.id, direction: 'RECEIVABLE',
            glAccountId: fixture.accounts['1602']!, effectiveFrom: new Date('2026-01-01'),
          },
        ],
      });
    }

    for (const [taxType, holder] of [['VAT', 'vat'], ['WHT', 'wht']] as const) {
      const existing = await prisma.taxPeriod.findFirst({
        where: { companyId: fixture.companyId, taxType },
      });
      const period =
        existing ??
        (await prisma.taxPeriod.create({
          data: {
            companyId: fixture.companyId,
            taxType,
            year: 2026,
            periodNumber: 1,
            name: 'January 2026',
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-01-31'),
            dueDate: new Date('2026-02-21'),
          },
        }));
      if (holder === 'vat') vatPeriodId = period.id;
      else whtPeriodId = period.id;
    }
  }

  /** Adds a WHT rate so payments that withhold can be tested. */
  async function addWhtRate(rate = '0.05000000') {
    const wht = await prisma.taxCode.findFirstOrThrow({
      where: { companyId: fixture.companyId, code: 'WHT-CONTRACT' },
    });
    await prisma.taxRate.create({
      data: { taxCodeId: wht.id, rate, effectiveFrom: new Date('2026-01-01') },
    });
  }

  async function seedProcurementConfig(overrides: Record<string, unknown> = {}) {
    await prisma.procurementConfiguration.deleteMany({
      where: { companyId: fixture.companyId },
    });

    const ensure = async (
      number: string,
      name: string,
      type: string,
      normal: string,
    ) => {
      const existing = await prisma.gLAccount.findFirst({
        where: { companyId: fixture.companyId, accountNumber: number },
      });
      const account =
        existing ??
        (await prisma.gLAccount.create({
          data: {
            companyId: fixture.companyId,
            accountNumber: number,
            name,
            accountType: type as never,
            normalBalance: normal as never,
          },
        }));
      fixture.accounts[number] = account.id;
      return account.id;
    };

    const grni = await ensure('2140', 'Goods Received Not Invoiced', 'LIABILITY', 'CREDIT');
    const payables = await ensure('2201', 'Trade Payables', 'LIABILITY', 'CREDIT');
    await ensure('5401', 'Operating Expenses', 'EXPENSE', 'DEBIT');

    await prisma.procurementConfiguration.create({
      data: {
        companyId: fixture.companyId,
        grniGlAccountId: grni,
        payablesGlAccountId: payables,
        whtPayableGlAccountId: fixture.accounts['2130']!,
        effectiveFrom: new Date('2026-01-01'),
        ...overrides,
      },
    });
  }

  async function seedWorkflowRoutes() {
    const types = [
      'PURCHASE_REQUISITION',
      'PURCHASE_ORDER',
      'GOODS_RECEIPT',
      'GOODS_RECEIPT_EXCEPTION',
      'SUPPLIER_INVOICE',
      'SUPPLIER_INVOICE_EXCEPTION',
      'SUPPLIER_PAYMENT',
    ];
    for (const transactionType of types) {
      await prisma.workflowDefinition.create({
        data: {
          companyId: fixture.companyId,
          transactionType,
          name: `${transactionType} route`,
          autoPostOnApproval: !['PURCHASE_REQUISITION', 'PURCHASE_ORDER'].includes(
            transactionType,
          ),
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
        code: 'RAW-WH',
        name: 'Raw Material Store',
        type: 'RAW_MATERIAL',
      },
    });
    warehouseId = warehouse.id;

    const vatCode = await prisma.taxCode.findFirstOrThrow({
      where: { companyId: fixture.companyId, code: 'VAT-STD' },
    });

    const inventoryItem = await prisma.item.create({
      data: {
        companyId: fixture.companyId,
        code: 'RM-SLIME',
        description: 'Fresh Snail Slime',
        unitOfMeasureId: uom.id,
        itemType: ItemType.INVENTORY,
        vatTaxCodeId: vatCode.id,
        inventoryGlAccountId: fixture.accounts['1301']!,
        standardCosts: {
          create: [{ standardCostKobo: UNIT_PRICE, effectiveFrom: new Date('2026-01-01') }],
        },
      },
    });
    inventoryItemId = inventoryItem.id;

    const expenseItem = await prisma.item.create({
      data: {
        companyId: fixture.companyId,
        code: 'SVC-CLEAN',
        description: 'Cleaning service',
        unitOfMeasureId: uom.id,
        itemType: ItemType.EXPENSE,
        vatTaxCodeId: vatCode.id,
        expenseGlAccountId: fixture.accounts['5401']!,
      },
    });
    expenseItemId = expenseItem.id;

    await prisma.paymentTerm.create({
      data: { companyId: fixture.companyId, code: 'NET30', name: 'Net 30', netDays: 30 },
    });

    const supplier = await parties.createSupplier({
      companyId: fixture.companyId,
      code: 'SUP-001',
      name: 'Shell Supplies Ltd',
      tin: 'TIN-SUP-001',
      paymentTermCode: 'NET30',
      defaultCurrencyId: fixture.currencyId,
      actorId: fixture.makerId,
    });
    supplierId = supplier.id;
  }

  // -- helpers --------------------------------------------------------------

  const period = () => ({
    financialYearId: fixture.financialYearId,
    financialPeriodId: fixture.periodIds[0]!,
  });

  async function approvedOrder(
    itemId = inventoryItemId,
    quantity = QUANTITY,
    unitPrice = UNIT_PRICE,
  ) {
    const order = await orders.createOrder({
      companyId: fixture.companyId,
      orderNumber: `PO-${Math.random().toString(36).slice(2, 8)}`,
      supplierId,
      orderDate: JAN,
      currencyId: fixture.currencyId,
      branchId: fixture.branchId,
      warehouseId,
      costCentreId: fixture.costCentreId,
      lines: [{ itemId, quantity, unitPriceKobo: unitPrice }],
      actor: maker,
    });

    const submitted = await orders.submitOrder({
      purchaseOrderId: order.id,
      actor: maker,
    });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.syncStatus(order.id);

    return prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { lines: true },
    });
  }

  async function receiveAll(
    orderId: string,
    grnNumber = 'GRN-001',
    quantity?: number,
    rejected = 0,
  ) {
    const order = await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { lines: true },
    });

    const grn = await receipts.create({
      purchaseOrderId: order.id,
      grnNumber,
      receiptDate: JAN,
      ...period(),
      qualityStatus: QualityStatus.PASSED,
      lines: order.lines.map((line) => ({
        purchaseOrderLineId: line.id,
        receivedQuantity: quantity ?? Number(line.quantity),
        rejectedQuantity: rejected,
      })),
      actor: maker,
    });

    const submitted = await receipts.submit({ grnId: grn.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.syncStatus(order.id);

    return prisma.goodsReceiptNote.findUniqueOrThrow({
      where: { id: grn.id },
      include: { lines: true },
    });
  }

  async function invoiceFromGrn(
    orderId: string,
    grnId: string,
    invoiceNumber = 'SI-001',
    overrides: { unitPriceKobo?: bigint; quantity?: number } = {},
  ) {
    const grn = await prisma.goodsReceiptNote.findUniqueOrThrow({
      where: { id: grnId },
      include: { lines: true },
    });

    const invoice = await invoices.create({
      companyId: fixture.companyId,
      invoiceNumber,
      supplierInvoiceNumber: `SUP-${invoiceNumber}`,
      supplierId,
      purchaseOrderId: orderId,
      invoiceDate: JAN,
      currencyId: fixture.currencyId,
      branchId: fixture.branchId,
      costCentreId: fixture.costCentreId,
      ...period(),
      lines: grn.lines.map((line) => ({
        goodsReceiptNoteLineId: line.id,
        quantity: overrides.quantity ?? Number(line.acceptedQuantity),
        unitPriceKobo: overrides.unitPriceKobo ?? line.unitPriceKobo,
      })),
      actor: maker,
    });

    const submitted = await invoices.submit({ invoiceId: invoice.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

    return {
      invoice: await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } }),
      match: submitted.match,
      routedAs: submitted.routedAs,
    };
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

  describe('THE IDENTITY: GRNI clears to zero', () => {
    it('receipt debits inventory and credits GRNI', async () => {
      const order = await approvedOrder();
      await receiveAll(order.id);

      // 100 x ₦600 = ₦60,000.
      expect(await accountBalance('1301')).toBe(6_000_000n);
      expect(await accountBalance('2140')).toBe(-6_000_000n);

      const balance = await receipts.grniBalance(order.id);
      expect(balance.outstandingKobo).toBe('6000000');
    });

    it('invoice clears GRNI to exactly zero, without touching inventory again', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);

      const inventoryAfterReceipt = await accountBalance('1301');
      await invoiceFromGrn(order.id, grn.id);

      // GRNI back to zero.
      expect(await accountBalance('2140')).toBe(0n);
      const balance = await receipts.grniBalance(order.id);
      expect(balance.outstandingKobo).toBe('0');

      // Inventory recognised ONCE, at receipt — unchanged by the invoice.
      expect(await accountBalance('1301')).toBe(inventoryAfterReceipt);
      expect(await accountBalance('1301')).toBe(6_000_000n);

      // Payables and input VAT are what the invoice added.
      expect(await accountBalance('2201')).toBe(-6_450_000n); // 60,000 + 4,500 VAT
      expect(await accountBalance('1601')).toBe(450_000n);

      const tb = await trialBalance.build({ companyId: fixture.companyId });
      expect(tb.balanced).toBe(true);
    });

    it('leaves GRNI outstanding when only part is invoiced', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);

      await invoiceFromGrn(order.id, grn.id, 'SI-PART', { quantity: 40 });

      // 60 units still received-but-uninvoiced: 60 x ₦600 = ₦36,000.
      expect(await accountBalance('2140')).toBe(-3_600_000n);
      const balance = await receipts.grniBalance(order.id);
      expect(balance.outstandingKobo).toBe('3600000');
    });

    it('refuses invoicing more than was received, at the database', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);
      const line = grn.lines[0]!;

      await expect(
        prisma.goodsReceiptNoteLine.update({
          where: { id: line.id },
          data: { invoicedQuantity: 101 },
        }),
      ).rejects.toThrow();
    });

    it('excludes rejected goods from stock and from GRNI', async () => {
      const order = await approvedOrder();
      await receiveAll(order.id, 'GRN-REJ', 100, 20);

      // 80 accepted x ₦600 = ₦48,000. The 20 rejected were never ours to owe.
      expect(await accountBalance('1301')).toBe(4_800_000n);
      expect(await accountBalance('2140')).toBe(-4_800_000n);

      const movements = await prisma.stockMovement.findMany({ where: { direction: 'IN' } });
      expect(movements[0]!.quantity.toString()).toBe('80');
    });

    it('posts nothing at receipt for an expense item', async () => {
      const order = await approvedOrder(expenseItemId, 10, 1_000_00n);
      const grn = await receiveAll(order.id, 'GRN-EXP');

      // §5: expense items await the supplier invoice.
      expect(await accountBalance('2140')).toBe(0n);
      expect(await accountBalance('5401')).toBe(0n);
      expect(await prisma.stockMovement.count()).toBe(0);

      await invoiceFromGrn(order.id, grn.id, 'SI-EXP');

      // Now the expense lands, and payables with it.
      expect(await accountBalance('5401')).toBe(1_000_000n);
      expect(await accountBalance('2140')).toBe(0n);
    });
  });

  // =========================================================================

  describe('the inward stock flow', () => {
    it('makes stock on hand a real figure', async () => {
      const order = await approvedOrder();
      await receiveAll(order.id);

      const movements = await prisma.stockMovement.findMany({});
      expect(movements).toHaveLength(1);
      expect(movements[0]!.direction).toBe('IN');
      expect(movements[0]!.valueKobo).toBe(6_000_000n);
      expect(movements[0]!.quantity.toString()).toBe('100');
    });

    it('refuses receipt against an unapproved order', async () => {
      const order = await orders.createOrder({
        companyId: fixture.companyId,
        orderNumber: 'PO-DRAFT',
        supplierId,
        orderDate: JAN,
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        warehouseId,
        lines: [{ itemId: inventoryItemId, quantity: 10, unitPriceKobo: UNIT_PRICE }],
        actor: maker,
      });

      await expect(
        receipts.create({
          purchaseOrderId: order.id,
          grnNumber: 'GRN-DRAFT',
          receiptDate: JAN,
          ...period(),
          lines: [{ purchaseOrderLineId: order.lines[0]!.id, receivedQuantity: 10 }],
          actor: maker,
        }),
      ).rejects.toThrow(/only received against an approved order/i);
    });

    it('flags an over-receipt beyond tolerance rather than refusing it, and routes to the exception ladder', async () => {
      const order = await approvedOrder();

      const grn = await receipts.create({
        purchaseOrderId: order.id,
        grnNumber: 'GRN-OVER',
        receiptDate: JAN,
        ...period(),
        qualityStatus: QualityStatus.PASSED,
        lines: [{ purchaseOrderLineId: order.lines[0]!.id, receivedQuantity: 101 }],
        actor: maker,
      });
      expect(grn.overTolerance).toBe(true);
      expect(grn.toleranceNote).toMatch(/101\.000000 against 100\.000000 ordered/);

      const submitted = await receipts.submit({ grnId: grn.id, actor: maker });
      expect(submitted.routedAs).toBe('GOODS_RECEIPT_EXCEPTION');
    });

    it('allows over-receipt within a configured tolerance', async () => {
      await seedProcurementConfig({ overReceiptTolerancePercent: '5' });
      const order = await approvedOrder();

      const grn = await receipts.create({
        purchaseOrderId: order.id,
        grnNumber: 'GRN-TOL',
        receiptDate: JAN,
        ...period(),
        qualityStatus: QualityStatus.PASSED,
        lines: [{ purchaseOrderLineId: order.lines[0]!.id, receivedQuantity: 104 }],
        actor: maker,
      });
      expect(grn.lines[0]!.receivedQuantity.toString()).toBe('104');
      expect(grn.overTolerance).toBe(false);
    });

    it('refuses to submit goods still awaiting inspection', async () => {
      const order = await approvedOrder();
      const grn = await receipts.create({
        purchaseOrderId: order.id,
        grnNumber: 'GRN-PENDING',
        receiptDate: JAN,
        ...period(),
        lines: [{ purchaseOrderLineId: order.lines[0]!.id, receivedQuantity: 10 }],
        actor: maker,
      });

      await expect(
        receipts.submit({ grnId: grn.id, actor: maker }),
      ).rejects.toThrow(/awaiting quality inspection/i);
    });

    it('moves the order to fully received', async () => {
      const order = await approvedOrder();
      await receiveAll(order.id);

      const after = await prisma.purchaseOrder.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(after.status).toBe(PurchaseOrderStatus.FULLY_RECEIVED);
    });
  });

  // =========================================================================

  describe('moving weighted-average cost (US-897-007)', () => {
    it('sets the item WAC to the received unit cost on the first receipt', async () => {
      const order = await approvedOrder();
      await receiveAll(order.id);

      const item = await prisma.item.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.weightedAverageCostKobo).toBe(UNIT_PRICE);
      expect(item.weightedAverageCostSetAt).not.toBeNull();
    });

    it('rolls the WAC forward as a moving average across two receipts at different prices', async () => {
      const first = await approvedOrder(inventoryItemId, 100, 600_00n);
      await receiveAll(first.id, 'GRN-WAC-1', 100);

      // (100 x 600) + (100 x 900) over 200 units = 750/unit.
      const second = await approvedOrder(inventoryItemId, 100, 900_00n);
      await receiveAll(second.id, 'GRN-WAC-2', 100);

      const item = await prisma.item.findUniqueOrThrow({ where: { id: inventoryItemId } });
      expect(item.weightedAverageCostKobo).toBe(750_00n);
    });
  });

  // =========================================================================

  describe('three-way match (§5)', () => {
    it('matches cleanly and takes the standard route', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);
      const result = await invoiceFromGrn(order.id, grn.id);

      expect(result.match.status).toBe(MatchStatus.MATCHED);
      expect(result.match.findings).toHaveLength(0);
      expect(result.routedAs).toBe('SUPPLIER_INVOICE');
    });

    it('flags a price variance and routes to the exception ladder', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);

      // Supplier invoices at ₦660 against ₦600 ordered — a 10% overcharge.
      const result = await invoiceFromGrn(order.id, grn.id, 'SI-PRICE', {
        unitPriceKobo: 660_00n,
      });

      expect(result.match.status).toBe(MatchStatus.EXCEPTION);
      expect(result.routedAs).toBe('SUPPLIER_INVOICE_EXCEPTION');

      const priceFinding = result.match.findings.find((f) => f.field === 'PRICE')!;
      expect(priceFinding.variancePercent).toBe('10.0000');
      expect(priceFinding.withinTolerance).toBe(false);
    });

    it('accepts a variance inside the configured tolerance', async () => {
      await seedProcurementConfig({ priceTolerancePercent: '5' });
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);

      // ₦612 against ₦600 is 2%, inside a 5% tolerance.
      const result = await invoiceFromGrn(order.id, grn.id, 'SI-TOL', {
        unitPriceKobo: 612_00n,
      });

      expect(result.match.status).toBe(MatchStatus.MATCHED);
      expect(result.routedAs).toBe('SUPPLIER_INVOICE');
    });

    it('refuses to bill more than arrived, rather than driving GRNI negative', async () => {
      const order = await approvedOrder();
      // Only 60 of 100 arrive.
      const grn = await receiveAll(order.id, 'GRN-PART', 60);

      // The supplier bills for all 100. A price variance is approvable; goods
      // that are not here cannot be cleared from GRNI at any approval level.
      await expect(
        invoiceFromGrn(order.id, grn.id, 'SI-QTY', { quantity: 100 }),
      ).rejects.toThrow(/cannot be cleared from Goods Received Not Invoiced/i);

      // GRNI still holds exactly what arrived.
      const balance = await receipts.grniBalance(order.id);
      expect(balance.outstandingKobo).toBe('3600000'); // 60 x ₦600
    });

    it('flags a quantity variance against the PURCHASE ORDER on an unreceipted line', async () => {
      // A PO-referenced line with no GRN: nothing has been received, so the
      // match compares against the order and reports the gap.
      const order = await approvedOrder();

      const invoice = await invoices.create({
        companyId: fixture.companyId,
        invoiceNumber: 'SI-NOGRN',
        supplierInvoiceNumber: 'SUP-NOGRN',
        supplierId,
        purchaseOrderId: order.id,
        invoiceDate: JAN,
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        ...period(),
        lines: [
          {
            purchaseOrderLineId: order.lines[0]!.id,
            quantity: 100,
            unitPriceKobo: UNIT_PRICE,
          },
        ],
        actor: maker,
      });

      const match = await invoices.threeWayMatch(invoice.id);
      expect(match.status).toBe(MatchStatus.EXCEPTION);
      const finding = match.findings.find((f) => f.field === 'QUANTITY')!;
      // Nothing received, so the whole 100 is a variance.
      expect(finding.expected).toBe('0.000000');
      expect(finding.actual).toBe('100.000000');
    });

    it('reports every discrepancy, not just the first', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id, 'GRN-BOTH', 60);

      // Correct quantity, wrong price — plus a second line billed with no
      // receipt behind it, so both a price and a quantity finding arise.
      const invoice = await invoices.create({
        companyId: fixture.companyId,
        invoiceNumber: 'SI-BOTH',
        supplierInvoiceNumber: 'SUP-BOTH',
        supplierId,
        purchaseOrderId: order.id,
        invoiceDate: JAN,
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        ...period(),
        lines: [
          {
            goodsReceiptNoteLineId: grn.lines[0]!.id,
            quantity: 30,
            unitPriceKobo: 700_00n,
          },
        ],
        actor: maker,
      });

      const match = await invoices.threeWayMatch(invoice.id);
      const fields = match.findings.map((f) => f.field);
      expect(fields).toContain('PRICE');
      expect(fields).toContain('QUANTITY');
      expect(match.status).toBe(MatchStatus.EXCEPTION);
    });

    it('stores the match result for the approver and the auditor', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);
      const result = await invoiceFromGrn(order.id, grn.id, 'SI-STORED', {
        unitPriceKobo: 700_00n,
      });

      const stored = await prisma.supplierInvoice.findUniqueOrThrow({
        where: { id: result.invoice.id },
      });
      expect(stored.matchStatus).toBe(MatchStatus.EXCEPTION);
      expect(stored.matchResult).toBeTruthy();
    });

    it('reports NOT_APPLICABLE for a standalone invoice', async () => {
      const invoice = await invoices.create({
        companyId: fixture.companyId,
        invoiceNumber: 'SI-STANDALONE',
        supplierInvoiceNumber: 'SUP-STANDALONE',
        supplierId,
        invoiceDate: JAN,
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        ...period(),
        lines: [
          {
            itemId: expenseItemId,
            quantity: 1,
            unitPriceKobo: 50_000_00n,
            costGlAccountId: fixture.accounts['5401']!,
          },
        ],
        actor: maker,
      });

      const match = await invoices.threeWayMatch(invoice.id);
      expect(match.status).toBe(MatchStatus.NOT_APPLICABLE);
    });
  });

  // =========================================================================

  describe('supplier invoice (§5)', () => {
    it('refuses the same supplier invoice number twice', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);
      await invoiceFromGrn(order.id, grn.id, 'SI-DUP');

      await expect(
        invoices.create({
          companyId: fixture.companyId,
          invoiceNumber: 'SI-DUP-2',
          // Same supplier reference as the one already entered.
          supplierInvoiceNumber: 'SUP-SI-DUP',
          supplierId,
          invoiceDate: JAN,
          currencyId: fixture.currencyId,
          branchId: fixture.branchId,
          ...period(),
          lines: [
            {
              itemId: expenseItemId,
              quantity: 1,
              unitPriceKobo: 1_000_00n,
              costGlAccountId: fixture.accounts['5401']!,
            },
          ],
          actor: maker,
        }),
      ).rejects.toThrow(/already been entered/i);
    });

    it('writes an input VAT register entry that reconciles to the ledger', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);
      await invoiceFromGrn(order.id, grn.id);

      const register = await registers.vatRegister(fixture.companyId, vatPeriodId);
      expect(register.summary.inputTaxRecoverableKobo).toBe('450000');

      const reconciliation = await registers.reconcile(fixture.companyId, vatPeriodId);
      expect(reconciliation.agrees).toBe(true);
    });

    it('sets the due date from the supplier payment terms', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);
      const { invoice } = await invoiceFromGrn(order.id, grn.id);

      expect(invoice.dueDate?.toISOString().slice(0, 10)).toBe('2026-02-14');
    });

    it('refuses to change a posted invoice, at the database', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);
      const { invoice } = await invoiceFromGrn(order.id, grn.id);

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE supplier_invoices SET status = 'DRAFT' WHERE id = $1::uuid`,
          invoice.id,
        ),
      ).rejects.toThrow(/is posted/i);
    });

    it('refuses an invoice from a blocked supplier', async () => {
      await parties.setSupplierStatus({
        supplierId,
        status: PartyStatus.BLOCKED,
        reason: 'Quality failure',
        actorId: fixture.makerId,
      });

      await expect(
        invoices.create({
          companyId: fixture.companyId,
          invoiceNumber: 'SI-BLOCKED',
          supplierInvoiceNumber: 'SUP-BLOCKED',
          supplierId,
          invoiceDate: JAN,
          currencyId: fixture.currencyId,
          branchId: fixture.branchId,
          ...period(),
          lines: [
            {
              itemId: expenseItemId,
              quantity: 1,
              unitPriceKobo: 1_000_00n,
              costGlAccountId: fixture.accounts['5401']!,
            },
          ],
          actor: maker,
        }),
      ).rejects.toThrow(/BLOCKED/);
    });
  });

  // =========================================================================

  describe('supplier payment (§5)', () => {
    async function postedInvoice() {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);
      const { invoice } = await invoiceFromGrn(order.id, grn.id);
      return invoice;
    }

    async function payInFull(
      invoiceId: string,
      paymentNumber: string,
      whtTaxCode: string | null = null,
    ) {
      const invoice = await prisma.supplierInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      const open = invoice.grossAmountKobo - invoice.settledAmountKobo;

      const payment = await payments.create({
        companyId: fixture.companyId,
        paymentNumber,
        supplierId,
        paymentDate: JAN,
        method: PaymentMethod.BANK_TRANSFER,
        bankGlAccountId: fixture.accounts['1101']!,
        branchId: fixture.branchId,
        currencyId: fixture.currencyId,
        ...period(),
        whtTaxCode,
        allocations: [{ invoiceId, amountKobo: open }],
        actor: maker,
      });

      const submitted = await payments.submit({ paymentId: payment.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
      return prisma.supplierPayment.findUniqueOrThrow({ where: { id: payment.id } });
    }

    it('posts Dr Payables / Cr Bank and settles the invoice', async () => {
      const invoice = await postedInvoice();
      await payInFull(invoice.id, 'PAY-001');

      expect(await accountBalance('2201')).toBe(0n);
      expect(await accountBalance('1101')).toBe(-6_450_000n);

      const settled = await prisma.supplierInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(settled.status).toBe(SupplierInvoiceStatus.PAID);

      const tb = await trialBalance.build({ companyId: fixture.companyId });
      expect(tb.balanced).toBe(true);
    });

    it('REFUSES to pay with withholding while no WHT rate is configured', async () => {
      const invoice = await postedInvoice();

      // This is the Phase 3 blocker doing its job: we are the one withholding,
      // so we must know the rate. Under-withholding is a liability at audit.
      await expect(
        payments.create({
          companyId: fixture.companyId,
          paymentNumber: 'PAY-NORATE',
          supplierId,
          paymentDate: JAN,
          method: PaymentMethod.BANK_TRANSFER,
          bankGlAccountId: fixture.accounts['1101']!,
          branchId: fixture.branchId,
          currencyId: fixture.currencyId,
          ...period(),
          whtTaxCode: 'WHT-CONTRACT',
          allocations: [{ invoiceId: invoice.id, amountKobo: invoice.grossAmountKobo }],
          actor: maker,
        }),
      ).rejects.toThrow(/no rate effective/i);
    });

    it('posts Dr Payables / Cr Bank / Cr WHT Payable once a rate exists', async () => {
      const invoice = await postedInvoice();
      await addWhtRate('0.05000000');

      await payInFull(invoice.id, 'PAY-WHT', 'WHT-CONTRACT');

      // WHT is 5% of the NET base (₦60,000), not the gross: ₦3,000.
      expect(await accountBalance('2130')).toBe(-300_000n);
      // Bank pays 64,500 less the 3,000 withheld.
      expect(await accountBalance('1101')).toBe(-6_150_000n);
      expect(await accountBalance('2201')).toBe(0n);

      const register = await registers.whtRegister(fixture.companyId, whtPeriodId);
      expect(register.summary.payableKobo).toBe('300000');

      const tb = await trialBalance.build({ companyId: fixture.companyId });
      expect(tb.balanced).toBe(true);
    });

    it('withholds on a proportionate base for a part payment', async () => {
      const invoice = await postedInvoice();
      await addWhtRate('0.05000000');

      // Pay half the invoice.
      const half = invoice.grossAmountKobo / 2n;
      const payment = await payments.create({
        companyId: fixture.companyId,
        paymentNumber: 'PAY-HALF',
        supplierId,
        paymentDate: JAN,
        method: PaymentMethod.BANK_TRANSFER,
        bankGlAccountId: fixture.accounts['1101']!,
        branchId: fixture.branchId,
        currencyId: fixture.currencyId,
        ...period(),
        whtTaxCode: 'WHT-CONTRACT',
        allocations: [{ invoiceId: invoice.id, amountKobo: half }],
        actor: maker,
      });

      // Half of the ₦60,000 net = ₦30,000 base; 5% = ₦1,500.
      expect(payment.whtAmountKobo).toBe(150_000n);

      const submitted = await payments.submit({ paymentId: payment.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      const after = await prisma.supplierInvoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(after.status).toBe(SupplierInvoiceStatus.PART_PAID);
    });

    it('refuses over-allocation to an invoice', async () => {
      const invoice = await postedInvoice();
      const tooMuch = invoice.grossAmountKobo + 1_00n;

      await expect(
        payments.create({
          companyId: fixture.companyId,
          paymentNumber: 'PAY-OVER',
          supplierId,
          paymentDate: JAN,
          method: PaymentMethod.BANK_TRANSFER,
          bankGlAccountId: fixture.accounts['1101']!,
          branchId: fixture.branchId,
          currencyId: fixture.currencyId,
          ...period(),
          allocations: [{ invoiceId: invoice.id, amountKobo: tooMuch }],
          actor: maker,
        }),
      ).rejects.toThrow(/only .* is outstanding/i);
    });

    it('refuses an unallocated payment', async () => {
      await expect(
        payments.create({
          companyId: fixture.companyId,
          paymentNumber: 'PAY-NOALLOC',
          supplierId,
          paymentDate: JAN,
          method: PaymentMethod.CASH,
          bankGlAccountId: fixture.accounts['1101']!,
          branchId: fixture.branchId,
          currencyId: fixture.currencyId,
          ...period(),
          allocations: [],
          actor: maker,
        }),
      ).rejects.toThrow(/allocated to at least one invoice/i);
    });

    it('refuses to pay a blocked supplier', async () => {
      const invoice = await postedInvoice();
      await parties.setSupplierStatus({
        supplierId,
        status: PartyStatus.BLOCKED,
        reason: 'Under investigation',
        actorId: fixture.makerId,
      });

      await expect(
        payments.create({
          companyId: fixture.companyId,
          paymentNumber: 'PAY-BLOCKED',
          supplierId,
          paymentDate: JAN,
          method: PaymentMethod.BANK_TRANSFER,
          bankGlAccountId: fixture.accounts['1101']!,
          branchId: fixture.branchId,
          currencyId: fixture.currencyId,
          ...period(),
          allocations: [{ invoiceId: invoice.id, amountKobo: invoice.grossAmountKobo }],
          actor: maker,
        }),
      ).rejects.toThrow(/BLOCKED/);
    });
  });

  // =========================================================================

  describe('supplier ageing agrees with the payables control account', () => {
    it('ages open invoices by their due date', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);
      await invoiceFromGrn(order.id, grn.id);

      const ageing = await payments.ageing({
        companyId: fixture.companyId,
        asAt: new Date('2026-03-31'),
      });

      expect(ageing).toHaveLength(1);
      const supplierRow = ageing[0]!;
      const bucketTotal = supplierRow.buckets.reduce(
        (s, b) => s + BigInt(b.amountKobo),
        0n,
      );
      expect(bucketTotal.toString()).toBe(supplierRow.totalKobo);

      // Open items must equal the payables control account, sign-flipped: a
      // payable is a credit balance.
      expect(BigInt(supplierRow.totalKobo)).toBe(-(await accountBalance('2201')));
    });

    it('drops a fully paid invoice out of the ageing', async () => {
      const order = await approvedOrder();
      const grn = await receiveAll(order.id);
      const { invoice } = await invoiceFromGrn(order.id, grn.id);

      const open = invoice.grossAmountKobo;
      const payment = await payments.create({
        companyId: fixture.companyId,
        paymentNumber: 'PAY-CLEAR',
        supplierId,
        paymentDate: JAN,
        method: PaymentMethod.BANK_TRANSFER,
        bankGlAccountId: fixture.accounts['1101']!,
        branchId: fixture.branchId,
        currencyId: fixture.currencyId,
        ...period(),
        allocations: [{ invoiceId: invoice.id, amountKobo: open }],
        actor: maker,
      });
      const submitted = await payments.submit({ paymentId: payment.id, actor: maker });
      await workflow.approve({ transactionId: submitted.transactionId, actor: approver });

      const ageing = await payments.ageing({
        companyId: fixture.companyId,
        asAt: new Date('2026-03-31'),
      });
      expect(ageing).toHaveLength(0);
      expect(await accountBalance('2201')).toBe(0n);
    });
  });

  // =========================================================================

  describe('requisition and purchase order (§5)', () => {
    it('estimates a requisition from standard cost', async () => {
      const requisition = await orders.createRequisition({
        companyId: fixture.companyId,
        requisitionNumber: 'PR-001',
        requestDate: JAN,
        branchId: fixture.branchId,
        costCentreId: fixture.costCentreId,
        currencyId: fixture.currencyId,
        justification: 'Production run',
        lines: [{ itemId: inventoryItemId, quantity: 100 }],
        actor: maker,
      });

      expect(requisition.estimatedCostKobo).toBe(6_000_000n);
    });

    it('draws down the requisition when a purchase order is raised from it', async () => {
      const requisition = await orders.createRequisition({
        companyId: fixture.companyId,
        requisitionNumber: 'PR-002',
        requestDate: JAN,
        branchId: fixture.branchId,
        currencyId: fixture.currencyId,
        lines: [{ itemId: inventoryItemId, quantity: 100 }],
        actor: maker,
      });

      await orders.createOrder({
        companyId: fixture.companyId,
        orderNumber: 'PO-FROM-PR',
        supplierId,
        requisitionId: requisition.id,
        orderDate: JAN,
        currencyId: fixture.currencyId,
        branchId: fixture.branchId,
        warehouseId,
        lines: [
          {
            itemId: inventoryItemId,
            requisitionLineId: requisition.lines[0]!.id,
            quantity: 60,
            unitPriceKobo: UNIT_PRICE,
          },
        ],
        actor: maker,
      });

      const line = await prisma.purchaseRequisitionLine.findUniqueOrThrow({
        where: { id: requisition.lines[0]!.id },
      });
      expect(line.orderedQuantity.toString()).toBe('60');
    });

    it('prices a purchase order with input VAT from the shared engine', async () => {
      const order = await approvedOrder();
      expect(order.netAmountKobo).toBe(6_000_000n);
      expect(order.vatAmountKobo).toBe(450_000n);
      expect(order.grossAmountKobo).toBe(6_450_000n);
    });

    it('refuses a purchase order for a blocked supplier', async () => {
      await parties.setSupplierStatus({
        supplierId,
        status: PartyStatus.BLOCKED,
        reason: 'Failed audit',
        actorId: fixture.makerId,
      });

      await expect(
        orders.createOrder({
          companyId: fixture.companyId,
          orderNumber: 'PO-BLOCKED',
          supplierId,
          orderDate: JAN,
          currencyId: fixture.currencyId,
          branchId: fixture.branchId,
          warehouseId,
          lines: [{ itemId: inventoryItemId, quantity: 1, unitPriceKobo: UNIT_PRICE }],
          actor: maker,
        }),
      ).rejects.toThrow(/BLOCKED/);
    });

    it('requires a reason to award an RFQ', async () => {
      const rfq = await prisma.rfq.create({
        data: {
          companyId: fixture.companyId,
          rfqNumber: 'RFQ-001',
          issueDate: JAN,
          createdById: fixture.makerId,
        },
      });
      const quotation = await prisma.supplierQuotation.create({
        data: {
          rfqId: rfq.id,
          supplierId,
          quotationReference: 'Q-001',
          quotationDate: JAN,
          totalAmountKobo: 6_000_000n,
        },
      });

      await expect(
        orders.awardRfq({
          rfqId: rfq.id,
          quotationId: quotation.id,
          reason: '',
          actor: maker,
        }),
      ).rejects.toThrow(/requires a stated reason/i);

      const awarded = await orders.awardRfq({
        rfqId: rfq.id,
        quotationId: quotation.id,
        reason: 'Best lead time despite higher price',
        actor: maker,
      });
      expect(awarded.awardedQuotationId).toBe(quotation.id);
    });

    it('compares quotations against the cheapest', async () => {
      const rfq = await prisma.rfq.create({
        data: {
          companyId: fixture.companyId,
          rfqNumber: 'RFQ-CMP',
          issueDate: JAN,
          createdById: fixture.makerId,
        },
      });

      const second = await parties.createSupplier({
        companyId: fixture.companyId,
        code: 'SUP-002',
        name: 'Alternative Supplies',
        defaultCurrencyId: fixture.currencyId,
        actorId: fixture.makerId,
      });

      await prisma.supplierQuotation.createMany({
        data: [
          {
            rfqId: rfq.id, supplierId, quotationReference: 'Q-A',
            quotationDate: JAN, totalAmountKobo: 7_000_000n, leadTimeDays: 3,
          },
          {
            rfqId: rfq.id, supplierId: second.id, quotationReference: 'Q-B',
            quotationDate: JAN, totalAmountKobo: 6_000_000n, leadTimeDays: 14,
          },
        ],
      });

      const comparison = await orders.compareQuotations(rfq.id);
      expect(comparison[0]!.supplierCode).toBe('SUP-002');
      expect(comparison[0]!.varianceToCheapestKobo).toBe('0');
      expect(comparison[1]!.varianceToCheapestKobo).toBe('1000000');
    });
  });
});
