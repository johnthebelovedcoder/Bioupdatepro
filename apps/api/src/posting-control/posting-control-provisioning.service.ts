import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  AccountType,
  AuditAction,
  LedgerFlag,
  NormalBalance,
  PostingKeySide,
  PostingRuleStatus,
} from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Loading the client's posting rules, keys and six-digit chart into a company.
 *
 * Manual journals, inventory transfers and processing orders all resolve
 * their accounts through the posting rules (Consolidated Reference §66). The
 * demo company got them from `seed.ts`; a farm that signed up never did — its
 * Controls page showed 0 of 86 rules and 0 of 172 keys, and those three
 * features could not post at all.
 *
 * This is the same load the seed does, from the same files:
 *
 *   1. the specification chart (`seedSpecChart` in seed-spec-coa.ts) — the 36
 *      accounts `RECOMMENDED_COA_CC` states, plus every six-digit account a
 *      posting key names, its class derived from the code by the workbook's
 *      own scheme. Accounts that already exist are left exactly as they are.
 *   2. the keys and rules (`seedPostingControl` in seed-posting-control.ts),
 *      each key linked to its account where the chart has one.
 *
 * The data is read from packages/database/src/*.json at runtime rather than
 * copied: 116 KB of workbook extract duplicated by hand is exactly the drift
 * those files exist to prevent, and the whole repository is deployed. The
 * logic IS duplicated from the two seed functions, for the package-boundary
 * reason payroll-setup.service.ts explains — if either seed changes, change
 * this with it.
 *
 * Idempotent: upserts keyed on the same unique columns the seed uses.
 */

interface CoaRow { code: string; name: string; klass: string; normal: string }
interface KeyRow {
  key: string; glCode: string; glName: string; module: string; cycle: string;
  side: string; status: string; ledgerFlag: string;
}
interface RuleRow {
  ruleId: string; module: string; cycle: string; seq: number; trigger: string;
  sourceDocument: string; scenario: string; debitKey: string; creditKey: string;
  basis: string; dimensions: string; maker: string; approver: string; blocking: string;
  reversal: string; reportImpact: string; status: string;
}

