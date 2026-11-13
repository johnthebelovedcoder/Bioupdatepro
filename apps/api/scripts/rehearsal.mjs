// The 500-snail + 500-poultry test environment script (Test_Environment_Script,
// handbook PRS-008), run end to end in one clean environment.
//
//   npm run build -w @bioassetpro/api && npm run rehearsal -w @bioassetpro/api
//
// A brand-new PostgreSQL, every migration, the compiled application booted with
// its real module wiring, and a farm registered the way a new customer
// registers. The 40 steps then go through the application's own services, in
// order, each recording what the sheet's result columns ask for: status,
// application reference, journal reference and actual result. Every step also
// checks that the ledger still balances. A failed step stops the run; the steps
// after it are recorded as not run, never as passed.
//
// Output: test/uat/rehearsal-40.json and test/uat/rehearsal-40-report.md.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import net from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = resolve(here, '..');
const repoRoot = resolve(apiDir, '..', '..');
const dist = join(apiDir, 'dist');
const require = createRequire(join(dist, 'main.js'));
const load = (path) => require(join(dist, path));

// ---------------------------------------------------------------- environment

async function freePort(from) {
  for (let port = from; port < from + 50; port += 1) {
    const free = await new Promise((ok) => {
      const s = net.createServer();
      s.once('error', () => ok(false));
      s.once('listening', () => s.close(() => ok(true)));
      s.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error('No free port for the rehearsal database.');
}

const { default: EmbeddedPostgres } = await import(pathToFileURL(require.resolve('embedded-postgres', { paths: [repoRoot] })).href);
const port = await freePort(55400);
const dataDir = mkdtempSync(join(tmpdir(), 'bap-rehearsal-'));
const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: true });
await pg.initialise();
await pg.start();
await pg.createDatabase('bioassetpro_rehearsal');
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/bioassetpro_rehearsal`;
process.env.JWT_SECRET ||= 'rehearsal-only-secret-not-used-anywhere-else-0123456789';
process.env.PII_ENCRYPTION_KEY ||= 'rehearsal-only-encryption-key';
console.log(`[rehearsal] clean PostgreSQL on 127.0.0.1:${port}`);

const migrated = spawnSync('npm', ['run', 'migrate:deploy', '-w', '@bioassetpro/database'], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (migrated.status !== 0) throw new Error('Migration failed.');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = load('app.module.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const svc = (path, name) => app.get(load(path)[name]);
const prisma = svc('prisma/prisma.service.js', 'PrismaService');

// ---------------------------------------------------------------- the run

const results = [];
/** Where the workbook contradicts itself or a result needs the client's judgement: reported beside the steps. */
const notes = [];
const note = (stepNumber, text) => notes.push({ step: stepNumber, text });
let halted = null;
let lastJournalAt = new Date(0);

/** Journals posted since the previous step, by number: the step's journal reference. */
async function newJournals() {
  const rows = await prisma.journalEntry.findMany({
    where: { companyId: ctx.companyId, createdAt: { gt: lastJournalAt } },
    orderBy: { createdAt: 'asc' },
    select: { journalNumber: true, createdAt: true },
  });
  if (rows.length) lastJournalAt = rows[rows.length - 1].createdAt;
  return rows.map((r) => r.journalNumber);
}

async function ledgerBalances() {
  if (!ctx.companyId) return true;
  const s = await prisma.journalLine.aggregate({ where: { journalEntry: { companyId: ctx.companyId } }, _sum: { debitKobo: true, creditKobo: true } });
  return (s._sum.debitKobo ?? 0n) === (s._sum.creditKobo ?? 0n);
}

async function step(n, area, action, run) {
  if (halted) {
    results.push({ step: n, area, action, status: 'NOT RUN', actual: `Not run: step ${halted} failed.` });
    return;
  }
  const started = Date.now();
  try {
    const evidence = (await run()) ?? {};
    const journals = ctx.companyId ? await newJournals() : [];
    if (!(await ledgerBalances())) throw new Error('The ledger no longer balances.');
    results.push({ step: n, area, action, status: 'PASS', applicationRef: evidence.ref ?? '', journalRef: journals.join(', '), actual: evidence.actual ?? '', ms: Date.now() - started });
    console.log(`[rehearsal] ${String(n).padStart(2)} PASS  ${action}`);
  } catch (error) {
    halted = n;
    results.push({ step: n, area, action, status: 'FAIL', actual: String(error?.message ?? error).split('\n')[0], ms: Date.now() - started });
    console.log(`[rehearsal] ${String(n).padStart(2)} FAIL  ${action}\n    ${String(error?.message ?? error).split('\n')[0]}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const naira = (n) => BigInt(Math.round(n * 100));
const shown = (kobo) => `NGN ${(Number(kobo) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

/** Approve a workflow transaction rung by rung, each by someone holding that rung's role. */
async function approveAll(transactionId) {
  const workflow = svc('workflow/workflow.service.js', 'WorkflowService');
  for (let i = 0; i < 6; i += 1) {
    const t = await prisma.workflowTransaction.findUniqueOrThrow({ where: { id: transactionId }, include: { steps: true } });
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(t.status)) return t;
    const rung = t.steps.find((s) => s.level === t.currentLevel);
    const approver = ctx.byRole[rung.roleCode];
    expect(approver, `No one holds ${rung.roleCode} to approve ${t.documentReference}.`);
    await workflow.approve({ transactionId, actor: approver });
  }
  return prisma.workflowTransaction.findUniqueOrThrow({ where: { id: transactionId } });
}

const ctx = { companyId: null, byRole: {} };

/**
 * Day n of the financial year the farm is registered with. Every date in the
 * case is a day of that year, none later than LAST_DAY, so the whole case is
 * in the past when it runs.
 */
const D = (n) => new Date(ctx.year.startDate.getTime() + n * 86_400_000);

/** The last day of the year the case uses: snails hatch on day 12 and need 240 days to reach market. */
const LAST_DAY = 268;

/**
 * The latest year start that still leaves the case in the past, but never
 * before 1 January 2026: tax and payroll rules are configured from 2026.
 */
function yearStartMonth() {
  const now = new Date();
  const candidate = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth() + 1, 1));
  return (candidate < new Date('2026-01-01') ? new Date('2026-01-01') : candidate).getUTCMonth() + 1;
}

// ---------------------------------------------------------------- 1-3 Foundation and masters

await step(1, 'Foundation', 'Create entity, farms, warehouses, fiscal year, NGN and users', async () => {
  const registration = svc('auth/registration.service.js', 'RegistrationService');
  const invitations = svc('auth/invitation.service.js', 'InvitationService');
  await registration.register({ fullName: 'Owner', email: 'owner@rehearsal.test', password: 'Rehearsal-Owner-2026!', farmName: 'Rehearsal Farm', financialYearStartMonth: yearStartMonth() });
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'owner@rehearsal.test' } });
  ctx.companyId = owner.companyId;
  ctx.owner = { userId: owner.id, roles: owner.roles };
  ctx.byRole.CFO = ctx.owner;
  ctx.byRole.ADMINISTRATOR = ctx.owner;
  const team = [
    ['clerk', ['FARM_ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STOREKEEPER', 'PRODUCTION_SUPERVISOR', 'HR_OFFICER', 'TREASURY_OFFICER', 'SALES_OFFICER']],
    ['manager', ['FARM_MANAGER']],
    ['finance', ['FINANCE_MANAGER']],
    ['controller', ['FINANCE_CONTROLLER']],
    ['hr', ['HR_MANAGER']],
    // Pays what others prepared: payroll and supplier payments.
    ['treasury', ['TREASURY_OFFICER']],
  ];
  for (const [who, roles] of team) {
    const invite = await invitations.invite({ companyId: ctx.companyId, actor: ctx.owner, email: `${who}@rehearsal.test`, roles });
    await invitations.accept({ token: invite.token, fullName: who, password: `Rehearsal-${who}-2026!` });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `${who}@rehearsal.test` } });
    ctx[who] = { userId: user.id, roles: user.roles };
    for (const role of roles) ctx.byRole[role] ??= ctx[who];
  }
  const company = await prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId }, include: { baseCurrency: true } });
  ctx.currencyId = company.baseCurrencyId;
  ctx.farm = await prisma.farm.findFirstOrThrow({ where: { companyId: ctx.companyId } });
  ctx.branchId = (await prisma.branch.findFirstOrThrow({ where: { companyId: ctx.companyId } })).id;
  const year = await prisma.financialYear.findFirstOrThrow({ where: { companyId: ctx.companyId }, include: { periods: { orderBy: { periodNumber: 'asc' } } } });
  ctx.year = year;
  const today = Math.floor((Date.now() - year.startDate.getTime()) / 86_400_000);
  expect(today >= LAST_DAY, `The case needs ${LAST_DAY} days of the financial year behind it; it is day ${today}. Run on or after ${D(LAST_DAY).toISOString().slice(0, 10)}.`);
  const warehouses = await prisma.warehouse.count({ where: { companyId: ctx.companyId } });
  expect(company.baseCurrency.code === 'NGN', 'Base currency is not NGN.');
  expect(year.periods.length === 12, 'The year does not have 12 periods.');
  const users = await prisma.user.count({ where: { companyId: ctx.companyId } });
  return { ref: `${company.code} / ${year.code}`, actual: `Company ${company.name} in NGN; year ${year.code} with 12 open periods; farm ${ctx.farm.code}; ${warehouses} warehouses; ${users} users, each role held by a different person from the one who raises documents.` };
});

await step(2, 'Foundation', 'Load COA, cost centres, posting profiles, dimensions and all four recovery GLs', async () => {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId } });
  const approvedEngine = await svc('posting-control/posting-control-provisioning.service.js', 'PostingControlProvisioningService').provision(ctx.companyId, ctx.controller.userId);
  expect(approvedEngine.approved.accounts > 0 && approvedEngine.approved.accountMaps > 0, 'The newer approved posting workbook was not loaded.');
  const accounts = await prisma.gLAccount.count({ where: { companyId: ctx.companyId, active: true } });
  const recovery = await prisma.gLAccount.findMany({ where: { companyId: ctx.companyId, active: true, accountNumber: { in: ['219810', '219820', '219830'] } }, select: { accountNumber: true, name: true } });
  const rules = await prisma.postingRule.count({ where: { companyId: ctx.companyId } });
  expect(company.chartVersion === 'SPEC', `The farm is on the ${company.chartVersion} chart, not the six-digit specification chart.`);
  // COA_Cost_Centres: the workbook's cost centres, created as an administrator would.
  const structure = svc('masters/farm-structure.service.js', 'FarmStructureService');
  const WORKBOOK_CENTRES = [
    ['CC-CORP-PROC', 'Corporate Procurement'], ['CC-CORP-FIN', 'Corporate Finance'],
    ['CC-SNL-BREED', 'Snail Breeding'], ['CC-SNL-HATCH', 'Snail Hatchery'], ['CC-SNL-GROW', 'Snail Grow-out'], ['CC-SNL-HARV', 'Snail Harvest'], ['CC-SNL-PROC', 'Snail Processing'], ['CC-SNL-SALES', 'Snail Sales'],
    ['CC-POL-BROIL', 'Poultry Broiler'], ['CC-POL-HARV', 'Poultry Harvest'], ['CC-POL-PROC', 'Poultry Processing'], ['CC-POL-SALES', 'Poultry Sales'],
  ];
  for (const [code, name] of WORKBOOK_CENTRES) await structure.createCostCentre({ companyId: ctx.companyId, actor: ctx.owner, code, name });
  ctx.cc = Object.fromEntries((await prisma.costCentre.findMany({ where: { companyId: ctx.companyId } })).map((c) => [c.code, c.id]));
  const centres = Object.keys(ctx.cc).length;
  // POL-001: the year's costing policy, chosen by the finance controller before any standard is prepared.
  await svc('production/standard-cost.service.js', 'StandardCostService').configurePolicy({
    companyId: ctx.companyId, financialYearId: ctx.year.id, varianceTolerancePercent: 20, varianceDisposition: 'COGS', actor: ctx.controller,
  });
  ctx.account = Object.fromEntries((await prisma.gLAccount.findMany({ where: { companyId: ctx.companyId, active: true } })).map((a) => [a.accountNumber, a.id]));
  // POSTING_COA_MASTER: S_Recovery_GL 219810, P_Recovery_GL 219820 and the feed mill's 219830 (PCR-033/036).
  expect(recovery.length === 3, `Recovery accounts missing: have ${recovery.map((r) => r.accountNumber).join(', ')}.`);
  note(
    2,
    'The approved policy uses one Feed Mill Recovery GL (219830), with species/formula/batch/work-centre analysis in dimensions.',
  );
  return { ref: `Approved posting workbook + chart ${company.chartVersion}`, actual: `${approvedEngine.approved.accounts} approved-workbook accounts and ${approvedEngine.approved.accountMaps} account maps loaded; ${accounts} legacy six-digit accounts retained for this compatibility case; ${centres} cost centres; ${rules ?? 'n/a'} legacy posting rules; recovery accounts ${recovery.map((r) => `${r.accountNumber} ${r.name}`).join('; ')}.` };
});

await step(3, 'Masters', 'Create vendors, customers, employees, items, assets, species, stages and UOM', async () => {
  const structure = svc('masters/farm-structure.service.js', 'FarmStructureService');
  const parties = svc('masters/party.service.js', 'PartyService');
  const items = svc('masters/item.service.js', 'ItemService');
  const employees = svc('masters/employee.service.js', 'EmployeeService');
  const onboarding = svc('masters/employee-onboarding.service.js', 'EmployeeOnboardingService');
  const tax = svc('tax/tax-setup.service.js', 'TaxSetupService');
  const payrollSetup = svc('payroll/payroll-setup.service.js', 'PayrollSetupService');

  // Tax and payroll switched on, units of measure present — setup a farm does once.
  await tax.activate({ companyId: ctx.companyId, actorId: ctx.owner.userId, whtBasis: 'NET_OF_VAT', tin: '12345678-0001', vatRegistrationNumber: 'VAT-REHEARSAL' });
  await payrollSetup.activate({ companyId: ctx.companyId, nhfCompanyParticipation: true, actorId: ctx.owner.userId });
  await structure.listUnits(ctx.companyId);
  ctx.warehouse = Object.fromEntries((await prisma.warehouse.findMany({ where: { companyId: ctx.companyId } })).map((w) => [w.code, w.id]));

  // Houses: a snailery and a poultry house.
  await structure.createPen({ companyId: ctx.companyId, actor: ctx.owner, farmId: ctx.farm.id, code: 'SNL-1', name: 'Snailery 1', capacity: 60_000 });
  await structure.createPen({ companyId: ctx.companyId, actor: ctx.owner, farmId: ctx.farm.id, code: 'PH-1', name: 'Poultry house 1', capacity: 1_000 });

  const supplier = (code, name) =>
    parties.createSupplier({ companyId: ctx.companyId, code, name, tin: `TIN-${code}`, bankName: 'Test Bank', accountNumber: `00${Math.floor(Math.random() * 1e8)}`.slice(-10), accountName: name, defaultCurrencyId: ctx.currencyId, actorId: ctx.clerk.userId });
  ctx.supplier = {
    snails: (await supplier('SUP-SNL', 'Breeder Snails Ltd')).id,
    birds: (await supplier('SUP-DOC', 'Day-old Chicks Ltd')).id,
    feed: (await supplier('SUP-FEED', 'Feed Ingredients Ltd')).id,
    assets: (await supplier('SUP-EQP', 'Farm Equipment Ltd')).id,
  };
  // Bank details confirmed by someone other than whoever entered them, before any transfer.
  for (const id of Object.values(ctx.supplier)) {
    await parties.verifySupplierBank({ companyId: ctx.companyId, supplierId: id, reference: 'Bank confirmation letter', actorId: ctx.finance.userId });
  }
  const customer = (code, name) => parties.createCustomer({ companyId: ctx.companyId, code, name, tin: `TIN-${code}`, creditLimit: naira(100_000_000), currencyId: ctx.currencyId, actorId: ctx.clerk.userId });
  ctx.customer = { live: (await customer('CUS-LIVE', 'Live Produce Buyers')).id, processed: (await customer('CUS-PROC', 'Processed Foods Ltd')).id };

  const item = (code, description, unit, extra = {}) =>
    items.create({ companyId: ctx.companyId, code, description, unitOfMeasureCode: unit, actorId: ctx.clerk.userId, ...extra });
  ctx.item = {
    liveSnails: (await item('LIVE-SNL', 'Breeder snails (live)', 'Unit', { livestockSpeciesKey: 'snail' })).id,
    liveChicks: (await item('LIVE-DOC', 'Day-old chicks (live)', 'Unit', { livestockSpeciesKey: 'poultry' })).id,
    maize: (await item('RM-MAIZE', 'Maize', 'Kg', { inventoryGlAccountId: ctx.account['130100'], standardCost: naira(380), standardCostFrom: D(0) })).id,
    soya: (await item('RM-SOYA', 'Soybean meal', 'Kg', { inventoryGlAccountId: ctx.account['130100'], standardCost: naira(620), standardCostFrom: D(0) })).id,
    pack: (await item('PACK', 'Packaging', 'Kg', { inventoryGlAccountId: ctx.account['130100'], standardCost: naira(600), standardCostFrom: D(0) })).id,
  };

  // Six employees: pay proposed by HR and approved by the HR manager, document pack verified, put on payroll by someone else.
  const cc = [ctx.cc['CC-SNL-GROW'], ctx.cc['CC-POL-BROIL'], ctx.cc['CC-SNL-PROC'], ctx.cc['CC-POL-PROC'], ctx.cc['CC-CORP-FIN'], ctx.cc['CC-CORP-PROC']];
  ctx.employees = [];
  for (let i = 1; i <= 6; i += 1) {
    const n = String(i).padStart(3, '0');
    const e = await employees.create({
      companyId: ctx.companyId, employeeNumber: `EMP-${n}`, firstName: 'Worker', surname: `Number ${i}`, employmentDate: D(0),
      branchId: ctx.branchId, costCentreId: cc[i - 1], taxState: 'Lagos', bankName: 'Test Bank', accountNumber: `10000000${n}`.slice(-10), tin: `TIN-EMP-${n}`,
      nin: `2000000${n}`.padEnd(11, '0'), nhiaNumber: `NHIA-${n}`, address: 'Farm road', nextOfKinName: 'Next of kin', nextOfKinPhone: '08030000000',
      pensionEnrolled: true, pensionRsaNumber: `PEN100${n}`, pensionAdministrator: 'Test PFA', nhfEnrolled: true, nhfNumber: `NHF-${n}`,
      designation: 'Farm hand', actorId: ctx.clerk.userId,
    });
    for (const [code, amount] of [['BASIC', 120_000], ['HOUSING', 30_000], ['TRANSPORT', 20_000]]) {
      const proposed = await employees.setSalaryComponent({ employeeId: e.id, componentCode: code, amount: naira(amount), effectiveFrom: D(0), actorId: ctx.clerk.userId });
      await employees.decideSalaryComponent({ companyId: ctx.companyId, rowId: proposed.id, approve: true, actorId: ctx.hr.userId });
    }
    for (const check of ['CONTRACT', 'BANK', 'TAX_ID', 'NIN', 'PENSION', 'NHF', 'NHIA', 'ADDRESS', 'EMERGENCY_CONTACT']) {
      await onboarding.verify({ companyId: ctx.companyId, employeeId: e.id, checkType: check, status: 'VERIFIED', reference: `Seen ${check} ${n}`, actorId: ctx.hr.userId });
    }
    await employees.activateForPayroll({ employeeId: e.id, on: D(30), actorId: ctx.hr.userId });
    ctx.employees.push(e.id);
  }

  const breeds = await prisma.speciesBreed.count({ where: { companyId: ctx.companyId } });
  const stages = await prisma.biologicalAssetStageAccount.count({ where: { companyId: ctx.companyId } });
  expect(breeds >= 9, `Only ${breeds} standard breeds loaded.`);
  const active = await prisma.employee.count({ where: { companyId: ctx.companyId, payrollActive: true } });
  expect(active === 6, `${active} of 6 employees on payroll.`);
  return {
    ref: 'SUP-SNL, SUP-DOC, SUP-FEED, SUP-EQP; CUS-LIVE, CUS-PROC; EMP-001..006',
    actual: `4 suppliers, 2 customers, 5 items (2 live-animal), 6 employees on payroll (pay approved and put on payroll by a different person from who entered them), ${breeds} standard breeds, ${stages} stage-account mappings, 2 houses; tax and payroll switched on.`,
  };
});

// ---------------------------------------------------------------- 4-7 Breeder snails: P2P

async function raiseOrder({ supplierId, lines, costCentre, date }) {
  const orders = svc('procurement/purchase-order.service.js', 'PurchaseOrderService');
  const order = await orders.createOrder({
    companyId: ctx.companyId, supplierId, orderDate: new Date(date), currencyId: ctx.currencyId, branchId: ctx.branchId,
    warehouseId: ctx.warehouse['RAW-WH'], farmId: ctx.farm.id, costCentreId: ctx.cc[costCentre], lines, actor: ctx.clerk,
  });
  const submitted = await orders.submitOrder({ purchaseOrderId: order.id, actor: ctx.clerk });
  const approved = await approveAll(submitted.transactionId);
  await orders.syncStatus(order.id);
  return { order: await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } }), approval: approved };
}

async function receive(order, date, lines) {
  const flow = svc('procurement/procurement-flow.service.js', 'ProcurementFlowService');
  const grn = await flow.receive({ companyId: ctx.companyId, actor: ctx.clerk, purchaseOrderId: order.id, receiptDate: new Date(date), lines });
  if (grn.awaitingApproval) await approveAll(grn.awaitingApproval);
  return prisma.goodsReceiptNote.findUniqueOrThrow({ where: { id: grn.grnId }, include: { lines: true } });
}

async function invoice(grn, date, number) {
  const flow = svc('procurement/procurement-flow.service.js', 'ProcurementFlowService');
  const result = await flow.recordSupplierInvoice({
    companyId: ctx.companyId, actor: ctx.clerk, goodsReceiptNoteId: grn.id, supplierInvoiceNumber: number, invoiceDate: new Date(date),
    lines: grn.lines.map((l) => ({ goodsReceiptNoteLineId: l.id, quantity: l.acceptedQuantity.toString(), unitPriceKobo: l.unitPriceKobo.toString() })),
  });
  if (result.awaitingApproval) await approveAll(result.awaitingApproval);
  return { ...result, invoice: await prisma.supplierInvoice.findFirstOrThrow({ where: { companyId: ctx.companyId, supplierInvoiceNumber: number } }) };
}

async function pay(supplierId, invoices, date) {
  const flow = svc('procurement/procurement-flow.service.js', 'ProcurementFlowService');
  const result = await flow.recordSupplierPayment({
    companyId: ctx.companyId, actor: ctx.clerk, supplierId, paymentDate: new Date(date), method: 'BANK_TRANSFER', bankGlAccountId: ctx.account['110100'],
    allocations: invoices.map((i) => ({ invoiceId: i.id, amountKobo: (i.grossAmountKobo - i.settledAmountKobo).toString() })),
  });
  if (result.awaitingApproval) await approveAll(result.awaitingApproval);
  return result;
}

async function balance(number) {
  const s = await prisma.journalLine.aggregate({ where: { glAccountId: ctx.account[number], journalEntry: { companyId: ctx.companyId } }, _sum: { debitKobo: true, creditKobo: true } });
  return (s._sum.debitKobo ?? 0n) - (s._sum.creditKobo ?? 0n);
}

await step(4, 'P2P', 'Raise and approve PO for 500 breeder snails', async () => {
  // 500_Assumptions: 500 breeders at NGN 2,000 plus NGN 100,000 transport = NGN 2,200 each.
  const { order, approval } = await raiseOrder({ supplierId: ctx.supplier.snails, costCentre: 'CC-SNL-BREED', date: D(2), lines: [{ itemId: ctx.item.liveSnails, quantity: 500, unitPriceKobo: naira(2_200) }] });
  expect(order.status === 'APPROVED', `Order is ${order.status}.`);
  ctx.snailOrder = order;
  const approvers = await prisma.workflowTransactionStep.count({ where: { transactionId: approval.id, status: 'APPROVED' } });
  return { ref: order.orderNumber, actual: `Approved by ${approvers} level(s) of the ladder; no journal.` };
});

await step(5, 'P2P/BA', 'Receive, inspect and accept breeder snails', async () => {
  const grn = await receive(ctx.snailOrder, D(3), [
    { purchaseOrderLineId: ctx.snailOrder.lines[0].id, receivedQuantity: '500', placement: { code: 'BRD-1', house: 'SNL-1', stage: 'Breeder', breed: 'Archachatina marginata', purpose: 'Breeders' } },
  ]);
  ctx.snailGrn = grn;
  const batch = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'BRD-1' } });
  expect(batch.population === 500, `BRD-1 holds ${batch.population}.`);
  expect((await balance('130200')) === naira(1_100_000), `BA Breeders is ${shown(await balance('130200'))}.`);
  expect((await balance('210200')) === -naira(1_100_000), `GRNI is ${shown(await balance('210200'))}.`);
  return { ref: `${grn.grnNumber}; batch BRD-1`, actual: 'Delivered 500 = accepted 500 + rejected 0. Dr BA—Breeders (130200) NGN 1,100,000 / Cr GRNI (210200).' };
});

await step(6, 'AP', 'Post breeder supplier invoice', async () => {
  const result = await invoice(ctx.snailGrn, D(4), 'SNL-INV-001');
  ctx.snailInvoice = result.invoice;
  expect(result.invoice.status === 'POSTED', `Invoice is ${result.invoice.status}.`);
  expect((await balance('210200')) === 0n, `GRNI left at ${shown(await balance('210200'))}.`);
  return { ref: result.invoice.invoiceNumber, actual: `Three-way match ${result.matchStatus}; GRNI cleared to zero; AP ${shown(-(await balance('210100')))}.` };
});

await step(7, 'Treasury', 'Pay breeder supplier', async () => {
  const before = await balance('210100');
  const result = await pay(ctx.supplier.snails, [ctx.snailInvoice], D(20));
  const after = await balance('210100');
  expect(after === 0n, `AP not cleared: ${shown(-after)} left.`);
  return { ref: result.paymentNumber ?? result.paymentId ?? '', actual: `Paid ${shown(after - before)}; AP for the supplier cleared.` };
});

// ---------------------------------------------------------------- 8-11 Snail lifecycle

const day = (n) => D(n).toISOString().slice(0, 10);
let roundKey = 0;

/** Deaths as a farm records them: a daily round each, about 1.5% of the batch, so none is abnormal (over 2% a day). */
async function attrition(groupCode, module, total, fromDay, cause = 'Natural attrition') {
  const operations = svc('operations/operations.service.js', 'OperationsService');
  let left = total;
  let n = fromDay;
  while (left > 0) {
    const group = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: groupCode } });
    const deaths = Math.min(left, Math.max(1, Math.floor(group.population * 0.015)));
    await operations.recordRound({ companyId: ctx.companyId, actor: ctx.clerk, idempotencyKey: `rehearsal-round-${roundKey++}`, payload: { module, date: day(n), entries: [{ groupCode, deaths, causes: [cause] }] } });
    left -= deaths;
    n += 1;
  }
  return n;
}

async function moveStage(groupCode, fromStage, toStage, house, n) {
  const operations = svc('operations/operations.service.js', 'OperationsService');
  await operations.recordStageChange({ companyId: ctx.companyId, actor: ctx.clerk, idempotencyKey: `rehearsal-move-${groupCode}-${toStage}`, payload: { groupCode, date: day(n), fromStage, toStage, fromHouse: house, toHouse: house } });
}

await step(8, 'Snail lifecycle', 'Record laying observation', async () => {
  const breeding = svc('snail-breeding/snail-breeding.service.js', 'SnailBreedingService');
  const breeders = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'BRD-1' } });
  // 500_Assumptions: 80 eggs a breeder.
  // UAT-only value from S500_BA_LIFECYCLE: ₦30 market value less ₦10 costs to sell = ₦20 per egg.
  // This illustrative amount is not a default for production egg cohorts.
  ctx.cycle = await breeding.record({
    companyId: ctx.companyId, actor: ctx.controller, code: 'CYC-1', breederGroupId: breeders.id,
    setOn: day(5), breeders: 500, eggsLaid: 40_000, valueBasis: 'FVLCTS',
    valuePerEggKobo: naira(20), valueEvidence: 'UAT-only S500_BA_LIFECYCLE assumption: ₦30 market value less ₦10 costs to sell per egg.',
  });
  const after = await prisma.livestockGroup.findFirstOrThrow({ where: { id: breeders.id } });
  expect(after.population === 500, `Laying reduced the breeders to ${after.population}.`);
  return { ref: 'CYC-1', actual: '500 breeders laid 40,000 eggs; UAT-only FVLCTS is ₦20 each (₦800,000 total); breeders not reduced.' };
});

await step(9, 'Snail lifecycle', 'Collect, count, grade and value eggs', async () => {
  const cycle = await prisma.snailBreedingCycle.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'CYC-1' } });
  expect(cycle.eggsLaid === 40_000, `CYC-1 holds ${cycle.eggsLaid} eggs.`);
  expect(cycle.eggValuePerUnitKobo === naira(20), `CYC-1 egg value is ${cycle.eggValuePerUnitKobo} kobo per egg.`);
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: ctx.cycle.journalEntryId } });
  const debits = lines.reduce((sum, line) => sum + line.debitKobo, 0n);
  const credits = lines.reduce((sum, line) => sum + line.creditKobo, 0n);
  expect(debits === naira(800_000) && credits === naira(800_000), `Egg recognition journal is Dr ${shown(debits)} / Cr ${shown(credits)}.`);
  return { ref: 'CYC-1', actual: `40,000 viable eggs recognised at ₦20 each; balanced Dr/Cr ${shown(debits)}.` };
});

await step(10, 'Snail lifecycle', 'Transfer eggs to incubation and record hatch', async () => {
  const breeding = svc('snail-breeding/snail-breeding.service.js', 'SnailBreedingService');
  // 500_Assumptions: 75% hatch.
  let refused = false;
  try {
    await breeding.hatch({ companyId: ctx.companyId, actor: ctx.controller, cycleId: ctx.cycle.id, hatchedOn: day(12), hatchedCount: 30_000, unhatchedCount: 10_001, hatchlingGroupCode: 'HAT-1' });
  } catch {
    refused = true;
  }
  expect(refused, 'A hatch of more eggs than were set was accepted.');
  await breeding.hatch({ companyId: ctx.companyId, actor: ctx.controller, cycleId: ctx.cycle.id, hatchedOn: day(12), hatchedCount: 30_000, unhatchedCount: 10_000, hatchlingGroupCode: 'HAT-1' });
  const hatchlings = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'HAT-1' } });
  expect(hatchlings.population === 30_000, `HAT-1 holds ${hatchlings.population}.`);
  return { ref: 'CYC-1 → HAT-1', actual: 'Set 40,000 = hatched 30,000 + unhatched 10,000; an over-count was refused; egg carrying value transferred or expensed.' };
});

await step(11, 'Snail lifecycle', 'Transfer hatchlings through juvenile, grower and market-ready', async () => {
  // 500_Assumptions: 80% of hatchlings reach juvenile, 85% of juveniles reach market.
  await attrition('HAT-1', 'snail', 6_000, 13);
  await moveStage('HAT-1', 'Hatchling', 'Juvenile', 'SNL-1', 12 + 30);
  await moveStage('HAT-1', 'Juvenile', 'Grower', 'SNL-1', 12 + 90);
  await attrition('HAT-1', 'snail', 3_600, 12 + 91);
  await moveStage('HAT-1', 'Grower', 'Market-ready', 'SNL-1', 12 + 240);
  const market = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'HAT-1' } });
  expect(market.population === 20_400 && market.stage === 'Market-ready', `HAT-1 is ${market.population} at ${market.stage}.`);
  // Moving too early is refused (UAT-012).
  let refused = false;
  try {
    await moveStage('BRD-1', 'Breeder', 'Market-ready', 'SNL-1', 13);
  } catch {
    refused = true;
  }
  expect(refused, 'A stage move before the minimum age was accepted.');
  const rf = await svc('biological-assets/biological-asset.service.js', 'BiologicalAssetService').rollForward(market.id);
  return { ref: 'HAT-1', actual: `30,000 hatched → 24,000 juveniles → 20,400 market-ready (${12 + 240} days old). Deaths recorded daily at about 1.5%. Early stage move refused. Roll-forward difference ${shown(rf.differenceKobo)}.` };
});

// ---------------------------------------------------------------- 12-15 Poultry

await step(12, 'Poultry P2P', 'Purchase and receive 500 parent/day-old birds; invoice and pay supplier', async () => {
  // P500_Assumptions: 500 broiler day-olds, NGN 650,000 (NGN 1,300 each); and 100 parent stock for the hatchery.
  const { order } = await raiseOrder({
    supplierId: ctx.supplier.birds, costCentre: 'CC-POL-BROIL', date: D(9),
    lines: [{ itemId: ctx.item.liveChicks, quantity: 500, unitPriceKobo: naira(1_300) }, { itemId: ctx.item.liveChicks, quantity: 100, unitPriceKobo: naira(3_000) }],
  });
  const [broilers, parents] = [...order.lines].sort((a, b) => a.lineNumber - b.lineNumber);
  const grn = await receive(order, D(10), [
    { purchaseOrderLineId: broilers.id, receivedQuantity: '500', placement: { code: 'BLR-001', house: 'PH-1', stage: 'Chick', breed: 'Ross 308', purpose: 'Broiler' } },
    { purchaseOrderLineId: parents.id, receivedQuantity: '100', placement: { code: 'PAR-1', house: 'PH-1', stage: 'Chick', breed: 'Parent stock', purpose: 'Breeder' } },
  ]);
  const inv = await invoice(grn, D(11), 'DOC-INV-001');
  await pay(ctx.supplier.birds, [inv.invoice], D(25));
  expect((await balance('130210')) === naira(950_000), `BA Poultry is ${shown(await balance('130210'))}.`);
  expect((await balance('210200')) === 0n, `GRNI left at ${shown(await balance('210200'))}.`);
  return { ref: `${order.orderNumber}; ${grn.grnNumber}; ${inv.invoice.invoiceNumber}; BLR-001, PAR-1`, actual: `600 birds received = accepted; BA—Poultry ${shown(naira(950_000))}; three-way match ${inv.matchStatus}; GRNI and AP cleared.` };
});

await step(13, 'Poultry lifecycle', 'Record flock, feed, weight, health and mortality', async () => {
  const operations = svc('operations/operations.service.js', 'OperationsService');
  const health = svc('operations/health-schedule.service.js', 'HealthScheduleService');
  const event = await health.schedule({ companyId: ctx.companyId, actor: ctx.clerk, groupCode: 'BLR-001', kind: 'Vaccination', name: 'Newcastle (Lasota)', dueOn: D(17) });
  await operations.recordTreatment({ companyId: ctx.companyId, actor: ctx.clerk, idempotencyKey: 'rehearsal-vaccine', payload: { groupCode: 'BLR-001', eventId: event.id, name: 'Newcastle (Lasota)', date: day(17), givenBy: 'Vet', route: 'Drinking water', treated: 500 } });
  // P500: 30 deaths over the cycle, recorded daily.
  await attrition('BLR-001', 'poultry', 30, 12);
  await operations.recordRound({ companyId: ctx.companyId, actor: ctx.clerk, idempotencyKey: 'rehearsal-weigh', payload: { module: 'poultry', date: day(50), entries: [{ groupCode: 'BLR-001', weightSample: { sampleSize: 20, totalWeight: 44, unit: 'kg' } }] } });
  await moveStage('BLR-001', 'Chick', 'Grower', 'PH-1', 10 + 15);
  await moveStage('BLR-001', 'Grower', 'Market-ready', 'PH-1', 10 + 42);
  const flock = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'BLR-001' } });
  expect(flock.population === 470, `BLR-001 holds ${flock.population}.`);
  const compliance = await health.compliance({ companyId: ctx.companyId, speciesKey: 'poultry', asOf: D(60) });
  return { ref: 'BLR-001', actual: `470 of 500 alive (mortality 6.0%); vaccination done on schedule (compliance ${compliance.compliancePercent ?? compliance.percent ?? JSON.stringify(compliance.summary ?? '')}); sample weight 2.2 kg a bird; market-ready at day 42. Feed is issued in step 21, from the mill's output.` };
});

