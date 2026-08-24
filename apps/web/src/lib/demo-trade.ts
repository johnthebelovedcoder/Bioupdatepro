/**
 * DEMONSTRATION DATA — NOT REAL FARM RECORDS.
 *
 * Fixtures for inventory, procurement, sales, finance, staff and settings.
 *
 * Worth noting what is different about these screens: unlike the livestock
 * pages, the BACKEND FOR MOST OF THIS ALREADY EXISTS and is tested — items,
 * stock movements, the full purchase and sales pipelines, the ledger. What is
 * missing is the read endpoints and the wiring. So these fixtures are shaped to
 * match what those services already return, not invented from scratch.
 *
 * Money is in KOBO as integer strings. Every screen shows the <DemoFlag />.
 */

const ANCHOR = Date.UTC(2026, 7, 10);

function daysAgo(days: number): string {
  return new Date(ANCHOR - days * 86_400_000).toISOString();
}

/* -------------------------------------------------------------------------- */

export interface InventoryItem {
  id: string;
  code: string;
  name: string;
  category: 'Feed' | 'Medication' | 'Packaging' | 'Equipment' | 'Consumables';
  unit: string;
  onHand: number;
  reorderLevel: number;
  unitCostKobo: string;
  valueKobo: string;
  lastMovedOn: string;
}

export async function getInventory(): Promise<InventoryItem[]> {
  const rows: Array<[string, string, InventoryItem['category'], string, number, number, number]> = [
    ['FD-LAYER', 'Layer mash', 'Feed', 'kg', 2_400, 3_000, 62_000],
    ['FD-BRSTART', 'Broiler starter', 'Feed', 'kg', 1_150, 800, 68_000],
    ['FD-BRFIN', 'Broiler finisher', 'Feed', 'kg', 5_000, 3_500, 66_000],
    ['FD-GROWER', 'Grower mash', 'Feed', 'kg', 4_000, 2_000, 58_000],
    ['FD-SNAIL', 'Snail feed concentrate', 'Feed', 'kg', 70, 250, 41_000],
    ['MD-LASOTA', 'Newcastle (Lasota) vaccine', 'Medication', 'dose', 4_200, 2_000, 1_200],
    ['MD-GUMB', 'Gumboro vaccine', 'Medication', 'dose', 1_400, 2_000, 1_450],
    ['MD-VITAMIX', 'Vitamin premix', 'Medication', 'kg', 38, 25, 290_000],
    ['PK-CRATE', 'Egg crate (30)', 'Packaging', 'unit', 1_860, 800, 12_000],
    ['PK-SACK', 'Polythene sack', 'Packaging', 'unit', 640, 300, 8_500],
    ['EQ-FEEDER', 'Plastic tube feeder', 'Equipment', 'unit', 46, 20, 420_000],
    ['CN-DISINF', 'Pen disinfectant', 'Consumables', 'litre', 62, 40, 185_000],
  ];

  return rows.map(([code, name, category, unit, onHand, reorderLevel, unitCost], index) => ({
    id: code,
    code,
    name,
    category,
    unit,
    onHand,
    reorderLevel,
    unitCostKobo: String(unitCost),
    valueKobo: String(onHand * unitCost),
    lastMovedOn: daysAgo(index % 9),
  }));
}

export interface StockMovement {
  id: string;
  date: string;
  itemCode: string;
  itemName: string;
  kind: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT' | 'TRANSFER';
  quantity: number;
  unit: string;
  reference: string;
  balanceAfter: number;
}

