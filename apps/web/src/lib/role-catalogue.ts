/**
 * The six roles this product's screens are fully wired up to, and what each
 * one is for — display copy, not farm data, so it lives outside the demo
 * fixtures and needs no API call. The approval LIMIT next to each one is a
 * different kind of fact and comes from the company's own configuration
 * (`GET /workflow/approval-ladder`) rather than living here.
 */
export interface RoleCatalogueEntry {
  code: string;
  name: string;
  summary: string;
  canSeeMoney: boolean;
}

export const ROLE_CATALOGUE: RoleCatalogueEntry[] = [
  {
    code: 'PRODUCTION_SUPERVISOR',
    name: 'Production Supervisor',
    summary: 'Daily rounds, production, mortality, feeding',
    canSeeMoney: false,
  },
  {
    code: 'FARM_MANAGER',
    name: 'Farm Manager',
    summary: 'All operations, plus approvals up to the first rung',
    canSeeMoney: true,
  },
  {
    code: 'FINANCE_MANAGER',
    name: 'Finance Manager',
    summary: 'Sales, procurement, expenses and payments',
    canSeeMoney: true,
  },
  {
    code: 'FINANCE_CONTROLLER',
    name: 'Finance Controller',
    summary: 'Full ledger, period close and statutory returns',
    canSeeMoney: true,
  },
  { code: 'CFO', name: 'CFO', summary: 'Everything, with unlimited approval authority', canSeeMoney: true },
  {
    code: 'ADMINISTRATOR',
    name: 'Administrator',
    summary: 'User and configuration management',
    canSeeMoney: true,
  },
];