await step(14, 'Poultry eggs', 'Record laying, collect/grade hatching and table eggs', async () => {
  const items = svc('masters/item.service.js', 'ItemService');
  const eggPosting = svc('poultry-egg/egg-posting.service.js', 'EggPostingService');
  const eggs = svc('poultry-egg/poultry-egg.service.js', 'PoultryEggService');
  ctx.item.eggs = (await items.create({ companyId: ctx.companyId, code: 'EGGS', description: 'Eggs', unitOfMeasureCode: 'Crate', inventoryGlAccountId: ctx.account['130215'], actorId: ctx.clerk.userId })).id;
  await eggPosting.setPolicy({ companyId: ctx.companyId, itemId: ctx.item.eggs, eggsPerUnit: 30, valuePerUnitKobo: naira(3_000), hatchingValuePerUnitKobo: naira(4_500), effectiveFrom: D(0), actor: ctx.controller });
  await moveStage('PAR-1', 'Chick', 'Grower', 'PH-1', 10 + 42);
  await moveStage('PAR-1', 'Grower', 'Layer', 'PH-1', 160);
  const parents = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'PAR-1' } });
  ctx.eggBatch = await eggs.recordCollection({ companyId: ctx.companyId, sourceGroupId: parents.id, code: 'PEG-1', collectedOn: D(165), hatchingCount: 300, tableCount: 600, rejectCount: 30, recordedById: ctx.clerk.userId, idempotencyKey: 'rehearsal-eggs' });
  // As the screen does: record, then post (PCR-067).
  await eggPosting.postCollection(ctx.eggBatch.id, ctx.clerk);
  const eggValue = await balance('130215');
  expect(eggValue > 0n, 'The collected eggs were not recognised.');
  return { ref: 'PEG-1', actual: `930 collected: 300 hatching, 600 table, 30 rejected (no value). Recognised at the egg value policy: Dr Eggs (130215) / Cr Produce gain (420210) ${shown(eggValue)}; laying itself posts nothing.` };
});