/** Copied from seed-posting-control.ts — see its own comments for each entry's reason. */
const DYNAMIC_RESOLUTION: Record<string, string> = {
  'PCR-006-DR': 'Item.expenseGlAccountId — supplier-invoice.service.ts',
  'PCR-015-CR': 'Item.revenueGlAccountId — sales-invoice.service.ts',
  'PCR-044-DR': 'BiologicalAssetService.fairValueAccount() — normal mortality loss',
  'PCR-044-CR': 'BiologicalAssetService.stageAccount() — carrying value written off',
  'PCR-045-CR': 'BiologicalAssetService.stageAccount() — abnormal mortality loss',
  'PCR-046-DR': 'BiologicalAssetService.stageAccount() — IAS 41 upward FVLCTS gain',
  'PCR-047-CR': 'BiologicalAssetService.stageAccount() — IAS 41 downward FVLCTS loss',
  'PCR-065-DR': 'BiologicalAssetService.fairValueAccount() — poultry normal mortality loss',
  'PCR-085-DR': 'YearEndService.findRetainedEarnings() — year-end close',
  'PCR-086-DR': 'Reversal posts to the original journal’s own credit account',
  'PCR-086-CR': 'Reversal posts to the original journal’s own debit account',
  'PCR-029-CR': 'FixedAssetService.resolveAccounts() — payables (2201)',
  'PCR-005-DR': 'BiologicalAssetService.stageAccount() — acquisition cost, postAcquisition(), same per-species-per-stage account the FVLCTS adjustments already use',
  'PCR-037-CR': 'BiologicalAssetService.grniAccount() — postAcquisition() always credits GRNI, the same account every other purchase receipt in this codebase credits (PCR-004/005/006)',
  'PCR-061-CR': 'BiologicalAssetService.grniAccount() — same acquisition-credit policy as PCR-037-CR',
  'PCR-055-CR': 'ProductionOrderService.tradePayablesAccount() — SnailPro actual-overhead accrual, the same disclosed Trade-Payables policy FixedAssetService uses for its own dual-account key (PCR-029-CR)',
  'PCR-077-CR': 'ProductionOrderService.tradePayablesAccount() — PoultryPro combined actual-conversion accrual, same policy as PCR-055-CR',
  'PCR-036-CR': 'ProductionOrderService — Feed Mill settlement variance credit, the recovery clearing account (219830) standard absorption already credited',
  'PCR-058-CR': 'ProductionOrderService — SnailPro settlement variance credit, the recovery clearing account (219810) standard absorption already credited',
  'PCR-080-CR': 'ProductionOrderService — PoultryPro settlement variance credit, the recovery clearing account (219820) standard absorption already credited',
  'PCR-083-DR': 'ManualJournalService — the accrual’s preparer names the expense/asset account at entry time; not a fact code should decide',

  // Farm-to-ledger postings built 2026-09-24 (OperationsPostingService,
  // RearingCostService). Each "A or B per policy" key is resolved by the
  // policy the farm chose: rearing cost is capitalised into the population's
  // Work in Progress (1501) and relieved at weighted average.
  'PCR-042-CR': 'OperationsPostingService.postFeedIssues() — the issued item’s own inventory account (Item.inventoryGlAccountId, else 1301), taken out of the store at WAC',
  'PCR-062-DR': 'OperationsPostingService.postFeedIssues() — capitalised into the flock’s Work in Progress (1501), relieved at weighted average',
  'PCR-063-DR': 'OperationsPostingService.postTreatment() — capitalised into the flock’s Work in Progress (1501)',
  'PCR-063-CR': 'OperationsPostingService.postTreatment() — Raw Material Inventory (1301), the store the medication came from',
  'PCR-073-CR': 'RearingCostService.relieve(DISPOSAL) — the sold birds’ weighted-average share out of Work in Progress (1501) to Cost of Sales (5001)',

  // Built 2026-09-24 under the farm's answers: labour and overhead by
  // animal-days (flocks capitalised, snails expensed), each machine to one
  // processing line, eggs at a dated value per crate.
  'PCR-028-DR': 'FarmCostAllocationService.post() — payroll shared by animal-days to each flock’s Work in Progress (1501) or snail cohort (612000); credits back the salary expense the payroll run charged, since that run already credited Payroll Payable (220100)',
  'PCR-031-DR': 'FixedAssetService.postApprovedDepreciation() — a machine marked with a processing line posts to that line’s overhead: 621200 snail, 622100 poultry, 623100 feed mill',
  'PCR-043-CR': 'FarmCostAllocationService.post() — each source account chosen for the run (payroll, overhead or depreciation expense), credited by the amount allocated',
  'PCR-064-DR': 'FarmCostAllocationService.post() — capitalised into the flock’s Work in Progress (1501), relieved at weighted average',
  'PCR-064-CR': 'FarmCostAllocationService.post() — each source account chosen for the run (payroll, overhead or depreciation expense), credited by the amount allocated',
  'PCR-067-CR': 'EggPostingService.postCollection() — Agricultural Produce Gain — Eggs (420210): eggs are produce, recognised at the farm’s dated value per crate',
};