export async function getStockMovements(): Promise<StockMovement[]> {
  return [
    { id: 'm1', date: daysAgo(0), itemCode: 'FD-LAYER', itemName: 'Layer mash', kind: 'ISSUE', quantity: -245, unit: 'kg', reference: 'Round · Poultry House 1', balanceAfter: 240 },
    { id: 'm2', date: daysAgo(0), itemCode: 'FD-SNAIL', itemName: 'Snail feed concentrate', kind: 'ISSUE', quantity: -18, unit: 'kg', reference: 'Round · Snail Section A', balanceAfter: 70 },
    { id: 'm3', date: daysAgo(0), itemCode: 'FD-LAYER', itemName: 'Layer mash', kind: 'RECEIPT', quantity: 2_000, unit: 'kg', reference: 'GRN-2026-0184 · Greenfields Feeds', balanceAfter: 485 },
    { id: 'm4', date: daysAgo(1), itemCode: 'MD-LASOTA', itemName: 'Newcastle (Lasota) vaccine', kind: 'ISSUE', quantity: -1_950, unit: 'dose', reference: 'Vaccination · L-2026-003', balanceAfter: 4_200 },
    { id: 'm5', date: daysAgo(2), itemCode: 'PK-CRATE', itemName: 'Egg crate (30)', kind: 'ISSUE', quantity: -120, unit: 'unit', reference: 'DN-2026-0442 · Sunrise Foods', balanceAfter: 1_860 },
    { id: 'm6', date: daysAgo(3), itemCode: 'FD-BRFIN', itemName: 'Broiler finisher', kind: 'ISSUE', quantity: -520, unit: 'kg', reference: 'Round · Broiler Pen 1', balanceAfter: 430 },
    { id: 'm7', date: daysAgo(4), itemCode: 'FD-GROWER', itemName: 'Grower mash', kind: 'ADJUSTMENT', quantity: -14, unit: 'kg', reference: 'Stock count variance — spillage', balanceAfter: 920 },
  ];
}

/* -------------------------------------------------------------------------- */

export interface Supplier {
  id: string;
  name: string;
  category: string;
  phone: string;
  terms: string;
  balanceKobo: string;
  lastOrderOn: string;
}

export async function getSuppliers(): Promise<Supplier[]> {
  return [
    { id: 's1', name: 'Greenfields Feeds', category: 'Feed', phone: '0803 411 9920', terms: '30 days', balanceKobo: '184000000', lastOrderOn: daysAgo(0) },
    { id: 's2', name: 'Zartech Hatchery', category: 'Day-old chicks', phone: '0806 220 1145', terms: '14 days', balanceKobo: '0', lastOrderOn: daysAgo(31) },
    { id: 's3', name: 'CHI Farms', category: 'Day-old chicks', phone: '0701 559 8830', terms: '14 days', balanceKobo: '47500000', lastOrderOn: daysAgo(63) },
    { id: 's4', name: 'VetCare Supplies', category: 'Medication', phone: '0809 774 2216', terms: 'On delivery', balanceKobo: '0', lastOrderOn: daysAgo(12) },
    { id: 's5', name: 'AgroTools NG', category: 'Equipment', phone: '0812 006 4471', terms: '30 days', balanceKobo: '92300000', lastOrderOn: daysAgo(22) },
  ];
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplier: string;
  raisedOn: string;
  expectedOn: string;
  status: 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'PART_RECEIVED' | 'RECEIVED' | 'INVOICED';
  totalKobo: string;
  lines: number;
}

export async function getPurchaseOrders(): Promise<PurchaseOrder[]> {
  return [
    { id: 'p1', number: 'PO-2026-0231', supplier: 'Greenfields Feeds', raisedOn: daysAgo(1), expectedOn: daysAgo(-2), status: 'AWAITING_APPROVAL', totalKobo: '248000000', lines: 2 },
    { id: 'p2', number: 'PO-2026-0230', supplier: 'Greenfields Feeds', raisedOn: daysAgo(4), expectedOn: daysAgo(0), status: 'RECEIVED', totalKobo: '124000000', lines: 1 },
    { id: 'p3', number: 'PO-2026-0228', supplier: 'VetCare Supplies', raisedOn: daysAgo(12), expectedOn: daysAgo(10), status: 'INVOICED', totalKobo: '38600000', lines: 4 },
    { id: 'p4', number: 'PO-2026-0225', supplier: 'AgroTools NG', raisedOn: daysAgo(22), expectedOn: daysAgo(18), status: 'PART_RECEIVED', totalKobo: '92300000', lines: 3 },
    { id: 'p5', number: 'PO-2026-0219', supplier: 'Zartech Hatchery', raisedOn: daysAgo(31), expectedOn: daysAgo(31), status: 'INVOICED', totalKobo: '451250000', lines: 1 },
  ];
}

/* -------------------------------------------------------------------------- */

export interface Customer {
  id: string;
  name: string;
  type: string;
  phone: string;
  balanceKobo: string;
  overdueKobo: string;
  lastOrderOn: string;
}