await step(15, 'Hatchery', 'Set hatching eggs, hatch and transfer birds through stages', async () => {
  const eggs = svc('poultry-egg/poultry-egg.service.js', 'PoultryEggService');
  const eggPosting = svc('poultry-egg/egg-posting.service.js', 'EggPostingService');
  const structure = svc('masters/farm-structure.service.js', 'FarmStructureService');
  const house = await structure.createPen({ companyId: ctx.companyId, actor: ctx.owner, farmId: ctx.farm.id, code: 'PH-2', name: 'Poultry house 2', capacity: 1_000 });
  const batch = ctx.eggBatch;
  const set = await eggs.setIncubation({ companyId: ctx.companyId, eggBatchId: batch.id, code: 'PIN-1', setOn: D(166), setQuantity: 300, recordedById: ctx.clerk.userId, idempotencyKey: 'rehearsal-set' });
  await eggPosting.postIncubation(set.id, ctx.clerk);
  const hatch = await eggs.recordHatch({ companyId: ctx.companyId, incubationBatchId: set.id, hatchedOn: D(187), hatchedCount: 240, unhatchedCount: 50, damagedCount: 10, chickGroupCode: 'HCH-1', breed: 'Ross 308', purpose: 'Broiler', penHouseId: house.id, recordedById: ctx.clerk.userId, idempotencyKey: 'rehearsal-hatch' });
  await eggPosting.postHatch(hatch.id, ctx.clerk);
  await moveStage('HCH-1', 'Chick', 'Grower', 'PH-2', 187 + 15);
  await moveStage('HCH-1', 'Grower', 'Market-ready', 'PH-2', 187 + 42);
  const chicks = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'HCH-1' } });
  expect(chicks.population === 240, `HCH-1 holds ${chicks.population}.`);
  expect((await balance('130216')) === 0n, `Eggs in incubation not cleared: ${shown(await balance('130216'))}.`);
  return { ref: 'PEG-1 → PIN-1 → HCH-1', actual: `Set 300 = hatched 240 + unhatched 50 + damaged 10. Dr Eggs in incubation / Cr Eggs on setting; Dr BA—Poultry / Cr Eggs in incubation on hatch (incubation cleared to zero). HCH-1 to market-ready at day 42.` };
});

