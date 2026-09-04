import { PrismaClient } from '../generated/client';

/**
 * The governed 12-phase build sequence (US-897-001) — Developer_Build_Order
 * (DEV-01..DEV-12) cross-checked against 00_BEGIN_HERE's own beginner-guide
 * numbering. Both real client sheets, seeded verbatim rather than invented.
 * `webPath` is null wherever this codebase genuinely has no screen for that
 * phase yet — never a guessed or aspirational route.
 */
const PHASES = [
  {
    code: 'DEV-01', sequence: 1, name: 'Confirm masters and ownership',
    scope: 'Core ownership, COA, cost centres, tax, dimensions, roles',
    owner: 'Product Owner + Finance',
    exitEvidence: 'Approved ownership/COA/CC register',
    dependencyCodes: [], evidenceSheet: 'Coverage_Matrix',
    webPath: '/admin/accounts',
  },
  {
    code: 'DEV-02', sequence: 2, name: 'Implement workflow/state engine',
    scope: 'Draft/submit/approve/post/reverse/close and immutable audit',
    owner: 'Technical Lead',
    exitEvidence: 'Posting controls pass',
    dependencyCodes: ['DEV-01'], evidenceSheet: 'COA_Cost_Centres',
    webPath: '/approvals',
  },
  {
    code: 'DEV-03', sequence: 3, name: 'Implement Core purchasing',
    scope: 'Supplier, PR, PO, inspection, GRN, GRNI, invoice, payment',
    owner: 'Core Team',
    exitEvidence: '500-snail/bird procurement tests pass',
    dependencyCodes: ['DEV-02'], evidenceSheet: 'Posting_Control',
    webPath: '/procurement',
  },
  {
    code: 'DEV-04', sequence: 4, name: 'Implement inventory/costing',
    scope: 'Lots, locations, moving average, issues, receipts, traceability',
    owner: 'Core Team',
    exitEvidence: 'Inventory calculations and GL tie',
    dependencyCodes: ['DEV-02'], evidenceSheet: 'Procurement_Case',
    webPath: '/inventory',
  },
  {
    code: 'DEV-05', sequence: 5, name: 'Implement Snail lifecycle',
    scope: 'Breeder/egg/hatch/stage/valuation/harvest',
    owner: 'Snail Team',
    exitEvidence: 'Snail population/FVLCTS tests pass',
    dependencyCodes: ['DEV-03', 'DEV-04'], evidenceSheet: 'Snail_Case',
    webPath: '/m/snail/cohorts',
  },
  {
    code: 'DEV-06', sequence: 6, name: 'Implement Poultry lifecycle',
    scope: 'Placement/daily/feed/FCR/harvest',
    owner: 'Poultry Team',
    exitEvidence: 'Flock/feed/capacity tests pass',
    dependencyCodes: ['DEV-03', 'DEV-04'], evidenceSheet: 'Poultry_Case',
    webPath: '/m/poultry/flocks',
  },
  {
    code: 'DEV-07', sequence: 7, name: 'Implement production costing',
    scope: 'Orders, WIP, operations, loss, recovery and completion',
    owner: 'Core + Species Teams',
    exitEvidence: 'WIP and separate recovery GLs close',
    dependencyCodes: ['DEV-04', 'DEV-05', 'DEV-06'], evidenceSheet: 'Lifecycle_Transactions',
    webPath: null, // Production orders are API/script-only in this app — no dedicated screen exists.
  },
  {
    code: 'DEV-08', sequence: 8, name: 'Implement sales/receivables',
    scope: 'Order, credit, dispatch, invoice, COGS, receipt',
    owner: 'Core Team',
    exitEvidence: 'Revenue/COGS/AR tests pass',
    dependencyCodes: ['DEV-04'], evidenceSheet: 'Journal_Case',
    webPath: '/sales',
  },
  {
    code: 'DEV-09', sequence: 9, name: 'Implement reports/KPIs',
    scope: 'All report catalogue outputs and role KPI dashboard',
    owner: 'Data/Reporting Team',
    exitEvidence: 'Report acceptance criteria pass',
    dependencyCodes: ['DEV-03', 'DEV-04', 'DEV-05', 'DEV-06', 'DEV-07', 'DEV-08'],
    evidenceSheet: 'Inventory_Costing',
    webPath: '/ledger/reports',
  },
  {
    code: 'DEV-10', sequence: 10, name: 'Implement channels/integrations',
    scope: 'Events, APIs, email, WhatsApp, retries and audit',
    owner: 'Integration Team',
    exitEvidence: 'Idempotency/security tests pass',
    dependencyCodes: ['DEV-02'], evidenceSheet: 'KPI_Dashboard',
    webPath: null, // No event/channel/integration model exists anywhere in this codebase.
  },
  {
    code: 'DEV-11', sequence: 11, name: 'Migration and reconciliation',
    scope: 'Masters, opening inventory/BA/AP/AR/GL and trace links',
    owner: 'Data Team',
    exitEvidence: 'Migration totals and samples reconcile',
    dependencyCodes: ['DEV-01', 'DEV-09'], evidenceSheet: 'Acceptance_Criteria',
    webPath: null, // No dedicated migration/reconciliation-run tracking exists — GET /reporting/control-reconciliation is a live check, not a migration record.
  },
  {
    code: 'DEV-12', sequence: 12, name: 'End-to-end UAT and sign-off',
    scope: 'Execute case studies, exceptions, reversals, period close',
    owner: 'All business owners',
    exitEvidence: 'All critical acceptance criteria PASS',
    dependencyCodes: ['DEV-01', 'DEV-09', 'DEV-11'], evidenceSheet: 'Developer_Build_Order',
    webPath: null, // POST /reporting/release-sign-off (US-897-037) has no dedicated screen yet.
  },
] as const;

export async function seedImplementationPhases(prisma: PrismaClient, companyId: string) {
  let seeded = 0;
  for (const phase of PHASES) {
    await prisma.implementationPhase.upsert({
      where: { companyId_code: { companyId, code: phase.code } },
      update: {},
      create: {
        companyId,
        code: phase.code,
        sequence: phase.sequence,
        name: phase.name,
        scope: phase.scope,
        owner: phase.owner,
        exitEvidence: phase.exitEvidence,
        dependencyCodes: [...phase.dependencyCodes],
        evidenceSheet: phase.evidenceSheet,
        webPath: phase.webPath,
      },
    });
    seeded += 1;
  }
  return { seeded };
}

if (process.argv[1]?.includes('seed-implementation-phases')) {
  const prisma = new PrismaClient();
  (async () => {
    for (const company of await prisma.company.findMany({ select: { id: true, name: true } })) {
      const result = await seedImplementationPhases(prisma, company.id);
      console.log(`${company.name}: ${result.seeded} phases seeded.`);
    }
    await prisma.$disconnect();
  })();
}