export async function getCustomers(): Promise<Customer[]> {
  return [
    { id: 'c1', name: 'Sunrise Foods', type: 'Wholesaler', phone: '0805 118 2204', balanceKobo: '52000000', overdueKobo: '0', lastOrderOn: daysAgo(0) },
    { id: 'c2', name: 'Mama Ngozi Provisions', type: 'Market seller', phone: '0802 993 7714', balanceKobo: '8600000', overdueKobo: '8600000', lastOrderOn: daysAgo(38) },
    { id: 'c3', name: 'Lagoon Hotel', type: 'Hotel', phone: '0811 447 6620', balanceKobo: '19400000', overdueKobo: '0', lastOrderOn: daysAgo(6) },
    { id: 'c4', name: 'FreshMart Supermarket', type: 'Supermarket', phone: '0703 226 0091', balanceKobo: '7500000', overdueKobo: '7500000', lastOrderOn: daysAgo(52) },
    { id: 'c5', name: 'Chidi Okeke', type: 'Individual', phone: '0816 330 5518', balanceKobo: '0', overdueKobo: '0', lastOrderOn: daysAgo(9) },
  ];
}

export interface SalesInvoice {
  id: string;
  number: string;
  customer: string;
  issuedOn: string;
  dueOn: string;
  status: 'DRAFT' | 'UNPAID' | 'PART_PAID' | 'PAID' | 'OVERDUE';
  totalKobo: string;
  outstandingKobo: string;
}

export async function getSalesInvoices(): Promise<SalesInvoice[]> {
  return [
    { id: 'i1', number: 'INV-2026-0781', customer: 'Sunrise Foods', issuedOn: daysAgo(0), dueOn: daysAgo(-30), status: 'UNPAID', totalKobo: '52000000', outstandingKobo: '52000000' },
    { id: 'i2', number: 'INV-2026-0778', customer: 'Lagoon Hotel', issuedOn: daysAgo(6), dueOn: daysAgo(-24), status: 'PART_PAID', totalKobo: '31000000', outstandingKobo: '19400000' },
    { id: 'i3', number: 'INV-2026-0770', customer: 'Chidi Okeke', issuedOn: daysAgo(9), dueOn: daysAgo(9), status: 'PAID', totalKobo: '4200000', outstandingKobo: '0' },
    { id: 'i4', number: 'INV-2026-0742', customer: 'FreshMart Supermarket', issuedOn: daysAgo(52), dueOn: daysAgo(22), status: 'OVERDUE', totalKobo: '7500000', outstandingKobo: '7500000' },
    { id: 'i5', number: 'INV-2026-0731', customer: 'Mama Ngozi Provisions', issuedOn: daysAgo(38), dueOn: daysAgo(8), status: 'OVERDUE', totalKobo: '8600000', outstandingKobo: '8600000' },
  ];
}

/** Receivables split by how long they have been outstanding, from the DUE date. */
export interface AgeingBucket {
  label: string;
  amountKobo: string;
}

export async function getReceivablesAgeing(): Promise<AgeingBucket[]> {
  return [
    { label: 'Not yet due', amountKobo: '71400000' },
    { label: '1–30 days', amountKobo: '8600000' },
    { label: '31–60 days', amountKobo: '7500000' },
    { label: '61–90 days', amountKobo: '0' },
    { label: 'Over 90 days', amountKobo: '0' },
  ];
}

/* -------------------------------------------------------------------------- */

export interface ExpenseRow {
  id: string;
  date: string;
  category: string;
  description: string;
  farm: string;
  batch: string | null;
  /** Which species module the batch belongs to, so links resolve correctly. */
  batchModule: 'poultry' | 'snail' | null;
  method: string;
  amountKobo: string;
  by: string;
}

export async function getExpenses(): Promise<ExpenseRow[]> {
  return [
    { id: 'e1', date: daysAgo(0), category: 'Feed', description: 'Layer mash — 2,000 kg', farm: 'Main Farm', batch: null, batchModule: null, method: 'Bank transfer', amountKobo: '124000000', by: 'Chinedu Eze' },
    { id: 'e2', date: daysAgo(2), category: 'Fuel', description: 'Generator diesel — 200 litres', farm: 'Main Farm', batch: null, batchModule: null, method: 'Cash', amountKobo: '24000000', by: 'Chinedu Eze' },
    { id: 'e3', date: daysAgo(4), category: 'Labour', description: 'Casual workers — pen cleaning', farm: 'Main Farm', batch: null, batchModule: null, method: 'Cash', amountKobo: '9000000', by: 'Funmilayo Adeyemi' },
    { id: 'e4', date: daysAgo(6), category: 'Medication', description: 'Newcastle booster doses', farm: 'Main Farm', batch: 'L-2026-003', batchModule: 'poultry', method: 'Bank transfer', amountKobo: '2340000', by: 'Ibrahim Danjuma' },
    { id: 'e5', date: daysAgo(9), category: 'Transport', description: 'Delivery to Sunrise Foods', farm: 'Main Farm', batch: null, batchModule: null, method: 'Cash', amountKobo: '4500000', by: 'Funmilayo Adeyemi' },
    { id: 'e6', date: daysAgo(12), category: 'Repairs', description: 'Water pump repair', farm: 'Main Farm', batch: null, batchModule: null, method: 'Cash', amountKobo: '6800000', by: 'Chinedu Eze' },
    { id: 'e7', date: daysAgo(15), category: 'Electricity', description: 'Monthly bill', farm: 'Main Farm', batch: null, batchModule: null, method: 'Bank transfer', amountKobo: '18500000', by: 'Funmilayo Adeyemi' },
  ];
}