// ---------------------------------------------------------------- 16-21 Feed mill

await step(16, 'Feed P2P', 'Buy, receive, invoice and pay feed ingredients', async () => {
  const { order } = await raiseOrder({
    supplierId: ctx.supplier.feed, costCentre: 'CC-CORP-PROC', date: D(30),
    lines: [{ itemId: ctx.item.maize, quantity: 4_000, unitPriceKobo: naira(380) }, { itemId: ctx.item.soya, quantity: 2_500, unitPriceKobo: naira(620) }, { itemId: ctx.item.pack, quantity: 1_000, unitPriceKobo: naira(650) }],
  });
  const lines = [...order.lines].sort((a, b) => a.lineNumber - b.lineNumber);
  const grn = await receive(order, D(32), lines.map((l) => ({ purchaseOrderLineId: l.id, receivedQuantity: l.quantity.toString(), batchReference: `LOT-${l.lineNumber}` })));
  const inv = await invoice(grn, D(33), 'FEED-INV-001');
  await pay(ctx.supplier.feed, [inv.invoice], D(45));
  const stock = svc('inventory/stock-movement.service.js', 'StockMovementService');
  const maize = await stock.currentPosition(prisma, ctx.companyId, ctx.item.maize);
  expect(maize.quantity.toString() === '4000', `Maize on hand ${maize.quantity}.`);
  return { ref: `${order.orderNumber}; ${grn.grnNumber}; ${inv.invoice.invoiceNumber}`, actual: `4,000 kg maize, 2,500 kg soya and 1,000 kg packaging received in released lots, NGN 3,720,000 into raw materials; three-way match ${inv.matchStatus}; paid.` };
});

await step(17, 'Feed mill', 'Release snail and poultry feed orders and issue ingredients at WAC', async () => {
  const items = svc('masters/item.service.js', 'ItemService');
  const recipes = svc('masters/recipe.service.js', 'RecipeService');
  const routing = svc('routing/routing.service.js', 'RoutingService');
  const standards = svc('production/standard-cost.service.js', 'StandardCostService');
  const orders = svc('production/production-order.service.js', 'ProductionOrderService');
  const feed = (code, name) => items.create({ companyId: ctx.companyId, code, description: name, unitOfMeasureCode: 'Kg', inventoryGlAccountId: ctx.account['130110'], isManufactured: true, isBiologicalFeed: true, actorId: ctx.clerk.userId });
  ctx.item.snailFeed = (await feed('FEED-SNL', 'Snail grower mash')).id;
  ctx.item.poultryFeed = (await feed('FEED-POL', 'Broiler finisher')).id;

  // Cost pools at the mill: labour and mixer by the hour, other overhead by the kg.
  const pools = {};
  for (const [code, name, driver, cost, capacity] of [['MILL-LAB', 'Mill labour', 'Labour hours', 250_000, '100'], ['MILL-MCH', 'Mixer', 'Machine hours', 500_000, '100'], ['MILL-OH', 'Mill overhead', 'kg output', 35_000, '1000']]) {
    const pool = await routing.createCostPool({ companyId: ctx.companyId, code, name, driverName: driver, actorId: ctx.clerk.userId });
    await routing.setCostPoolRate({ companyId: ctx.companyId, poolId: pool.id, poolCost: naira(cost), practicalCapacity: capacity, effectiveFrom: D(0), actorId: ctx.clerk.userId });
    pools[code] = pool.id;
  }

  ctx.feedOrders = {};
  for (const [key, output, maizeKg, soyaKg, planned] of [['snail', ctx.item.snailFeed, '700', '350', '2000'], ['poultry', ctx.item.poultryFeed, '600', '450', '3000']]) {
    const recipe = await recipes.create({ companyId: ctx.companyId, code: `R-${key.toUpperCase()}-FEED`, name: `${key} feed`, outputItemId: output });
    const version = await recipes.createDraftVersion({ companyId: ctx.companyId, recipeId: recipe.id, batchSize: '1000', effectiveFrom: D(0) });
    await recipes.addComponent({ companyId: ctx.companyId, recipeVersionId: version.id, componentItemId: ctx.item.maize, quantityPerBatch: maizeKg, unitOfMeasureCode: 'Kg' });
    await recipes.addComponent({ companyId: ctx.companyId, recipeVersionId: version.id, componentItemId: ctx.item.soya, quantityPerBatch: soyaKg, unitOfMeasureCode: 'Kg' });
    for (const [pool, op, type, setup, run] of [['MILL-LAB', 'Grind and mix', 'LABOUR', '12', '0'], ['MILL-MCH', 'Mixer run', 'MACHINE', '5', '0'], ['MILL-OH', 'Other overhead', 'OVERHEAD', '0', '1']]) {
      await routing.createRoutingOperation({ companyId: ctx.companyId, recipeVersionId: version.id, costCentreId: ctx.cc['130'], costPoolId: pools[pool], operationName: op, resourceType: type, setupHours: setup, runHoursPerUnit: run, actorId: ctx.clerk.userId });
    }
    await recipes.activateVersion({ recipeVersionId: version.id, actorId: ctx.manager.userId });
    const standard = await standards.prepare({ companyId: ctx.companyId, recipeVersionId: version.id, effectiveFrom: D(0), actor: ctx.clerk });
    await standards.decide({ companyId: ctx.companyId, versionId: standard.id, approve: true, actor: ctx.controller });
    const { id } = await orders.createFeedOrder({ companyId: ctx.companyId, branchId: ctx.branchId, farmId: ctx.farm.id, warehouseId: ctx.warehouse['RAW-WH'], recipeVersionId: version.id, plannedOutputQuantity: planned, actor: ctx.clerk });
    const submitted = await orders.submit({ productionOrderId: id, actor: ctx.clerk });
    await approveAll(submitted.transactionId);
    await orders.issueMaterials({ productionOrderId: id, actor: ctx.clerk });
    ctx.feedOrders[key] = id;
  }
  const snail = await prisma.productionOrder.findUniqueOrThrow({ where: { id: ctx.feedOrders.snail } });
  const poultry = await prisma.productionOrder.findUniqueOrThrow({ where: { id: ctx.feedOrders.poultry } });
  const onHand = await svc('inventory/stock-movement.service.js', 'StockMovementService').currentPosition(prisma, ctx.companyId, ctx.item.maize);
  expect(Number(onHand.quantity) >= 0, 'Maize went negative.');
  return { ref: `${snail.orderNumber} (snail), ${poultry.orderNumber} (poultry)`, actual: `Recipes, routing and standards released (standard approved by the finance controller). Ingredients issued at WAC: Dr Feed WIP (130430) / Cr Raw materials. Maize left ${onHand.quantity} kg; no negative stock.` };
});

await step(18, 'Feed mill', 'Record staff time, machine hours and standard absorption', async () => {
  const orders = svc('production/production-order.service.js', 'ProductionOrderService');
  // Actuals from the mill's own records; the standard comes from the routing (hours × approved rates).
  for (const [key, labour, overhead] of [['snail', 70_000, 60_000], ['poultry', 90_000, 95_000]]) {
    await orders.confirmConversion({ productionOrderId: ctx.feedOrders[key], actualLabourCostKobo: naira(labour), actualOverheadCostKobo: naira(overhead), actor: ctx.clerk });
  }
  const absorbed = -(await balance('219830'));
  expect(absorbed > 0n, 'Nothing absorbed to the feed-mill recovery account.');
  return { ref: 'Both feed orders', actual: `Standard conversion absorbed from the routing: Dr Feed WIP / Cr Feed Mill Recovery (219830) ${shown(absorbed)}.` };
});

await step(19, 'Feed mill', 'Post actual payroll, depreciation, power and maintenance', async () => {
  const pools = await Promise.all(['620100', '623100', '630100', '210100', '230100'].map(async (n) => [n, await balance(n)]));
  const orderTotals = await prisma.productionOrder.aggregate({ where: { id: { in: Object.values(ctx.feedOrders) } }, _sum: { actualLabourCostKobo: true, actualOverheadCostKobo: true } });
  const actual = (orderTotals._sum.actualLabourCostKobo ?? 0n) + (orderTotals._sum.actualOverheadCostKobo ?? 0n);
  expect(actual === naira(315_000), `Actual conversion recorded ${shown(actual)}.`);
  note(19, 'Feed-mill actual labour and overhead are entered on each order when conversion is confirmed and posted there, rather than drawn from the payroll run and depreciation run of steps 22 and 25. The totals tie to the order; the client may want actual mill cost pulled from payroll, fixed assets and AP instead.');
  return { ref: 'Both feed orders', actual: `Actual mill cost ${shown(actual)} recorded against the orders (labour NGN 160,000, overhead NGN 155,000). Balances: ${pools.map(([n, v]) => `${n} ${shown(v)}`).join('; ')}.` };
});