@Injectable()
export class PostingControlProvisioningService {
  private readonly logger = new Logger(PostingControlProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async status(companyId: string) {
    const [rules, keys] = await Promise.all([
      this.prisma.postingRule.count({ where: { companyId } }),
      this.prisma.postingKey.count({ where: { companyId } }),
    ]);
    const data = load();
    return {
      loaded: rules >= data.rules.length && keys >= data.keys.length,
      rules,
      keys,
      expectedRules: data.rules.length,
      expectedKeys: data.keys.length,
    };
  }

  async provision(companyId: string, actorId: string | null) {
    const data = load();
    const chart = await this.loadSpecChart(companyId, data);
    const control = await this.loadKeysAndRules(companyId, data);

    if (actorId) {
      await this.audit.write({
        transactionId: companyId,
        module: 'posting-control',
        entityType: 'PostingControl',
        entityId: companyId,
        status: 'LOADED',
        action: AuditAction.CREATE,
        userId: actorId,
        comments:
          `Loaded ${control.rules} posting rules and ${control.keys} keys ` +
          `(${control.linked} linked to an account); ${chart.created} specification accounts added.`,
        metadata: { ...chart, ...control },
      });
    }
    this.logger.log(`Company ${companyId}: ${control.rules} rules, ${control.keys} keys, ${chart.created} accounts added.`);
    return { accountsCreated: chart.created, accountsExisting: chart.existing, ...control };
  }

  /* --- 1. The specification chart ------------------------------------- */

  private async loadSpecChart(companyId: string, data: Loaded) {
    const wanted = new Map<string, { name: string; type: AccountType; normal: NormalBalance }>();
    for (const row of data.coa) {
      const type = statedType(row.klass);
      const normal = statedNormal(row.normal);
      if (type && normal) wanted.set(row.code, { name: row.name, type, normal });
    }
    for (const key of data.keys) {
      const code = (key.glCode ?? '').trim();
      if (!/^\d{6}$/.test(code) || wanted.has(code)) continue;
      wanted.set(code, { name: key.glName, ...derive(code) });
    }
    for (const [code, name] of EXTRA_ACCOUNTS) {
      if (!wanted.has(code)) wanted.set(code, { name, ...derive(code) });
    }

    const existing = new Set(
      (
        await this.prisma.gLAccount.findMany({
          where: { companyId, accountNumber: { in: [...wanted.keys()] } },
          select: { accountNumber: true },
        })
      ).map((a) => a.accountNumber),
    );
    const missing = [...wanted.entries()].filter(([code]) => !existing.has(code));
    if (missing.length > 0) {
      await this.prisma.gLAccount.createMany({
        data: missing.map(([code, account]) => ({
          companyId,
          accountNumber: code,
          name: account.name,
          accountType: account.type,
          normalBalance: account.normal,
          isPostingAccount: true,
          active: true,
          // Work in progress must be attributable — same rule as seedSpecChart.
          requiresCostCentre: code.startsWith('1304'),
        })),
        skipDuplicates: true,
      });
    }
    return { created: missing.length, existing: existing.size };
  }

  /* --- 2. Keys and rules --------------------------------------------- */

  private async loadKeysAndRules(companyId: string, data: Loaded) {
    const accounts = await this.prisma.gLAccount.findMany({
      where: { companyId },
      select: { id: true, accountNumber: true },
    });
    const accountByNumber = new Map(accounts.map((a) => [a.accountNumber, a.id]));

    let linked = 0;
    for (const row of data.keys) {
      const code = (row.glCode ?? '').trim();
      const atomic = /^\d{6}$/.test(code);
      const glAccountId = atomic ? (accountByNumber.get(code) ?? null) : null;
      const dynamicResolution = atomic ? null : (DYNAMIC_RESOLUTION[row.key] ?? null);
      if (glAccountId) linked += 1;
      const fields = {
        glAccountCode: code === '—' ? null : code,
        glAccountName: row.glName,
        glAccountId,
        atomic,
        dynamicResolution,
        allowedModule: row.module,
        cycle: row.cycle,
        side: row.side.toLowerCase() === 'debit' ? PostingKeySide.DEBIT : PostingKeySide.CREDIT,
        ledgerFlag: ledgerFlagOf(row.ledgerFlag),
        active: row.status.trim().toLowerCase() === 'active',
      };
      await this.prisma.postingKey.upsert({
        where: { companyId_key: { companyId, key: row.key } },
        update: fields,
        create: { companyId, key: row.key, ...fields },
      });
    }

    for (const row of data.rules) {
      const fields = {
        module: row.module,
        cycle: row.cycle,
        sequence: row.seq,
        trigger: row.trigger,
        sourceDocument: row.sourceDocument,
        scenario: row.scenario,
        debitKey: row.debitKey,
        creditKey: row.creditKey,
        measurementBasis: row.basis,
        requiredDimensions: row.dimensions,
        makerRole: row.maker,
        approverRole: row.approver,
        blockingControl: row.blocking,
        reversalMethod: row.reversal,
        reportImpact: row.reportImpact,
        status: statusOf(row.status),
      };
      await this.prisma.postingRule.upsert({
        where: { companyId_ruleId_version: { companyId, ruleId: row.ruleId, version: 1 } },
        update: fields,
        create: {
          companyId,
          ruleId: row.ruleId,
          version: 1,
          ...fields,
          // The workbook's own baseline date, as the seed uses.
          effectiveFrom: new Date('2026-01-01'),
        },
      });
    }

    return { rules: data.rules.length, keys: data.keys.length, linked };
  }
}

/* --- The workbook files ------------------------------------------------ */

interface Loaded { coa: CoaRow[]; keys: KeyRow[]; rules: RuleRow[] }
let cache: Loaded | null = null;

/** Find packages/database/src from wherever the API is running (src in dev, dist in production). */
function load(): Loaded {
  if (cache) return cache;
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'packages', 'database', 'src');
    if (existsSync(join(candidate, 'posting-control.json'))) {
      const control = JSON.parse(readFileSync(join(candidate, 'posting-control.json'), 'utf8')) as {
        rules: RuleRow[];
        keys: KeyRow[];
      };
      const coa = JSON.parse(readFileSync(join(candidate, 'recommended-coa.json'), 'utf8')) as CoaRow[];
      cache = { coa, keys: control.keys, rules: control.rules };
      return cache;
    }
    dir = dirname(dir);
  }
  throw new Error('Could not find packages/database/src/posting-control.json from ' + __dirname);
}

