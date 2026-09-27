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
    ['farm', ['FARM_MANAGER']],
    ['finance', ['FINANCE_MANAGER']],
    ['controller', ['FINANCE_CONTROLLER']],
    ['hr', ['HR_MANAGER']],
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
  ctx.account = Object.fromEntries((await prisma.gLAccount.findMany({ where: { companyId: ctx.companyId, active: true } })).map((a) => [a.accountNumber, a.id]));
  // POSTING_COA_MASTER: S_Recovery_GL 219810, P_Recovery_GL 219820 and the feed mill's 219830 (PCR-033/036).
  expect(recovery.length === 3, `Recovery accounts missing: have ${recovery.map((r) => r.accountNumber).join(', ')}.`);
  note(
    2,
    'The script asks for four recovery GLs and FeedMill_Accounting names separate S_Feed_Recovery_GL and P_Feed_Recovery_GL, but POSTING_COA_MASTER resolves feed-mill absorption to one account, 219830 (PCR-033, PCR-036). The application follows the posting master, and feed orders do not carry a species. Client to confirm which the workbook intends.',
  );
  return { ref: `Chart ${company.chartVersion}`, actual: `${accounts} active accounts on the six-digit chart; ${centres} cost centres; ${rules ?? 'n/a'} posting rules; recovery accounts ${recovery.map((r) => `${r.accountNumber} ${r.name}`).join('; ')}.` };
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
    maize: (await item('RM-MAIZE', 'Maize', 'Kg', { inventoryGlAccountId: ctx.account['130100'] })).id,
    soya: (await item('RM-SOYA', 'Soybean meal', 'Kg', { inventoryGlAccountId: ctx.account['130100'] })).id,
    pack: (await item('PACK', 'Packaging', 'Kg', { inventoryGlAccountId: ctx.account['130100'] })).id,
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
  ctx.cycle = await breeding.record({ companyId: ctx.companyId, actorId: ctx.clerk.userId, code: 'CYC-1', breederGroupId: breeders.id, setOn: day(5), breeders: 500, eggsLaid: 40_000 });
  const after = await prisma.livestockGroup.findFirstOrThrow({ where: { id: breeders.id } });
  expect(after.population === 500, `Laying reduced the breeders to ${after.population}.`);
  return { ref: 'CYC-1', actual: '500 breeders laid 40,000 eggs; breeders not reduced; no journal.' };
});

await step(9, 'Snail lifecycle', 'Collect, count, grade and value eggs', async () => {
  const cycle = await prisma.snailBreedingCycle.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'CYC-1' } });
  expect(cycle.eggsLaid === 40_000, `CYC-1 holds ${cycle.eggsLaid} eggs.`);
  note(9, 'Snail eggs are counted on the breeding cycle but not recognised as a biological asset, so no Dr BA—Eggs / Cr FV gain is posted. The script posts it only "when policy permits", and the workbook’s own 500-snail case does not value eggs either. Client to confirm the policy; if eggs are to be valued, this is a build item.');
  return { ref: 'CYC-1', actual: '40,000 eggs counted on the cycle. Not valued: no policy permitting egg recognition (see note).' };
});

await step(10, 'Snail lifecycle', 'Transfer eggs to incubation and record hatch', async () => {
  const breeding = svc('snail-breeding/snail-breeding.service.js', 'SnailBreedingService');
  // 500_Assumptions: 75% hatch.
  await breeding.hatch({ companyId: ctx.companyId, actorId: ctx.clerk.userId, cycleId: ctx.cycle.id, hatchedOn: day(12), hatchedCount: 30_000, unhatchedCount: 10_000, hatchlingGroupCode: 'HAT-1' });
  const hatchlings = await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'HAT-1' } });
  expect(hatchlings.population === 30_000, `HAT-1 holds ${hatchlings.population}.`);
  // Set = hatched + unhatched + loss, refused otherwise.
  const breeding2 = svc('snail-breeding/snail-breeding.service.js', 'SnailBreedingService');
  const other = await breeding2.record({ companyId: ctx.companyId, actorId: ctx.clerk.userId, code: 'CYC-CHK', breederGroupId: (await prisma.livestockGroup.findFirstOrThrow({ where: { companyId: ctx.companyId, code: 'BRD-1' } })).id, setOn: day(6), breeders: 500, eggsLaid: 100 });
  let refused = false;
  try {
    await breeding2.hatch({ companyId: ctx.companyId, actorId: ctx.clerk.userId, cycleId: other.id, hatchedOn: day(13), hatchedCount: 90, unhatchedCount: 20 });
  } catch {
    refused = true;
  }
  expect(refused, 'A hatch of more than were set was accepted.');
  return { ref: 'CYC-1 → HAT-1', actual: 'Set 40,000 = hatched 30,000 + unhatched 10,000. A hatch exceeding eggs set was refused. No journal: eggs carry no value (step 9).' };
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