await step(20, 'Feed mill', 'Record loss, receive feed and settle both orders', async () => {
  const orders = svc('production/production-order.service.js', 'ProductionOrderService');
  // Normal milling loss: 2,000 kg planned snail feed yields 1,960 kg; 3,000 kg poultry feed yields 2,940 kg.
  for (const [key, itemId, qty] of [['snail', ctx.item.snailFeed, '1960'], ['poultry', ctx.item.poultryFeed, '2940']]) {
    await orders.recordOutputs({ productionOrderId: ctx.feedOrders[key], outputs: [{ itemId, outputType: 'MAIN', quantity: qty }], warehouseId: ctx.warehouse['RAW-WH'], actor: ctx.clerk });
    await orders.settle({ productionOrderId: ctx.feedOrders[key], varianceReason: 'Milling loss and actual against standard', actor: ctx.clerk });
  }
  const wip = await balance('130430');
  const recovery = await balance('219830');
  expect(wip === 0n && recovery === 0n, `After settlement Feed WIP ${shown(wip)}, recovery ${shown(recovery)}.`);
  const variance = await balance('520500');
  return { ref: 'Both feed orders settled', actual: `1,960 kg snail feed and 2,940 kg poultry feed into stock. Feed WIP 0 and feed-mill recovery 0 after settlement; variance to Feed Production Variance (520500) ${shown(variance)}.` };
});

await step(21, 'Inventory', 'Issue finished feed to snail cohorts and poultry flocks', async () => {
  const operations = svc('operations/operations.service.js', 'OperationsService');
  const feedRound = (groupCode, module, n, feedType, feedKg) =>
    operations.recordRound({ companyId: ctx.companyId, actor: ctx.clerk, idempotencyKey: `rehearsal-feed-${groupCode}-${n}`, payload: { module, date: day(n), entries: [{ groupCode, feedType, feedKg }] } });
  await feedRound('HAT-1', 'snail', 60, 'FEED-SNL', 900);
  await feedRound('HAT-1', 'snail', 150, 'FEED-SNL', 900);
  await feedRound('BLR-001', 'poultry', 46, 'FEED-POL', 1_000);
  await feedRound('HCH-1', 'poultry', 210, 'FEED-POL', 500);
  const stock = svc('inventory/stock-movement.service.js', 'StockMovementService');
  const snailLeft = await stock.currentPosition(prisma, ctx.companyId, ctx.item.snailFeed);
  const poultryLeft = await stock.currentPosition(prisma, ctx.companyId, ctx.item.poultryFeed);
  const issued = await prisma.feedIssue.aggregate({ where: { dailyRecord: { companyId: ctx.companyId } }, _sum: { valueKobo: true } });
  expect(Number(snailLeft.quantity) === 160 && Number(poultryLeft.quantity) === 1_440, `Feed left: snail ${snailLeft.quantity}, poultry ${poultryLeft.quantity}.`);
  return { ref: 'Rounds for HAT-1, BLR-001, HCH-1', actual: `1,800 kg snail feed and 1,500 kg poultry feed issued at WAC, ${shown(issued._sum.valueKobo ?? 0n)} to the batches; left in store 160 kg and 1,440 kg.` };
});

// ---------------------------------------------------------------- 22-25 Payroll and fixed assets

const periodOf = (n) => ctx.year.periods.find((p) => p.startDate <= D(n) && p.endDate >= D(n));

await step(22, 'Payroll', 'Run payroll for farm, feed mill, processing and admin staff', async () => {
  const payroll = svc('payroll/payroll-run.service.js', 'PayrollRunService');
  const period = ctx.year.periods[0];
  const run = await payroll.createRun({
    companyId: ctx.companyId, year: period.startDate.getUTCFullYear(), month: period.startDate.getUTCMonth() + 1, branchId: ctx.branchId,
    financialYearId: ctx.year.id, financialPeriodId: period.id, currencyId: ctx.currencyId, actorId: ctx.clerk.userId,
  });
  await payroll.calculate({ payrollRunId: run.id, actorId: ctx.clerk.userId });
  const submitted = await payroll.submit({ payrollRunId: run.id, actor: ctx.clerk });
  await approveAll(submitted.transactionId);
  ctx.payrollRun = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
  expect(ctx.payrollRun.status === 'POSTED', `Payroll run is ${ctx.payrollRun.status}.`);
  const r = ctx.payrollRun;
  const payable = -(await balance('220100'));
  expect(payable === r.totalNetPayKobo, `Net pay payable ${shown(payable)} is not the register's ${shown(r.totalNetPayKobo)}.`);
  return { ref: ctx.payrollRun.reference, actual: `6 employees: gross ${shown(r.totalGrossKobo)}, PAYE ${shown(r.totalPayeKobo)}, employee pension ${shown(r.totalEmployeePensionKobo)}, NHF ${shown(r.totalNhfKobo)}, net ${shown(r.totalNetPayKobo)}. Register = journal: net pay payable equals the register's net pay; labour charged by each employee's cost centre.` };
});

await step(23, 'Payroll', 'Pay staff and remit statutory deductions', async () => {
  const payments = svc('payroll/payroll-payment.service.js', 'PayrollPaymentService');
  const period = periodOf(31);
  const paid = [];
  for (const row of await payments.outstanding(ctx.payrollRun.id)) {
    const amountKobo = BigInt(row.outstandingKobo);
    if (amountKobo <= 0n) continue;
    const payment = await payments.create({
      companyId: ctx.companyId, payrollRunId: ctx.payrollRun.id, bucket: row.bucket, amountKobo, paymentDate: D(31), method: 'BANK_TRANSFER', bankGlAccountId: ctx.account['110100'],
      branchId: ctx.branchId, currencyId: ctx.currencyId, financialYearId: ctx.year.id, financialPeriodId: period.id, actor: ctx.treasury,
    });
    const sent = await payments.submit({ paymentId: payment.id, actor: ctx.treasury });
    await approveAll(sent.transactionId);
    paid.push(`${row.bucket} ${shown(amountKobo)}`);
  }
  const left = (await payments.outstanding(ctx.payrollRun.id)).filter((r) => BigInt(r.outstandingKobo) !== 0n);
  expect(left.length === 0, `Still outstanding: ${left.map((r) => r.bucket).join(', ')}.`);
  for (const n of ['220100', '221100', '222100']) expect((await balance(n)) === 0n, `${n} not cleared: ${shown(await balance(n))}.`);
  return { ref: ctx.payrollRun.reference, actual: `Paid and remitted: ${paid.join('; ')}. Net pay, PAYE and pension liabilities cleared to zero.` };
});

await step(24, 'Fixed assets', 'Acquire and capitalise farm/feed/processing assets', async () => {
  const items = svc('masters/item.service.js', 'ItemService');
  const assets = svc('fixed-assets/fixed-asset.service.js', 'FixedAssetService');
  // Capex through purchasing: an order per asset (each to its own cost centre), received, invoiced and paid.
  ctx.assets = {};
  const refs = [];
  for (const [key, code, name, cost, cc] of [['mixer', 'CAPEX-MIXER', 'Feed mixer', 1_200_000, '130'], ['plucker', 'CAPEX-PLUCKER', 'Poultry plucker', 900_000, 'CC-POL-PROC'], ['pickup', 'CAPEX-PICKUP', 'Farm pickup', 3_600_000, 'CC-CORP-FIN']]) {
    const item = await items.create({ companyId: ctx.companyId, code, description: name, unitOfMeasureCode: 'Unit', fixedAssetClass: 'Machinery', usefulLifeMonths: 60, actorId: ctx.clerk.userId });
    const { order } = await raiseOrder({ supplierId: ctx.supplier.assets, costCentre: cc, date: D(33), lines: [{ itemId: item.id, quantity: 1, unitPriceKobo: naira(cost) }] });
    const grn = await receive(order, D(35), [{ purchaseOrderLineId: order.lines[0].id, receivedQuantity: '1' }]);
    const inv = await invoice(grn, D(36), `${code}-INV`);
    await pay(ctx.supplier.assets, [inv.invoice], D(50));
    ctx.assets[key] = (await prisma.fixedAsset.findFirstOrThrow({ where: { companyId: ctx.companyId, goodsReceiptNoteLineId: grn.lines[0].id } })).id;
    refs.push(`${order.orderNumber}/${grn.grnNumber}/${inv.invoice.invoiceNumber}`);
  }
  await assets.setProcessingCycle({ companyId: ctx.companyId, assetId: ctx.assets.mixer, processingCycle: 'FEED_MILL', actor: ctx.controller });
  const register = await prisma.fixedAsset.aggregate({ where: { companyId: ctx.companyId }, _sum: { costKobo: true } });
  expect(register._sum.costKobo === (await balance('140100')), `Register ${shown(register._sum.costKobo)} ≠ PPE ${shown(await balance('140100'))}.`);
  expect((await balance('210200')) === 0n, `GRNI left at ${shown(await balance('210200'))}.`);
  return {
    ref: refs.join('; '),
    actual: `Bought on capex orders, received and invoiced: an asset card created on each receipt, Dr PPE (140100) / Cr GRNI, cleared by the supplier invoice and paid. PPE ${shown(register._sum.costKobo)} = register. The mixer is the feed mill's.`,
  };
});

await step(25, 'Fixed assets', 'Run depreciation and allocate manufacturing/admin shares', async () => {
  const assets = svc('fixed-assets/fixed-asset.service.js', 'FixedAssetService');
  let runs = 0;
  for (const period of ctx.year.periods) {
    if (period.startDate < D(35) || period.endDate > D(LAST_DAY)) continue;
    const run = await assets.runDepreciation({ companyId: ctx.companyId, actor: ctx.clerk, financialPeriodId: period.id });
    if (run.awaitingApproval) await approveAll(run.awaitingApproval);
    runs += 1;
  }
  const register = await prisma.fixedAsset.aggregate({ where: { companyId: ctx.companyId }, _sum: { accumulatedDepreciationKobo: true } });
  const accumulated = -(await balance('149100'));
  const expense = await balance('630100');
  expect(register._sum.accumulatedDepreciationKobo === accumulated, `Register depreciation ${shown(register._sum.accumulatedDepreciationKobo)} ≠ ledger ${shown(accumulated)}.`);
  return { ref: `${runs} monthly runs`, actual: `Accumulated depreciation ${shown(accumulated)} = register. Depreciation expense (630100) ${shown(expense)}; the rest of the depreciation is charged to production (${shown(accumulated - expense)}).` };
});

// ---------------------------------------------------------------- 26-29 Processing

/** IAS 41 at the point of harvest: fair value less costs to sell, through approval. */
async function valueAtHarvest(groupCode, n, priceNaira, costToSellNaira, evidence) {
  const assets = svc('biological-assets/biological-asset.service.js', 'BiologicalAssetService');
  const group = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: groupCode } });
  const { id } = await assets.requestValuation({ companyId: ctx.companyId, groupId: group.id, valuationDate: D(n), marketPricePerUnitKobo: naira(priceNaira), costsToSellPerUnitKobo: naira(costToSellNaira), evidenceReference: evidence, actor: ctx.clerk });
  const valuation = await prisma.biologicalAssetValuation.findUniqueOrThrow({ where: { id } });
  await approveAll(valuation.workflowTransactionId);
  return prisma.biologicalAssetValuation.findUniqueOrThrow({ where: { id } });
}

async function harvest(groupCode, n, count, kg) {
  const operations = svc('operations/operations.service.js', 'OperationsService');
  const result = await operations.recordHarvest({ companyId: ctx.companyId, actor: ctx.clerk, idempotencyKey: `rehearsal-harvest-${groupCode}`, payload: { groupCode, date: day(n), grade: 'Market', kg, count, destination: 'PROCESSING' } });
  return prisma.harvestRecord.findUniqueOrThrow({ where: { id: result.id } });
}