/* --- Copied from seed-spec-coa.ts / seed-posting-control.ts ------------ */

/**
 * Accounts the workbook implies but never names with a single code — see
 * migration 0003, which adds the same two to farms loaded before them.
 */
const EXTRA_ACCOUNTS: Array<[string, string]> = [
  ['420210', 'Agricultural Produce Gain — Eggs'], // PCR-067-CR "130210/420210"
  ['623100', 'Feed Mill Overhead Expense'], // PCR-031-DR "Processing/Feed-mill OH Expense"
];

function derive(code: string): { type: AccountType; normal: NormalBalance } {
  if (code.startsWith('149')) return { type: AccountType.ASSET, normal: NormalBalance.CREDIT };
  if (code.startsWith('2198')) return { type: AccountType.LIABILITY, normal: NormalBalance.CREDIT };
  switch (code[0]) {
    case '1': return { type: AccountType.ASSET, normal: NormalBalance.DEBIT };
    case '2': return { type: AccountType.LIABILITY, normal: NormalBalance.CREDIT };
    case '3': return { type: AccountType.EQUITY, normal: NormalBalance.CREDIT };
    case '4': return { type: AccountType.REVENUE, normal: NormalBalance.CREDIT };
    default: return { type: AccountType.EXPENSE, normal: NormalBalance.DEBIT };
  }
}

function statedType(klass: string): AccountType | null {
  const k = klass.toLowerCase();
  if (k.startsWith('asset') || k.startsWith('contra asset')) return AccountType.ASSET;
  if (k.startsWith('liability') || k.startsWith('clearing')) return AccountType.LIABILITY;
  if (k.startsWith('equity')) return AccountType.EQUITY;
  if (k.startsWith('income')) return AccountType.REVENUE;
  if (k.startsWith('expense')) return AccountType.EXPENSE;
  return null;
}

function statedNormal(normal: string): NormalBalance | null {
  const n = normal.trim().toLowerCase();
  if (n.startsWith('debit')) return NormalBalance.DEBIT;
  if (n.startsWith('credit')) return NormalBalance.CREDIT;
  return null;
}

function ledgerFlagOf(value: string): LedgerFlag {
  if (value.startsWith('CONTROL')) return LedgerFlag.CONTROL;
  if (value.startsWith('GENERAL')) return LedgerFlag.GENERAL;
  if (value.startsWith('NO-JOURNAL')) return LedgerFlag.NO_JOURNAL;
  throw new Error(`Unrecognised Ledger Flag "${value}". §66.3 defines exactly three.`);
}

function statusOf(value: string): PostingRuleStatus {
  const v = value.trim().toLowerCase();
  if (v === 'approved') return PostingRuleStatus.APPROVED;
  if (v === 'retired') return PostingRuleStatus.RETIRED;
  return PostingRuleStatus.DRAFT;
}