export interface CashPoint {
  date: string;
  inKobo: string;
  outKobo: string;
}

export async function getCashFlow(): Promise<CashPoint[]> {
  const months = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
  const inflow = [382, 401, 366, 428, 455, 480];
  const outflow = [291, 318, 302, 331, 298, 310];
  return months.map((_, index) => ({
    date: new Date(Date.UTC(2026, 2 + index, 1)).toISOString(),
    inKobo: String((inflow[index] ?? 0) * 1_000_000),
    outKobo: String((outflow[index] ?? 0) * 1_000_000),
  }));
}

/* -------------------------------------------------------------------------- */

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  farm: string;
  status: 'ACTIVE' | 'SUSPENDED';
  lastSeen: string;
}

export async function getStaff(): Promise<StaffMember[]> {
  return [
    { id: 'u1', name: 'Ngozi Balogun', email: 'ceo@bioassetpro.ng', role: 'CEO', farm: 'All farms', status: 'ACTIVE', lastSeen: daysAgo(0) },
    { id: 'u2', name: 'Ibrahim Danjuma', email: 'controller@bioassetpro.ng', role: 'Finance Controller', farm: 'All farms', status: 'ACTIVE', lastSeen: daysAgo(0) },
    { id: 'u3', name: 'Funmilayo Adeyemi', email: 'finance.manager@bioassetpro.ng', role: 'Finance Manager', farm: 'Main Farm', status: 'ACTIVE', lastSeen: daysAgo(1) },
    { id: 'u4', name: 'Chinedu Eze', email: 'farm.manager@bioassetpro.ng', role: 'Farm Manager', farm: 'Main Farm', status: 'ACTIVE', lastSeen: daysAgo(0) },
    { id: 'u5', name: 'Adaeze Okonkwo', email: 'supervisor@bioassetpro.ng', role: 'Production Supervisor', farm: 'Main Farm', status: 'ACTIVE', lastSeen: daysAgo(0) },
    { id: 'u6', name: 'System Administrator', email: 'admin@bioassetpro.ng', role: 'Administrator', farm: 'All farms', status: 'ACTIVE', lastSeen: daysAgo(3) },
  ];
}

export interface RoleDefinition {
  code: string;
  name: string;
  summary: string;
  approvalLimit: string | null;
  canSeeMoney: boolean;
}

export async function getRoles(): Promise<RoleDefinition[]> {
  return [
    { code: 'PRODUCTION_SUPERVISOR', name: 'Production Supervisor', summary: 'Daily rounds, production, mortality, feeding', approvalLimit: null, canSeeMoney: false },
    { code: 'FARM_MANAGER', name: 'Farm Manager', summary: 'All operations, plus approvals up to the first rung', approvalLimit: '₦250,000.00', canSeeMoney: true },
    { code: 'FINANCE_MANAGER', name: 'Finance Manager', summary: 'Sales, procurement, expenses and payments', approvalLimit: '₦2,000,000.00', canSeeMoney: true },
    { code: 'FINANCE_CONTROLLER', name: 'Finance Controller', summary: 'Full ledger, period close and statutory returns', approvalLimit: '₦10,000,000.00', canSeeMoney: true },
    { code: 'CEO', name: 'CEO', summary: 'Everything, with unlimited approval authority', approvalLimit: 'Unlimited', canSeeMoney: true },
    { code: 'ADMINISTRATOR', name: 'Administrator', summary: 'User and configuration management', approvalLimit: null, canSeeMoney: true },
  ];
}