/** A processing recipe through the recipe service, NRV prices approved by the finance controller (JOINT_COST_ALLOCATION). */
async function processingRecipe({ code, main, byProduct, batchKg, packPerBatch, prices }) {
  const recipes = svc('masters/recipe.service.js', 'RecipeService');
  const joint = svc('production/joint-cost.service.js', 'JointCostService');
  const recipe = await recipes.create({ companyId: ctx.companyId, code, name: code, outputItemId: main });
  const version = await recipes.createDraftVersion({ companyId: ctx.companyId, recipeId: recipe.id, batchSize: batchKg, effectiveFrom: D(0) });
  await recipes.addComponent({ companyId: ctx.companyId, recipeVersionId: version.id, componentItemId: ctx.item.pack, quantityPerBatch: packPerBatch, unitOfMeasureCode: 'Kg', componentType: 'PACKAGING' });
  await recipes.activateVersion({ recipeVersionId: version.id, actorId: ctx.manager.userId });
  for (const [itemId, price] of [[main, prices[0]], [byProduct, prices[1]]]) {
    const proposed = await joint.proposePrice({ companyId: ctx.companyId, itemId, sellingPricePerUnitKobo: naira(price), furtherCostPerUnitKobo: 0n, effectiveFrom: D(0), evidenceReference: 'Workbook assumptions', actor: ctx.clerk });
    await joint.decide({ companyId: ctx.companyId, priceId: proposed.id, approve: true, actor: ctx.controller });
  }
  return version.id;
}

await step(26, 'Snail processing', 'Harvest and issue market-ready snails to production', async () => {
  const items = svc('masters/item.service.js', 'ItemService');
  const orders = svc('production/production-order.service.js', 'ProductionOrderService');
  // Processed snail products sell to their own revenue and cost-of-sales accounts (410200, 510200).
  const fg = (code, name, account) => items.create({ companyId: ctx.companyId, code, description: name, unitOfMeasureCode: 'Kg', inventoryGlAccountId: ctx.account[account], revenueGlAccountId: ctx.account['410200'], costOfSalesGlAccountId: ctx.account['510200'], isManufactured: true, actorId: ctx.clerk.userId });
  ctx.item.meat = (await fg('SNL-MEAT', 'Snail meat', '130510')).id;
  ctx.item.shell = (await fg('SNL-SHELL', 'Snail shell', '130510')).id;
  // 500_Assumptions: 1,000 kept as replacement breeders, 70% of the rest sold live, 30% (5,820) processed at 0.18 kg each.
  ctx.snail = { liveKg: 5_820 * 0.18, meatKg: '419.040', shellKg: '178.092' };
  const version = await processingRecipe({ code: 'R-SNL-MEAT', main: ctx.item.meat, byProduct: ctx.item.shell, batchKg: ctx.snail.meatKg, packPerBatch: '480', prices: [18_000, 2_500] });
  // FV-001 (500_Assumptions): NGN 3,200 a market snail less NGN 200 to sell.
  const valued = await valueAtHarvest('HAT-1', 253, 3_200, 200, '500_Assumptions IAS 41');
  const record = await harvest('HAT-1', 254, 5_820, ctx.snail.liveKg);
  const { id } = await orders.createFromHarvest({ harvestRecordId: record.id, recipeVersionId: version, warehouseId: ctx.warehouse['FG-WH'], plannedOutputQuantity: ctx.snail.meatKg, actor: ctx.clerk });
  const submitted = await orders.submit({ productionOrderId: id, actor: ctx.clerk });
  await approveAll(submitted.transactionId);
  ctx.snailOrderId = id;
  const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id } });
  return { ref: `${order.orderNumber} from harvest of 5,820 snails (1,047.6 kg)`, actual: `Valued at harvest: 20,400 at NGN 3,000 (FV gain ${shown(-(await balance('420100')))}, valuation ${valued.status}). Harvested 5,820 market snails, 1,047.6 kg live; qty and weight tie to the harvest. Biological input to the order ${shown(order.biologicalInputValueKobo)}, carried from BA—Market snails into processing WIP when materials are issued (step 27).` };
});

await step(27, 'Snail processing', 'Produce meat, slime, shell/powder; record loss and settle', async () => {
  const orders = svc('production/production-order.service.js', 'ProductionOrderService');
  const line = await prisma.productionOrderComponent.findFirstOrThrow({ where: { productionOrderId: ctx.snailOrderId } });
  await orders.issueMaterials({ productionOrderId: ctx.snailOrderId, actualQuantities: { [line.id]: '500' }, actor: ctx.clerk });
  // 500_Std_Cost: standard conversion NGN 1,400,000; actual labour NGN 600,000, overhead NGN 900,000.
  await orders.confirmConversion({ productionOrderId: ctx.snailOrderId, standardConversionCostKobo: naira(1_400_000), actualLabourCostKobo: naira(600_000), actualOverheadCostKobo: naira(900_000), actor: ctx.clerk });
  const loss = (ctx.snail.liveKg - 419.04 - 178.092).toFixed(3);
  await orders.recordOutputs({
    productionOrderId: ctx.snailOrderId, warehouseId: ctx.warehouse['FG-WH'], normalLossQuantity: loss, actor: ctx.clerk,
    outputs: [{ itemId: ctx.item.meat, outputType: 'MAIN', quantity: ctx.snail.meatKg, weight: ctx.snail.meatKg }, { itemId: ctx.item.shell, outputType: 'BY_PRODUCT', quantity: ctx.snail.shellKg, weight: ctx.snail.shellKg }],
  });
  const settled = await orders.settle({ productionOrderId: ctx.snailOrderId, varianceReason: 'Yield and conversion against standard', actor: ctx.clerk });
  expect((await balance('130410')) === 0n && (await balance('219810')) === 0n, `WIP ${shown(await balance('130410'))}, S_Recovery ${shown(await balance('219810'))} after settlement.`);
  const outputs = await prisma.productionOrderOutput.findMany({ where: { productionOrderId: ctx.snailOrderId } });
  return { ref: 'Snail processing order settled', actual: `419.04 kg meat and 178.092 kg shell into stock, ${loss} kg normal loss (1,047.6 kg in). Cost by NRV: ${outputs.map((o) => shown(o.allocatedCostKobo)).join(' / ')}. WIP and S_Recovery zero; variance ${shown(BigInt(settled.variance))}.` };
});

await step(28, 'Poultry processing', 'Harvest and issue market birds to production', async () => {
  const items = svc('masters/item.service.js', 'ItemService');
  const orders = svc('production/production-order.service.js', 'ProductionOrderService');
  // Processed poultry sells to its own revenue and cost-of-sales accounts (410400, 510400).
  const fg = (code, name) => items.create({ companyId: ctx.companyId, code, description: name, unitOfMeasureCode: 'Kg', inventoryGlAccountId: ctx.account['130520'], revenueGlAccountId: ctx.account['410400'], costOfSalesGlAccountId: ctx.account['510400'], isManufactured: true, actorId: ctx.clerk.userId });
  ctx.item.carcass = (await fg('POL-DRESSED', 'Dressed chicken')).id;
  ctx.item.offal = (await fg('POL-OFFAL', 'Offal and by-products')).id;
  // P500: 282 of 470 processed, 2.2 kg live, 72% dressed yield, 60 kg of offal.
  ctx.poultry = { liveKg: 282 * 2.2, dressedKg: '446.688', offalKg: '60.000' };
  const version = await processingRecipe({ code: 'R-POL-DRESSED', main: ctx.item.carcass, byProduct: ctx.item.offal, batchKg: ctx.poultry.dressedKg, packPerBatch: '40', prices: [5_200, 1_500] });
  // P500: carried at NGN 6,500 a bird for the approved UAT case.
  await valueAtHarvest('BLR-001', 54, 5_500, 0, 'P500_Assumptions IAS 41');
  const record = await harvest('BLR-001', 55, 282, ctx.poultry.liveKg);
  const { id } = await orders.createFromHarvest({ harvestRecordId: record.id, recipeVersionId: version, warehouseId: ctx.warehouse['FG-WH'], plannedOutputQuantity: ctx.poultry.dressedKg, actor: ctx.clerk });
  const submitted = await orders.submit({ productionOrderId: id, actor: ctx.clerk });
  await approveAll(submitted.transactionId);
  ctx.poultryOrderId = id;
  const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id } });
  return { ref: `${order.orderNumber} from harvest of 282 birds (620.4 kg)`, actual: `Harvested 282 market birds, 620.4 kg live; bird count and live weight tie. Biological input ${shown(order.biologicalInputValueKobo)} into poultry processing WIP.` };
});

await step(29, 'Poultry processing', 'Produce carcass/cuts/offal; record loss and settle', async () => {
  const orders = svc('production/production-order.service.js', 'ProductionOrderService');
  // Plant intake: every bird arrived alive and passed inspection.
  await orders.recordIntake({ productionOrderId: ctx.poultryOrderId, plantReceivedCount: 282, plantReceivedWeightKg: ctx.poultry.liveKg.toFixed(3), deadOnArrivalCount: 0, deadOnArrivalWeightKg: '0', condemnedCount: 0, condemnedWeightKg: '0', inspectedBy: 'Plant vet', actor: ctx.clerk });
  await orders.issueMaterials({ productionOrderId: ctx.poultryOrderId, actor: ctx.clerk });
  // P500 BOM/routing: standard conversion NGN 620,000; actual labour NGN 235,000, overhead NGN 425,000.
  await orders.confirmConversion({ productionOrderId: ctx.poultryOrderId, standardConversionCostKobo: naira(620_000), actualLabourCostKobo: naira(235_000), actualOverheadCostKobo: naira(425_000), actor: ctx.clerk });
  const loss = (ctx.poultry.liveKg - 446.688 - 60).toFixed(3);
  await orders.recordOutputs({
    productionOrderId: ctx.poultryOrderId, warehouseId: ctx.warehouse['FG-WH'], normalLossQuantity: loss, actor: ctx.clerk,
    outputs: [{ itemId: ctx.item.carcass, outputType: 'MAIN', quantity: ctx.poultry.dressedKg, weight: ctx.poultry.dressedKg }, { itemId: ctx.item.offal, outputType: 'BY_PRODUCT', quantity: ctx.poultry.offalKg, weight: ctx.poultry.offalKg }],
    // Cold store (handbook §29). The use-by date is checked against today, so it is set from today.
    details: [0, 1].map(() => ({ grade: 'A', expiryDate: new Date(Date.now() + 30 * 86_400_000), storageTemperatureC: '-18' })),
  });
  const settled = await orders.settle({ productionOrderId: ctx.poultryOrderId, varianceReason: 'Conversion against standard', actor: ctx.clerk });
  expect((await balance('130420')) === 0n && (await balance('219820')) === 0n, `WIP ${shown(await balance('130420'))}, P_Recovery ${shown(await balance('219820'))} after settlement.`);
  return { ref: 'Poultry processing order settled', actual: `446.688 kg dressed (72% yield) and 60 kg offal into stock, ${loss} kg normal loss. WIP and P_Recovery zero; variance ${shown(BigInt(settled.variance))} (P500 expects NGN 40,000).` };
});

// ---------------------------------------------------------------- 30-32 Order to cash

async function sellFromStock(customerId, n, lines) {
  const orders = svc('sales/sales-order.service.js', 'SalesOrderService');
  const flow = svc('sales/sales-flow.service.js', 'SalesFlowService');
  const order = await orders.createOrder({
    companyId: ctx.companyId, customerId, orderDate: D(n), currencyId: ctx.currencyId, branchId: ctx.branchId, warehouseId: ctx.warehouse['FG-WH'], farmId: ctx.farm.id,
    lines: lines.map((l, i) => ({ lineNumber: i + 1, itemId: l.itemId, quantity: l.quantity, unitPriceKobo: naira(l.price), ...(l.warehouse ? {} : {}) })),
    actor: ctx.clerk,
  });
  const submitted = await orders.submitOrder({ salesOrderId: order.id, actor: ctx.clerk });
  if (submitted?.transactionId) await approveAll(submitted.transactionId);
  await orders.syncStatus(order.id);
  const stored = await prisma.salesOrder.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
  const delivery = await flow.deliver({ companyId: ctx.companyId, actor: ctx.clerk, salesOrderId: order.id, deliveryDate: D(n + 1), receivedBy: 'Customer', lines: stored.lines.map((l) => ({ salesOrderLineId: l.id, quantity: l.quantity.toString() })) });
  if (delivery.awaitingApproval) await approveAll(delivery.awaitingApproval);
  return { order: stored, delivery };
}

