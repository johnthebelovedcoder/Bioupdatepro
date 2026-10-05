import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ItemType, PaymentMethod, PrismaClient, QualityStatus, SupplierInvoiceStatus, TaxType } from '@bioassetpro/database';
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
import { SupplierReturnService } from '../../src/procurement/supplier-return.service';
import { PostingControlProvisioningService } from '../../src/posting-control/posting-control-provisioning.service';
import { WorkflowActor } from '../../src/workflow/workflow.types';
import { resetDatabase, seedFixture, TestFixture } from '../helpers/test-db';

/**
 * Procure-to-pay on the approved five-digit chart: the company's procurement
 * configuration is the workbook's own (GRNI 20300, trade payables 20100,
 * withholding payable 20500), VAT comes from tax setup on the approved
 * accounts (input VAT 11300), stock is held in raw materials control (12000)
 * and a supplier is paid from the approved bank account (10100).
 */
describe('Procure-to-pay on the approved chart', () => {
  let prisma: PrismaService;
  let orders: PurchaseOrderService;
  let receipts: GoodsReceiptService;
  let invoices: SupplierInvoiceService;
  let payments: SupplierPaymentService;
  let workflow: WorkflowService;
  let trialBalance: TrialBalanceService;
  let parties: PartyService;
  let provisioning: PostingControlProvisioningService;
  let returns: SupplierReturnService;
  let fixture: TestFixture;
  let maker: WorkflowActor;
  let approver: WorkflowActor;
  let supplierId: string;
  let inventoryItemId: string;
  let expenseItemId: string;
  let warehouseId: string;
  const JAN = new Date('2026-01-15');
  const UNIT_PRICE = 600_00n;
  const QUANTITY = 100;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const audit = new AuditService(prisma);
    const posting = new PostingService(prisma, audit, new IdempotencyService(prisma), new PeriodService(prisma), new DimensionValidatorService(prisma));
    trialBalance = new TrialBalanceService(prisma);
    workflow = new WorkflowService(prisma, new WorkflowRoutingService(prisma), new DelegationService(prisma, audit), new NotificationService(prisma), audit);
    const tax = new TaxEngineService(prisma);
    const registers = new TaxRegisterService(prisma, tax);
    parties = new PartyService(prisma, audit);
    const config = new ProcurementConfigService(prisma);
    orders = new PurchaseOrderService(prisma, audit, workflow, tax);
    receipts = new GoodsReceiptService(prisma, audit, posting, workflow, config, new StockMovementService(prisma));
    invoices = new SupplierInvoiceService(prisma, audit, posting, workflow, tax, registers, config);
    payments = new SupplierPaymentService(prisma, audit, posting, workflow, tax, registers, config);
    workflow.register(new GoodsReceiptPostingHandler(receipts));
    workflow.register(new GoodsReceiptExceptionPostingHandler(receipts));
    workflow.register(new SupplierInvoicePostingHandler(invoices));
    workflow.register(new SupplierInvoiceExceptionPostingHandler(invoices));
    workflow.register(new SupplierPaymentPostingHandler(payments));
    provisioning = new PostingControlProvisioningService(prisma, audit);
    returns = new SupplierReturnService(prisma, audit, posting, new StockMovementService(prisma), tax, config);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const acct = async (number: string) => (await prisma.gLAccount.findFirstOrThrow({ where: { companyId: fixture.companyId, accountNumber: number } })).id;

  beforeEach(async () => {
    await resetDatabase(prisma as unknown as PrismaClient);
    fixture = await seedFixture(prisma as unknown as PrismaClient);
    maker = { userId: fixture.makerId, roles: ['BUYER'] };
    const approverUser = await prisma.user.create({ data: { email: 'p2p-approver@test', fullName: 'P2P Approver', passwordHash: 'x', roles: ['FINANCE_MANAGER'] } });
    approver = { userId: approverUser.id, roles: approverUser.roles };

    await prisma.company.update({ where: { id: fixture.companyId }, data: { chartVersion: 'APPROVED' } });
    await provisioning.provision(fixture.companyId, null);
    // VAT and withholding set up the way a farm does it, on the approved accounts.
    await new TaxSetupService(prisma, new AuditService(prisma)).activate({ companyId: fixture.companyId, actorId: fixture.makerId, whtBasis: 'NET_OF_VAT' });
    for (const taxType of [TaxType.VAT, TaxType.WHT] as const) {
      await prisma.taxPeriod.create({
        data: { companyId: fixture.companyId, taxType, year: 2026, periodNumber: 1, name: 'January 2026', startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31'), dueDate: new Date('2026-02-21') },
      });
    }
    for (const transactionType of ['PURCHASE_REQUISITION', 'PURCHASE_ORDER', 'GOODS_RECEIPT', 'GOODS_RECEIPT_EXCEPTION', 'SUPPLIER_INVOICE', 'SUPPLIER_INVOICE_EXCEPTION', 'SUPPLIER_PAYMENT']) {
      await prisma.workflowDefinition.create({
        data: {
          companyId: fixture.companyId, transactionType, name: `${transactionType} route`,
          autoPostOnApproval: !['PURCHASE_REQUISITION', 'PURCHASE_ORDER'].includes(transactionType), effectiveFrom: new Date('2026-01-01'),
          steps: { create: [{ level: 1, roleCode: 'FINANCE_MANAGER', name: 'Finance Manager', maxAmountKobo: null }] },
        },
      });
    }

    const uom = await prisma.unitOfMeasure.create({ data: { companyId: fixture.companyId, code: 'Unit', name: 'Unit', precision: 0 } });
    warehouseId = (await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'RAW-WH', name: 'Raw Material Store', type: 'RAW_MATERIAL' } })).id;
    const vat = await prisma.taxCode.findFirstOrThrow({ where: { companyId: fixture.companyId, code: 'VAT-STD' } });
    inventoryItemId = (await prisma.item.create({
      data: {
        companyId: fixture.companyId, code: 'RM-SLIME', description: 'Fresh Snail Slime', unitOfMeasureId: uom.id, itemType: ItemType.INVENTORY, vatTaxCodeId: vat.id,
        inventoryGlAccountId: await acct('12000'), standardCosts: { create: [{ standardCostKobo: UNIT_PRICE, effectiveFrom: new Date('2026-01-01') }] },
      },
    })).id;
    expenseItemId = (await prisma.item.create({
      data: { companyId: fixture.companyId, code: 'SVC-CLEAN', description: 'Cleaning service', unitOfMeasureId: uom.id, itemType: ItemType.EXPENSE, vatTaxCodeId: vat.id, expenseGlAccountId: await acct('56000') },
    })).id;
    await prisma.paymentTerm.create({ data: { companyId: fixture.companyId, code: 'NET30', name: 'Net 30', netDays: 30 } });
    supplierId = (await parties.createSupplier({
      companyId: fixture.companyId, code: 'SUP-001', name: 'Shell Supplies Ltd', tin: 'TIN-SUP-001', paymentTermCode: 'NET30', defaultCurrencyId: fixture.currencyId,
      bankName: 'First Bank', accountNumber: '3012345678', accountName: 'Shell Supplies Ltd', actorId: fixture.makerId,
    })).id;
    await parties.verifySupplierBank({ companyId: fixture.companyId, supplierId, reference: 'Bank letter ref. SS/01', actorId: fixture.checkerId });
  });

  const period = () => ({ financialYearId: fixture.financialYearId, financialPeriodId: fixture.periodIds[0]! });

  async function approvedOrder(itemId = inventoryItemId) {
    const order = await orders.createOrder({
      companyId: fixture.companyId, orderNumber: `PO-${Math.random().toString(36).slice(2, 8)}`, supplierId, orderDate: JAN, currencyId: fixture.currencyId,
      branchId: fixture.branchId, warehouseId, lines: [{ itemId, quantity: QUANTITY, unitPriceKobo: UNIT_PRICE }], actor: maker,
    });
    const submitted = await orders.submitOrder({ purchaseOrderId: order.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.syncStatus(order.id);
    return prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
  }

  async function receiveAll(orderId: string) {
    const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    const grn = await receipts.create({
      purchaseOrderId: order.id, grnNumber: 'GRN-001', receiptDate: JAN, ...period(), qualityStatus: QualityStatus.PASSED,
      lines: order.lines.map((line) => ({ purchaseOrderLineId: line.id, receivedQuantity: Number(line.quantity), rejectedQuantity: 0 })),
      actor: maker,
    });
    const submitted = await receipts.submit({ grnId: grn.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.syncStatus(order.id);
    return prisma.goodsReceiptNote.findUniqueOrThrow({ where: { id: grn.id }, include: { lines: true } });
  }

  async function invoiceFromGrn(orderId: string, grnId: string) {
    const grn = await prisma.goodsReceiptNote.findUniqueOrThrow({ where: { id: grnId }, include: { lines: true } });
    const invoice = await invoices.create({
      companyId: fixture.companyId, invoiceNumber: 'SI-001', supplierInvoiceNumber: 'SUP-SI-001', supplierId, purchaseOrderId: orderId, invoiceDate: JAN,
      currencyId: fixture.currencyId, branchId: fixture.branchId, costCentreId: fixture.costCentreId, ...period(),
      lines: grn.lines.map((line) => ({ goodsReceiptNoteLineId: line.id, quantity: Number(line.acceptedQuantity), unitPriceKobo: line.unitPriceKobo })),
      actor: maker,
    });
    const submitted = await invoices.submit({ invoiceId: invoice.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    return prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
  }

  async function balance(accountNumber: string) {
    const sums = await prisma.journalLine.aggregate({
      where: { glAccountId: await acct(accountNumber), journalEntry: { status: 'POSTED' } },
      _sum: { debitKobo: true, creditKobo: true },
    });
    return (sums._sum.debitKobo ?? 0n) - (sums._sum.creditKobo ?? 0n);
  }

  it('gives the company the workbook’s procurement configuration, and reports it ready', async () => {
    const config = await prisma.procurementConfiguration.findFirstOrThrow({
      where: { companyId: fixture.companyId }, include: { grniAccount: true, payablesAccount: true, whtPayableAccount: true },
    });
    expect([config.grniAccount.accountNumber, config.payablesAccount.accountNumber, config.whtPayableAccount?.accountNumber]).toEqual(['20300', '20100', '20500']);
    const status = await provisioning.status(fixture.companyId);
    expect(status.targetChart.configurationsOutsideTarget.filter((c) => c.configuration === 'Procurement')).toEqual([]);
  });

  it('receives into raw materials against GRNI, and the invoice clears GRNI to exactly zero', async () => {
    const order = await approvedOrder();
    const grn = await receiveAll(order.id);
    expect(await balance('12000')).toBe(6_000_000n); // 100 × ₦600
    expect(await balance('20300')).toBe(-6_000_000n);

    await invoiceFromGrn(order.id, grn.id);
    expect(await balance('20300')).toBe(0n); // GRNI back to zero
    expect(await balance('12000')).toBe(6_000_000n); // inventory recognised once
    expect(await balance('20100')).toBe(-6_450_000n); // ₦60,000 + ₦4,500 VAT owed
    expect(await balance('11300')).toBe(450_000n); // input VAT
    expect((await trialBalance.build({ companyId: fixture.companyId })).balanced).toBe(true);
  });

  it('pays the supplier from the approved bank account and settles the invoice', async () => {
    const order = await approvedOrder();
    const grn = await receiveAll(order.id);
    const invoice = await invoiceFromGrn(order.id, grn.id);
    const payment = await payments.create({
      companyId: fixture.companyId, paymentNumber: 'PAY-001', supplierId, paymentDate: JAN, method: PaymentMethod.BANK_TRANSFER,
      bankGlAccountId: await acct('10100'), branchId: fixture.branchId, currencyId: fixture.currencyId, ...period(),
      allocations: [{ invoiceId: invoice.id, amountKobo: invoice.grossAmountKobo }], actor: maker,
    });
    const submitted = await payments.submit({ paymentId: payment.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    expect(await balance('20100')).toBe(0n);
    expect(await balance('10100')).toBe(-6_450_000n);
    expect((await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe(SupplierInvoiceStatus.PAID);
  });

  it('marks a payment cancelled on the payment itself when an approver rejects it', async () => {
    const order = await approvedOrder();
    const grn = await receiveAll(order.id);
    const invoice = await invoiceFromGrn(order.id, grn.id);
    const payment = await payments.create({
      companyId: fixture.companyId, paymentNumber: 'PAY-REJ', supplierId, paymentDate: JAN, method: PaymentMethod.BANK_TRANSFER,
      bankGlAccountId: await acct('10100'), branchId: fixture.branchId, currencyId: fixture.currencyId, ...period(),
      allocations: [{ invoiceId: invoice.id, amountKobo: invoice.grossAmountKobo }], actor: maker,
    });
    const submitted = await payments.submit({ paymentId: payment.id, actor: maker });
    await workflow.reject({ transactionId: submitted.transactionId, actor: approver, comments: 'Wrong account' });
    expect((await prisma.supplierPayment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('CANCELLED');
    expect(await balance('10100')).toBe(0n);
  });

  it('marks a goods receipt cancelled and a returned supplier invoice draft, with nothing posted', async () => {
    const order = await approvedOrder();
    const grn = await receipts.create({
      purchaseOrderId: order.id, grnNumber: 'GRN-REJ', receiptDate: JAN, ...period(), qualityStatus: QualityStatus.PASSED,
      lines: order.lines.map((line) => ({ purchaseOrderLineId: line.id, receivedQuantity: Number(line.quantity), rejectedQuantity: 0 })),
      actor: maker,
    });
    const submitted = await receipts.submit({ grnId: grn.id, actor: maker });
    await workflow.reject({ transactionId: submitted.transactionId, actor: approver, comments: 'Not what we ordered' });
    expect((await prisma.goodsReceiptNote.findUniqueOrThrow({ where: { id: grn.id } })).status).toBe('CANCELLED');
    expect(await balance('12000')).toBe(0n);

    const good = await receiveAll(order.id);
    const invoice = await invoices.create({
      companyId: fixture.companyId, invoiceNumber: 'SI-RET', supplierInvoiceNumber: 'SUP-RET', supplierId, purchaseOrderId: order.id, invoiceDate: JAN,
      currencyId: fixture.currencyId, branchId: fixture.branchId, costCentreId: fixture.costCentreId, ...period(),
      lines: good.lines.map((line) => ({ goodsReceiptNoteLineId: line.id, quantity: Number(line.acceptedQuantity), unitPriceKobo: line.unitPriceKobo })),
      actor: maker,
    });
    const sub = await invoices.submit({ invoiceId: invoice.id, actor: maker });
    await workflow.returnToMaker({ transactionId: sub.transactionId, actor: approver, comments: 'Check the price' });
    expect((await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe('DRAFT');
  });

  it('receives an item into its own store, not the order’s header store', async () => {
    const feedStore = await prisma.warehouse.create({ data: { companyId: fixture.companyId, branchId: fixture.branchId, code: 'FEED-WH', name: 'Feed Store', type: 'RAW_MATERIAL' } });
    await prisma.item.update({ where: { id: inventoryItemId }, data: { defaultWarehouseId: feedStore.id } });
    const order = await approvedOrder(); // raised against RAW-WH
    await receiveAll(order.id);
    const movements = await prisma.stockMovement.findMany({ where: { companyId: fixture.companyId, itemId: inventoryItemId } });
    expect(movements.map((m) => m.warehouseId)).toEqual([feedStore.id]);
  });

  it('charges a service invoice to the expense account its item names', async () => {
    const order = await approvedOrder(expenseItemId);
    const invoice = await invoices.create({
      companyId: fixture.companyId, invoiceNumber: 'SI-SVC', supplierInvoiceNumber: 'SUP-SVC-1', supplierId, invoiceDate: JAN, currencyId: fixture.currencyId,
      branchId: fixture.branchId, costCentreId: fixture.costCentreId, ...period(),
      lines: [{ itemId: expenseItemId, quantity: 1, unitPriceKobo: 1_000_00n, costGlAccountId: await acct('56000') }], actor: maker,
    });
    const submitted = await invoices.submit({ invoiceId: invoice.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    expect(order.id).toBeTruthy();
    expect(await balance('56000')).toBe(100_000n);
    expect(await balance('11300')).toBe(7_500n); // 7.5% input VAT
    expect(await balance('20100')).toBe(-107_500n);
  });
  it('withholds tax on a payment to withholding payable (20500) and still balances', async () => {
    const order = await approvedOrder();
    const grn = await receiveAll(order.id);
    const invoice = await invoiceFromGrn(order.id, grn.id);
    const payment = await payments.create({
      companyId: fixture.companyId, paymentNumber: 'PAY-WHT', supplierId, paymentDate: JAN, method: PaymentMethod.BANK_TRANSFER,
      bankGlAccountId: await acct('10100'), branchId: fixture.branchId, currencyId: fixture.currencyId, ...period(), whtTaxCode: 'WHT-CONTRACT',
      allocations: [{ invoiceId: invoice.id, amountKobo: invoice.grossAmountKobo }], actor: maker,
    });
    expect(payment.whtAmountKobo).toBe(120_000n); // the statutory 2% tax setup loads, on the ₦60,000 net
    const submitted = await payments.submit({ paymentId: payment.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    expect(await balance('20100')).toBe(0n);
    expect(await balance('20500')).toBe(-120_000n); // withheld, owed to the tax authority
    expect(await balance('10100')).toBe(-(6_450_000n - 120_000n)); // the bank paid net of the withholding
    expect((await trialBalance.build({ companyId: fixture.companyId })).balanced).toBe(true);
  });
  it('takes goods returned before invoicing off GRNI at the receipt price, so they cannot be billed', async () => {
    const order = await approvedOrder();
    const grn = await receiveAll(order.id);
    const raised = await returns.request({
      companyId: fixture.companyId, grnId: grn.id, returnDate: JAN, reason: 'Ten units damp', lines: [{ grnLineId: grn.lines[0]!.id, quantity: 10 }], actor: maker,
    });
    const posted = await returns.decide({ companyId: fixture.companyId, returnId: raised.id, decision: 'APPROVE', actor: { userId: fixture.checkerId, roles: ['FINANCE_MANAGER'] } });
    expect(posted.status).toBe('POSTED');
    expect(await balance('20300')).toBe(-(90n * UNIT_PRICE)); // GRNI for the 90 kept
    expect(await balance('12000')).toBe(90n * UNIT_PRICE); // 10 units out of raw materials control
    expect((await trialBalance.build({ companyId: fixture.companyId })).balanced).toBe(true);
  });
  it('capitalises a capital item bought through purchasing into plant and machinery cost (15200) against GRNI', async () => {
    const uom = await prisma.unitOfMeasure.findFirstOrThrow({ where: { companyId: fixture.companyId, code: 'Unit' } });
    const mixer = await prisma.item.create({
      data: { companyId: fixture.companyId, code: 'CAPEX-MIXER', description: 'Feed mixer', unitOfMeasureId: uom.id, itemType: ItemType.INVENTORY, fixedAssetClass: 'Machinery', usefulLifeMonths: 60 },
    });
    const order = await orders.createOrder({
      companyId: fixture.companyId, orderNumber: 'PO-CAPEX', supplierId, orderDate: JAN, currencyId: fixture.currencyId, branchId: fixture.branchId, warehouseId,
      costCentreId: fixture.costCentreId, lines: [{ itemId: mixer.id, quantity: 1, unitPriceKobo: 5_000_000_00n }], actor: maker,
    });
    const submitted = await orders.submitOrder({ purchaseOrderId: order.id, actor: maker });
    await workflow.approve({ transactionId: submitted.transactionId, actor: approver });
    await orders.syncStatus(order.id);
    await receiveAll(order.id);
    expect(await balance('15200')).toBe(5_000_000_00n);
    expect(await balance('20300')).toBe(-5_000_000_00n);
    expect(await prisma.fixedAsset.count({ where: { companyId: fixture.companyId, assetClass: 'Machinery', costKobo: 5_000_000_00n } })).toBe(1);
  });
});
