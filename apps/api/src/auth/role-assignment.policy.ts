import { BadRequestException, ForbiddenException } from '@nestjs/common';

export interface RoleCatalogueEntry {
  code: string;
  name: string;
  summary: string;
  canSeeMoney: boolean;
}

export const ROLE_CATALOGUE: RoleCatalogueEntry[] = [
  { code: 'ADMINISTRATOR', name: 'Administrator', summary: 'Full system access, including user and role administration.', canSeeMoney: true },
  { code: 'CFO', name: 'CFO', summary: 'Finance leadership, approvals, reporting, and period controls.', canSeeMoney: true },
  { code: 'MD_CEO', name: 'MD/CEO', summary: 'Executive review and high-value transaction approvals.', canSeeMoney: true },
  { code: 'FINANCE_CONTROLLER', name: 'Finance Controller', summary: 'Ledger, financial controls, reporting, and period close.', canSeeMoney: true },
  { code: 'FINANCE_MANAGER', name: 'Finance Manager', summary: 'Finance operations, sales, procurement, and payments.', canSeeMoney: true },
  { code: 'FINANCIAL_ACCOUNTANT', name: 'Financial Accountant', summary: 'Prepares manual and recurring journals for approval.', canSeeMoney: true },
  { code: 'FARM_ACCOUNTANT', name: 'Farm Accountant', summary: 'Reconciles biological assets, inventory, work in progress, and journals.', canSeeMoney: true },
  { code: 'TREASURY_OFFICER', name: 'Treasury Officer', summary: 'Prepares payments and reconciles bank activity.', canSeeMoney: true },
  { code: 'AP_OFFICER', name: 'AP Officer', summary: 'Matches supplier invoices and maintains supplier balances.', canSeeMoney: true },
  { code: 'AR_OFFICER', name: 'AR Officer', summary: 'Applies customer receipts and reconciles customer balances.', canSeeMoney: true },
  { code: 'PROCUREMENT_OFFICER', name: 'Procurement Officer', summary: 'Raises and tracks purchase orders and supplier deliveries.', canSeeMoney: true },
  { code: 'SALES_OFFICER', name: 'Sales Officer', summary: 'Creates customer orders, dispatches, and invoices.', canSeeMoney: true },
  { code: 'HR_MANAGER', name: 'HR Manager', summary: 'Manages HR policy, employee information, and assigned approvals.', canSeeMoney: true },
  { code: 'HR_OFFICER', name: 'HR Officer', summary: 'Supports employee records and leave administration.', canSeeMoney: false },
  { code: 'FARM_MANAGER', name: 'Farm Manager', summary: 'Manages farm operations, staff, and assigned approvals.', canSeeMoney: true },
  { code: 'PRODUCTION_LEAD', name: 'Production Lead', summary: 'Coordinates production and processing operations.', canSeeMoney: false },
  { code: 'PRODUCTION_SUPERVISOR', name: 'Production Supervisor', summary: 'Records daily rounds, production, mortality, and feeding.', canSeeMoney: false },
  { code: 'SNAIL_SUPERVISOR', name: 'Snail Supervisor', summary: 'Supervises snail cohorts and daily operations.', canSeeMoney: false },
  { code: 'POULTRY_SUPERVISOR', name: 'Poultry Supervisor', summary: 'Supervises poultry flocks and daily operations.', canSeeMoney: false },
  { code: 'FARM_ATTENDANT', name: 'Farm Attendant', summary: 'Records assigned daily farm observations.', canSeeMoney: false },
  { code: 'STOREKEEPER', name: 'Storekeeper', summary: 'Receives, issues, transfers, and counts inventory.', canSeeMoney: false },
  { code: 'QA_OFFICER', name: 'QA Officer', summary: 'Reviews quality and lot-level controls independently of production.', canSeeMoney: false },
  { code: 'INTERNAL_AUDITOR', name: 'Internal Auditor', summary: 'Reviews controls, audit trails, and traceability.', canSeeMoney: true },
  { code: 'SYSTEM_ADMIN', name: 'System Administrator', summary: 'Manages system configuration and user access, not finance approvals.', canSeeMoney: false },
];

// Operational roles only; QA remains independent from production.
const FARM_MANAGER_GRANTS = new Set([
  'FARM_ATTENDANT',
  'SNAIL_SUPERVISOR',
  'POULTRY_SUPERVISOR',
  'PRODUCTION_SUPERVISOR',
  'PRODUCTION_LEAD',
  'STOREKEEPER',
]);

// System administration may provision operational access, but not finance,
// HR, approval, or audit roles that expose sensitive data or authority.
const SYSTEM_ADMIN_GRANTS = new Set([
  'FARM_ATTENDANT',
  'SNAIL_SUPERVISOR',
  'POULTRY_SUPERVISOR',
  'PRODUCTION_SUPERVISOR',
  'PRODUCTION_LEAD',
  'STOREKEEPER',
  'QA_OFFICER',
  'SYSTEM_ADMIN',
]);

const ROLE_CODES = new Set(ROLE_CATALOGUE.map(({ code }) => code));

export function isSupportedRoleCode(role: string): boolean {
  return ROLE_CODES.has(role);
}

export function assignableRoleCodes(actorRoles: readonly string[]): string[] {
  if (actorRoles.includes('ADMINISTRATOR')) {
    return ROLE_CATALOGUE.map(({ code }) => code);
  }

  const allowed = new Set<string>();
  if (actorRoles.includes('CFO')) {
    for (const { code } of ROLE_CATALOGUE) {
      if (code !== 'ADMINISTRATOR') allowed.add(code);
    }
  }
  if (actorRoles.includes('FARM_MANAGER')) {
    for (const code of FARM_MANAGER_GRANTS) allowed.add(code);
  }
  if (actorRoles.includes('SYSTEM_ADMIN')) {
    for (const code of SYSTEM_ADMIN_GRANTS) allowed.add(code);
  }

  return ROLE_CATALOGUE.filter(({ code }) => allowed.has(code)).map(({ code }) => code);
}

export function assertCanGrantRoles(
  actorRoles: readonly string[],
  requestedRoles: readonly string[],
  existingRoles: readonly string[] = [],
): void {
  const unknown = requestedRoles.filter((role) => !ROLE_CODES.has(role));
  if (unknown.length > 0) {
    throw new BadRequestException(`Unknown role: ${unknown.join(', ')}.`);
  }

  const existing = new Set(existingRoles);
  const newRoles = requestedRoles.filter((role) => !existing.has(role));
  const assignable = new Set(assignableRoleCodes(actorRoles));
  const forbidden = newRoles.filter((role) => !assignable.has(role));
  if (forbidden.length > 0) {
    throw new ForbiddenException(
      `You cannot grant these roles: ${forbidden.join(', ')}. Ask an administrator.`,
    );
  }
}