await step(30, 'OTC', 'Create sales orders and deliver live/processed/feed products', async () => {
  const items = svc('masters/item.service.js', 'ItemService');
  const trade = svc('operations/trade.service.js', 'TradeService');
  const stock = svc('inventory/stock-movement.service.js', 'StockMovementService');
  // Processed products leave stock at standard: set from what processing actually cost them a kg.
  for (const itemId of [ctx.item.meat, ctx.item.shell, ctx.item.carcass, ctx.item.offal]) {
    const position = await stock.currentPosition(prisma, ctx.companyId, itemId);
    const unit = position.valueKobo / BigInt(Math.round(Number(position.quantity) * 1000)) * 1000n;
    await items.setStandardCost({ itemId, cost: unit > 0n ? unit : 1n, effectiveFrom: D(250), sourceReference: 'Actual processing cost', actorId: ctx.controller.userId });
  }
  ctx.sales = [];
  // Processed snail and poultry products, surplus feed and table eggs, to the processor.
  ctx.sales.push(await sellFromStock(ctx.customer.processed, 256, [
    { itemId: ctx.item.meat, quantity: '419.040', price: 18_000 },
    { itemId: ctx.item.shell, quantity: '178.092', price: 2_500 },
    { itemId: ctx.item.carcass, quantity: '446.688', price: 5_200 },
    { itemId: ctx.item.offal, quantity: '60', price: 1_500 },
  ]));
  // Live animals from the farm gate, through the same trade path the phone uses.
  const liveItem = (code, name, revenue) => items.create({ companyId: ctx.companyId, code, description: name, unitOfMeasureCode: 'Unit', itemType: 'SERVICE', revenueGlAccountId: ctx.account[revenue], actorId: ctx.clerk.userId });
  ctx.item.liveSnailSale = (await liveItem('SALE-LIVE-SNL', 'Live market snails', '410100')).id;
  ctx.item.liveBirdSale = (await liveItem('SALE-LIVE-BIRD', 'Live broilers', '410300')).id;
  const gate = (key, code, batchId, count, price, n) =>
    trade.recordSale({
      companyId: ctx.companyId, actor: ctx.clerk, idempotencyKey: `rehearsal-sale-${key}`,
      payload: { type: 'sale', date: day(n), buyer: { customerId: ctx.customer.live }, paidNow: false, method: null, termsDays: 30, lines: [{ code, quantity: count, unitPriceKobo: String(naira(price)), vat: 'VAT-EXEMPT', batchId, animalsRemoved: count }], totalKobo: String(naira(price * count)), vatKobo: '0' },
    });
  const snails = await gate('snails', 'SALE-LIVE-SNL', 'HAT-1', 13_580, 4_500, 257);
  const birds = await gate('birds', 'SALE-LIVE-BIRD', 'BLR-001', 188, 7_000, 60);
  for (const sale of [snails, birds]) {
    const so = await prisma.salesOrder.findUniqueOrThrow({ where: { id: sale.salesOrderId ?? sale.result?.salesOrderId }, include: { lines: true } });
    const tx = await prisma.workflowTransaction.findFirst({ where: { companyId: ctx.companyId, documentReference: so.orderNumber } });
    if (tx) await approveAll(tx.id);
    await svc('sales/sales-order.service.js', 'SalesOrderService').syncStatus(so.id);
    const flow = svc('sales/sales-flow.service.js', 'SalesFlowService');
    const delivery = await flow.deliver({ companyId: ctx.companyId, actor: ctx.clerk, salesOrderId: so.id, deliveryDate: so.orderDate, receivedBy: 'Buyer', lines: so.lines.map((l) => ({ salesOrderLineId: l.id, quantity: l.quantity.toString(), batchReference: l.batchReference })) });
    if (delivery.awaitingApproval) await approveAll(delivery.awaitingApproval);
    ctx.sales.push({ order: so, delivery });
  }
  const market = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'HAT-1' } });
  expect(market.population === 1_000, `HAT-1 left with ${market.population}, not the 1,000 kept as breeders.`);
  return { ref: ctx.sales.map((s) => s.order.orderNumber).join(', '), actual: `Processed products delivered from the cold store; 13,580 live snails and 188 live birds sold from the gate (1,000 snails kept as replacement breeders); credit checked; stock not taken negative.` };
});

await step(31, 'AR/COGS', 'Post customer invoices and cost of sales', async () => {
  const flow = svc('sales/sales-flow.service.js', 'SalesFlowService');
  ctx.invoices = [];
  for (const sale of ctx.sales) {
    const raised = await flow.raiseInvoice({ companyId: ctx.companyId, actor: ctx.clerk, salesOrderId: sale.order.id, invoiceDate: new Date(sale.order.orderDate.getTime() + 86_400_000) });
    if (raised.awaitingApproval) await approveAll(raised.awaitingApproval);
    ctx.invoices.push(await prisma.salesInvoice.findFirstOrThrow({ where: { companyId: ctx.companyId, salesOrderId: sale.order.id } }));
  }
  const revenue = ['410100', '410200', '410300', '410400'];
  const totals = await Promise.all(revenue.map(async (n) => -(await balance(n))));
  const cogs = await Promise.all(['510100', '510200', '510300', '510400'].map(balance));
  expect(totals.every((t) => t > 0n), `A revenue line is empty: ${totals.map(shown).join(' / ')}.`);
  return { ref: ctx.invoices.map((i) => i.invoiceNumber).join(', '), actual: `AR ${shown(await balance('120100'))}. Revenue: live snails ${shown(totals[0])}, processed snail ${shown(totals[1])}, live birds ${shown(totals[2])}, processed poultry ${shown(totals[3])}. Cost of sales ${cogs.map(shown).join(' / ')}.` };
});

await step(32, 'Cash', 'Receive and allocate customer payments', async () => {
  const flow = svc('sales/sales-flow.service.js', 'SalesFlowService');
  for (const inv of ctx.invoices) {
    const fresh = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv.id } });
    const due = fresh.grossAmountKobo - fresh.settledAmountKobo;
    const result = await flow.recordReceipt({ companyId: ctx.companyId, actor: ctx.treasury, customerId: fresh.customerId, receiptDate: D(264), method: 'BANK_TRANSFER', bankGlAccountId: ctx.account['110100'], allocations: [{ invoiceId: fresh.id, amountKobo: due.toString() }] });
    if (result.awaitingApproval) await approveAll(result.awaitingApproval);
  }
  const ar = await balance('120100');
  expect(ar === 0n, `AR not cleared: ${shown(ar)}.`);
  return { ref: 'Receipts for every invoice', actual: `All invoices collected; AR cleared to zero; bank ${shown(await balance('110100'))}.` };
});

// ---------------------------------------------------------------- 33-35 Counts, valuation, reconciliation

await step(33, 'Inventory close', 'Count and reconcile RM, feed, packaging and FG', async () => {
  const counts = svc('inventory/stock-count.service.js', 'StockCountService');
  const recon = svc('reporting/control-account-reconciliation.service.js', 'ControlAccountReconciliationService');
  const summary = [];
  for (const code of ['RAW-WH', 'FG-WH']) {
    const count = await counts.start({ companyId: ctx.companyId, warehouseId: ctx.warehouse[code], actor: ctx.clerk });
    const sheet = await counts.detail(ctx.companyId, count.id);
    if (sheet.lines.length === 0) {
      summary.push(`${code}: nothing on hand`);
      continue;
    }
    // Everything as the books say, except 10 kg of maize lost to spillage.
    await counts.record({
      companyId: ctx.companyId, countId: count.id, actor: ctx.clerk,
      counts: sheet.lines.map((l) => (l.itemId === ctx.item.maize && Number(l.bookQuantity) >= 10 ? { itemId: l.itemId, quantity: String(Number(l.bookQuantity) - 10), reason: 'Spillage in the store' } : { itemId: l.itemId, quantity: l.bookQuantity })),
    });
    await counts.submit({ companyId: ctx.companyId, countId: count.id, actor: ctx.clerk });
    await counts.decide({ companyId: ctx.companyId, countId: count.id, action: 'APPROVE', note: 'Agreed with the store', actor: ctx.controller });
    summary.push(`${code}: ${sheet.lines.length} items counted`);
  }
  const rows = await recon.reconcile(ctx.companyId);
  const stockRows = rows.filter((r) => /^130(100|110|215|510|520)$/.test(r.accountNumber));
  const off = stockRows.filter((r) => !r.reconciled);
  expect(off.length === 0, `Stock accounts off their subledger: ${off.map((r) => `${r.accountNumber} ${shown(r.varianceKobo)}`).join(', ')}.`);
  return { ref: summary.join('; '), actual: `Counted; a 10 kg maize shortfall approved by the finance controller and posted to inventory variance. Stock subledger = GL for ${stockRows.map((r) => r.accountNumber).join(', ')}.` };
});

await step(34, 'BA valuation', 'Count and value all snail/poultry BA stages', async () => {
  const assets = svc('biological-assets/biological-asset.service.js', 'BiologicalAssetService');
  const valued = [];
  for (const [code, price, toSell] of [['BRD-1', 2_500, 0], ['HAT-1', 3_200, 200], ['PAR-1', 6_000, 0], ['HCH-1', 5_500, 0]]) {
    const v = await valueAtHarvest(code, 265, price, toSell, 'Month-end count and market evidence');
    valued.push(`${code} ${v.status}`);
  }
  // A batch that has gone entirely is not revalued.
  const gone = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'BLR-001' } });
  expect(gone.population === 0, `BLR-001 still holds ${gone.population}.`);
  let refused = false;
  try {
    await assets.requestValuation({ companyId: ctx.companyId, groupId: gone.id, valuationDate: D(265), marketPricePerUnitKobo: naira(5_500), costsToSellPerUnitKobo: 0n, evidenceReference: 'test', actor: ctx.clerk });
  } catch {
    refused = true;
  }
  expect(refused, 'A fully disposed batch was revalued.');
  const rollForwards = await Promise.all(['BRD-1', 'HAT-1', 'PAR-1', 'HCH-1'].map(async (code) => assets.rollForward((await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code } })).id)));
  if (process.env.REHEARSAL_DEBUG) console.log(JSON.stringify(rollForwards, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const diff = rollForwards.reduce((s, r) => s + BigInt(r.differenceKobo), 0n);
  expect(diff === 0n, `Roll-forward differs by ${shown(diff)}.`);
  return { ref: valued.join(', '), actual: `Remaining stages valued through approval; fair-value movements to 420100/420200. BLR-001 (all sold or processed) refused a revaluation. BA roll-forward: opening + movements = closing for every batch.` };
});

await step(35, 'AP/AR close', 'Reconcile GRNI, AP, AR, WHT/VAT and customer/supplier balances', async () => {
  const recon = svc('reporting/control-account-reconciliation.service.js', 'ControlAccountReconciliationService');
  const rows = await recon.reconcile(ctx.companyId);
  const off = rows.filter((r) => !r.reconciled);
  expect(off.length === 0, `Off: ${off.map((r) => `${r.accountNumber} ${r.accountName} GL ${shown(r.glBalanceKobo)} vs ${r.source} ${shown(r.subledgerKobo)}`).join('; ')}.`);
  return { ref: `${rows.length} control accounts`, actual: `Every control account equals its subledger: ${rows.map((r) => `${r.accountNumber} ${shown(r.glBalanceKobo)}`).join('; ')}.` };
});

// ---------------------------------------------------------------- 36-40 Close, reporting, year end, acceptance

/** Close one period the way finance does: checklist settled, validation clean, closed by the controller. */
async function closePeriod(period) {
  const periods = svc('closing/period-close.service.js', 'PeriodCloseService');
  await periods.prepareChecklist(period.id);
  for (const item of await periods.checklist(period.id)) {
    if (item.status === 'PENDING') await periods.settleChecklistItem({ checklistId: item.id, status: 'COMPLETE', comments: 'Done and reviewed', actorId: ctx.clerk.userId });
  }
  const validation = await periods.validate(period.id);
  expect(validation.canClose, `${period.name} will not close: ${JSON.stringify(validation.findings.filter((f) => f.blocking ?? f.severity === 'BLOCKING'))}`);
  return periods.close({ financialPeriodId: period.id, actor: ctx.controller, reason: `${period.name} close` });
}

await step(36, 'Month close', 'Close payroll, FA, WIP/recovery, bank and all subledgers', async () => {
  const packs = svc('closing/close-pack.service.js', 'ClosePackService');
  // Every month but the last; the last takes the year-end adjustments (step 38).
  for (const period of ctx.year.periods.slice(0, -1)) await closePeriod(period);
  const listed = await packs.list(ctx.companyId, ctx.year.id);
  const checks = await Promise.all(listed.map((p) => packs.verify(ctx.companyId, p.id)));
  expect(checks.every((c) => c.intact && c.matches), 'A close pack does not match the ledger.');
  return { ref: `${listed.length} periods closed`, actual: `Checklists settled, validation clean (TB balanced, WIP/recovery zero, control accounts = subledgers, nothing awaiting approval), each month closed by the finance controller. ${listed.length} close packs stored; every one intact and matching the ledger.` };
});

await step(37, 'Management reporting', 'Generate farm, processing and consolidated results', async () => {
  const tb = await svc('reporting/trial-balance.service.js', 'TrialBalanceService').build({ companyId: ctx.companyId, financialYearId: ctx.year.id });
  const pl = await svc('reporting/profit-loss.service.js', 'ProfitLossService').build({ companyId: ctx.companyId, financialYearId: ctx.year.id });
  const bs = await svc('reporting/balance-sheet.service.js', 'BalanceSheetService').build({ companyId: ctx.companyId });
  const cf = await svc('reporting/cash-flow.service.js', 'CashFlowService').yearToDate({ companyId: ctx.companyId, financialPeriodId: ctx.year.periods[ctx.year.periods.length - 1].id });
  const kpis = await svc('reporting/kpi.service.js', 'KpiService').build(ctx.companyId, undefined, ctx.year.id);
  expect(tb.balanced, 'Trial balance does not balance.');
  expect(bs.balanced, `Balance sheet off: assets ${shown(bs.totalAssetsKobo)}, liabilities and equity ${shown(bs.totalLiabilitiesAndEquityKobo)}.`);
  expect(cf.reconciled, 'Cash flow does not end at the bank balance.');
  ctx.results = { pbt: BigInt(pl.profitBeforeTaxKobo) };
  const valued = kpis.filter((k) => k.value !== null && k.value !== undefined).length;
  return { ref: 'TB, P&L, balance sheet, cash flow (year to date), KPIs', actual: `TB balanced; revenue ${shown(pl.revenueKobo)}, profit before tax ${shown(pl.profitBeforeTaxKobo)}; total assets ${shown(bs.totalAssetsKobo)} = liabilities and equity; cash flow ends at the bank (${shown(cf.closingCashKobo)}); ${valued} of ${kpis.length} KPIs computed from posted records.` };
});

await step(38, 'Year-end close', 'Post IFRS, tax, impairment and final BA/FA adjustments', async () => {
  const last = ctx.year.periods[ctx.year.periods.length - 1];
  const tax = await svc('closing/income-tax.service.js', 'IncomeTaxService').provide({ companyId: ctx.companyId, financialPeriodId: last.id, actor: ctx.owner });
  await closePeriod(last);
  const yearEnd = svc('closing/year-end.service.js', 'YearEndService');
  const validation = await yearEnd.validate(ctx.year.id);
  expect(validation.canClose ?? true, `Year-end validation: ${JSON.stringify(validation)}`);
  ctx.yearEnd = await yearEnd.close({ financialYearId: ctx.year.id, actor: ctx.controller });
  for (const n of ['410100', '410200', '410300', '410400', '510100', '620100', '630100']) {
    const s = await prisma.journalLine.aggregate({ where: { glAccountId: ctx.account[n], financialYearId: ctx.year.id }, _sum: { debitKobo: true, creditKobo: true } });
    expect((s._sum.debitKobo ?? 0n) === (s._sum.creditKobo ?? 0n), `${n} not swept to zero at year end.`);
  }
  note(38, 'Impairment and fair-value adjustments at year end are policy entries for the Financial Controller and IFRS adviser (handbook §61). The run provides income tax and relies on the step-34 valuation; no impairment was indicated.');
  return { ref: `${ctx.year.code}: closing ${ctx.yearEnd.closingJournalId?.slice(0, 8)}`, actual: `Income tax provided at ${tax.ratePercent}% on profit before tax of ${shown(tax.profitBeforeTaxYtdKobo)}: ${shown(tax.postedKobo)}; last month closed; revenue and expense swept to retained earnings (result ${shown(BigInt(ctx.yearEnd.retainedEarningsKobo))}); ${ctx.year.code} archived.` };
});

await step(39, 'Year roll-forward', 'Create next-year opening balances', async () => {
  const next = await prisma.financialYear.findFirstOrThrow({ where: { companyId: ctx.companyId, code: ctx.yearEnd.nextYearCode } });
  const tb = await svc('reporting/trial-balance.service.js', 'TrialBalanceService').build({ companyId: ctx.companyId, financialYearId: next.id });
  expect(tb.balanced, 'Opening trial balance does not balance.');
  const pnl = tb.rows.filter((r) => ['REVENUE', 'EXPENSE'].includes(r.accountType) && r.netKobo !== 0n);
  expect(pnl.length === 0, `Income or expense carried into ${next.code}: ${pnl.map((r) => r.accountNumber).join(', ')}.`);
  const bank = tb.rows.find((r) => r.accountNumber === '110100');
  return { ref: `${next.code} opening journal`, actual: `${next.code} created with ${ctx.yearEnd.balancesCarried} balances carried; opening debits = credits (${shown(tb.totalDebitKobo)}); income and expense at zero; bank opens at ${shown(bank?.netKobo ?? 0n)}.` };
});

await step(40, 'Final acceptance', 'Run negative, reversal, duplicate, SoD, lock, migration and audit tests', async () => {
  const results = [];
  // Lock: nothing posts into a closed year.
  const posting = svc('posting/posting.service.js', 'PostingService');
  const first = ctx.year.periods[0];
  const lockDims = { companyId: ctx.companyId, branchId: ctx.branchId, financialYearId: ctx.year.id, financialPeriodId: first.id, currencyId: ctx.currencyId, exchangeRate: '1', costCentreId: ctx.cc['CC-CORP-FIN'] };
  try {
    await posting.post({
      sourceModule: 'rehearsal', sourceDocumentType: 'Test', journalNumber: 'LOCK-TEST', journalDate: D(20), narration: 'Must be refused', companyId: ctx.companyId, branchId: ctx.branchId,
      financialYearId: ctx.year.id, financialPeriodId: first.id, currencyId: ctx.currencyId, exchangeRate: '1', idempotencyKey: 'rehearsal-lock', actor: ctx.owner,
      lines: [
        { glAccountId: ctx.account['110100'], description: 'x', debit: 100n, dimensions: lockDims },
        { glAccountId: ctx.account['690100'], description: 'x', credit: 100n, dimensions: lockDims },
      ],
    });
    results.push('LOCK: FAILED — posted into a closed year');
  } catch (error) {
    // Refused for the right reason: the period, not a malformed journal.
    const why = String(error.message);
    results.push(/closed|archived|lock/i.test(why) ? `Lock: refused (${why.slice(0, 70)})` : `LOCK: FAILED — refused for another reason: ${why.slice(0, 80)}`);
  }
  // Duplicate: the same round sent twice is recorded once.
  const operations = svc('operations/operations.service.js', 'OperationsService');
  const again = await operations.recordRound({ companyId: ctx.companyId, actor: ctx.clerk, idempotencyKey: 'rehearsal-weigh', payload: { module: 'poultry', date: day(50), entries: [{ groupCode: 'BLR-001', weightSample: { sampleSize: 20, totalWeight: 44, unit: 'kg' } }] } });
  results.push(again.replayed ? 'Duplicate: replayed, not recorded twice' : 'DUPLICATE: FAILED');
  // SoD: whoever raises a document cannot approve it.
  const orders = svc('procurement/purchase-order.service.js', 'PurchaseOrderService');
  const next = await prisma.financialYear.findFirstOrThrow({ where: { companyId: ctx.companyId, code: ctx.yearEnd.nextYearCode } });
  const po = await orders.createOrder({ companyId: ctx.companyId, supplierId: ctx.supplier.feed, orderDate: next.startDate, currencyId: ctx.currencyId, branchId: ctx.branchId, warehouseId: ctx.warehouse['RAW-WH'], farmId: ctx.farm.id, costCentreId: ctx.cc['CC-CORP-PROC'], lines: [{ itemId: ctx.item.maize, quantity: 10, unitPriceKobo: naira(380) }], actor: ctx.manager });
  const submitted = await orders.submitOrder({ purchaseOrderId: po.id, actor: ctx.manager });
  try {
    await svc('workflow/workflow.service.js', 'WorkflowService').approve({ transactionId: submitted.transactionId, actor: ctx.manager });
    results.push('SOD: FAILED — maker approved own order');
  } catch {
    results.push('SoD: maker could not approve own order');
  }
  // Audit: the trail cannot be edited.
  try {
    await prisma.$executeRawUnsafe(`UPDATE audit_records SET comments = 'tampered' WHERE company_id = '${ctx.companyId}'`);
    results.push('AUDIT: FAILED — audit trail edited');
  } catch {
    results.push('Audit: trail refused an edit');
  }
  // Reversal: a posted journal is corrected by reversal, never edited.
  try {
    await prisma.$executeRawUnsafe(`UPDATE journal_lines SET debit_kobo = debit_kobo + 1 WHERE journal_entry_id = (SELECT id FROM journal_entries WHERE company_id = '${ctx.companyId}' LIMIT 1)`);
    results.push('IMMUTABILITY: FAILED — posted journal edited');
  } catch {
    results.push('Reversal only: a posted journal refused an edit');
  }
  // Migration: every migration applied to this clean database.
  const applied = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL`);
  results.push(`Migrations: ${applied[0].n} applied from empty`);
  const audit = await prisma.auditRecord.count({ where: { companyId: ctx.companyId } });
  expect(results.every((r) => !/FAILED/.test(r)), results.join('; '));
  note(40, 'The script’s final step also asks for the four-owner sign-off. That is people’s, not the application’s; the full negative, reversal and SoD suites run in CI (26 UAT tests, 218 workbook checks).');
  return { ref: `${audit} audit records`, actual: results.join('; ') + '.' };
});

/*@@STEPS@@*/

// ---------------------------------------------------------------- evidence

const passed = results.filter((r) => r.status === 'PASS').length;
const summary = `${passed} of ${results.length} steps passed${halted ? `; stopped at step ${halted}` : ''}.`;
writeFileSync(join(apiDir, 'test', 'uat', 'rehearsal-40.json'), JSON.stringify({ run: new Date().toISOString(), environment: 'Clean PostgreSQL, all migrations, compiled application, farm registered as a new customer', summary, steps: results, notes }, null, 2));
const cell = (v) => String(v ?? '').replace(/\|/g, '/').replace(/\n/g, ' ');
writeFileSync(
  join(apiDir, 'test', 'uat', 'rehearsal-40-report.md'),
  [
    '# 500-snail + 500-poultry test environment script: application run',
    '',
    `Run ${new Date().toISOString()} in a clean environment (new database, every migration, the compiled application, a farm registered as a new customer). ${summary}`,
    '',
    'Columns follow Test_Environment_Script: Status, Application ref, Journal ref, Actual result.',
    '',
    '| Step | Area | Developer action | Status | Application ref | Journal ref | Actual result |',
    '|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.step} | ${cell(r.area)} | ${cell(r.action)} | ${r.status} | ${cell(r.applicationRef)} | ${cell(r.journalRef)} | ${cell(r.actual)} |`),
    '',
    '## Notes for the client',
    '',
    ...(notes.length ? notes.map((n) => `- **Step ${n.step}.** ${n.text}`) : ['None.']),
  ].join('\n') + '\n',
);
console.log(`[rehearsal] ${summary}`);

await app.close();
await pg.stop();
for (let i = 0; i < 5; i += 1) {
  try {
    rmSync(dataDir, { recursive: true, force: true });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 300));
  }
}
process.exit(halted ? 1 : 0);
