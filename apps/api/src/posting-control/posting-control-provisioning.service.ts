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
import {
  APPROVED_PROCESSING_KEYS,
  APPROVED_PROCUREMENT_DEFAULTS,
  APPROVED_SALES_DEFAULTS,
  approvedRoleReadiness,
  chartVersionOf,
} from '../chart/chart';

/**
 * Loading the client's posting rules, keys, approved workbook chart, and
 * historical six-digit compatibility accounts into a company.
 *
 * Manual journals, inventory transfers and processing orders all resolve
 * their accounts through the posting rules (Consolidated Reference §66). The
 * demo company got them from `seed.ts`; a farm that signed up never did — its
 * Controls page showed 0 of 86 rules and 0 of 172 keys, and those three
 * features could not post at all.
 *
 * This is the same load the seed does, from the same files:
 *
 *   1. the approved workbook account master, plus historical six-digit
 *      compatibility accounts still referenced by the old posting-key table.
 *      These compatibility accounts are not the selected target chart and
 *      must be retired only after all roles and settings use the workbook.
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
type ApprovedRow = Record<string, string | number | null>;
interface ApprovedWorkbook {
  source: string;
  sheets: {
    accounts: ApprovedRow[];
    postingControls: ApprovedRow[];
    postingKeys: ApprovedRow[];
    postingGroups: ApprovedRow[];
    accountMaps: ApprovedRow[];
    costCentres: ApprovedRow[];
  };
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
    const data = load();
    const [rules, keys, company, approvedMaps, approvedLines, approvedAccounts, approvedCentres, accounts, resolvedActiveMaps, unresolvedActiveMaps] = await Promise.all([
      this.prisma.postingRule.count({ where: { companyId } }),
      this.prisma.postingKey.count({ where: { companyId } }),
      this.prisma.company.findUnique({ where: { id: companyId }, select: { chartVersion: true } }),
      this.prisma.approvedPostingMap.count({ where: { companyId } }),
      this.prisma.approvedPostingControlLine.count({ where: { companyId } }),
      this.prisma.gLAccount.count({ where: { companyId, approvedStatement: { not: null } } }),
      this.prisma.costCentre.count({ where: { companyId, approvedApplication: { not: null } } }),
      this.prisma.gLAccount.findMany({
        where: { companyId },
        select: {
          accountNumber: true, name: true, active: true, accountType: true, normalBalance: true,
          isPostingAccount: true, isControlAccount: true, manualJournalAllowed: true, requiresCostCentre: true,
        },
      }),
      this.prisma.approvedPostingMap.count({ where: { companyId, status: 'Active', glAccountId: { not: null } } }),
      this.prisma.approvedPostingMap.findMany({
        where: { companyId, status: 'Active', glAccountId: null },
        select: { application: true, postingGroup: true, postingKey: true, accountCode: true },
        orderBy: [{ application: 'asc' }, { postingGroup: 'asc' }, { postingKey: 'asc' }],
      }),
    ]);
    const targetRows = data.approved.sheets.accounts.filter((row) => text(row.Status) === 'Active');
    const expectedActiveMaps = data.approved.sheets.accountMaps.filter((row) => text(row.Status) === 'Active').length;
    const targetByCode = new Map(targetRows.map((row) => [text(row['GL Code']), row]));
    const accountsByCode = new Map(accounts.map((account) => [account.accountNumber, account]));
    const missingTargetCodes = [...targetByCode.keys()]
      .filter((code) => !accountsByCode.get(code)?.active)
      .sort();
    const metadataMismatches = targetRows.flatMap((row) => {
      const code = text(row['GL Code']);
      const account = accountsByCode.get(code);
      if (!account) return [];
      const expectedType = approvedAccountType(text(row['Account Type']), code);
      const expectedNormal = text(row['Normal Balance']).toLowerCase().startsWith('credit') ? NormalBalance.CREDIT : NormalBalance.DEBIT;
      const expectedPosting = yes(row['Posting Account']);
      const expectedControl = yes(row['Control Account']);
      const expectedManual = yes(row['Manual Journal']);
      const expectedCostCentre = text(row['Cost Centre Rule']).toLowerCase().startsWith('required');
      const mismatches = [
        !account.active && 'active',
        account.accountType !== expectedType && 'accountType',
        account.normalBalance !== expectedNormal && 'normalBalance',
        account.isPostingAccount !== expectedPosting && 'isPostingAccount',
        account.isControlAccount !== expectedControl && 'isControlAccount',
        account.manualJournalAllowed !== expectedManual && 'manualJournalAllowed',
        account.requiresCostCentre !== expectedCostCentre && 'requiresCostCentre',
      ].filter((value): value is string => typeof value === 'string');
      return mismatches.length ? [{ accountNumber: code, fields: mismatches }] : [];
    });
    const activeOutsideTarget = accounts
      .filter((account) => account.active && !targetByCode.has(account.accountNumber))
      .map((account) => ({ accountNumber: account.accountNumber, name: account.name, isPostingAccount: account.isPostingAccount }))
      .sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
    // Sales and procurement post through their configuration: any account it
    // still names that is not on the approved chart blocks readiness.
    const [salesConfig, procurementConfig] = await Promise.all([
      this.prisma.salesConfiguration.findFirst({
        where: { companyId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
        include: { receivableAccount: true, revenueAccount: true, costOfSalesAccount: true, inventoryAccount: true, whtReceivableAccount: true },
      }),
      this.prisma.procurementConfiguration.findFirst({
        where: { companyId, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
        include: { grniAccount: true, payablesAccount: true, whtPayableAccount: true },
      }),
    ]);
    const configured: Array<{ configuration: string; role: string; accountNumber: string }> = [
      ...(salesConfig
        ? [
            { configuration: 'Sales', role: 'receivable', accountNumber: salesConfig.receivableAccount.accountNumber },
            { configuration: 'Sales', role: 'revenue', accountNumber: salesConfig.revenueAccount.accountNumber },
            { configuration: 'Sales', role: 'costOfSales', accountNumber: salesConfig.costOfSalesAccount.accountNumber },
            { configuration: 'Sales', role: 'inventory', accountNumber: salesConfig.inventoryAccount.accountNumber },
            ...(salesConfig.whtReceivableAccount ? [{ configuration: 'Sales', role: 'whtReceivable', accountNumber: salesConfig.whtReceivableAccount.accountNumber }] : []),
          ]
        : []),
      ...(procurementConfig
        ? [
            { configuration: 'Procurement', role: 'grni', accountNumber: procurementConfig.grniAccount.accountNumber },
            { configuration: 'Procurement', role: 'payables', accountNumber: procurementConfig.payablesAccount.accountNumber },
            ...(procurementConfig.whtPayableAccount ? [{ configuration: 'Procurement', role: 'whtPayable', accountNumber: procurementConfig.whtPayableAccount.accountNumber }] : []),
          ]
        : []),
    ];
    const configurationsOutsideTarget = configured.filter((c) => !targetByCode.has(c.accountNumber));
    const roles = approvedRoleReadiness((code) => accountsByCode.get(code)?.active === true);
    const unresolvedRoles = roles.filter((r) => r.state !== 'ready');
    return {
      loaded: rules >= data.rules.length && keys >= data.keys.length,
      rules,
      keys,
      expectedRules: data.rules.length,
      expectedKeys: data.keys.length,
      approvedEngine: {
        source: data.approved.source,
        accounts: approvedAccounts,
        expectedAccounts: data.approved.sheets.accounts.filter((r) => text(r.Status) === 'Active').length,
        accountMaps: approvedMaps,
        expectedAccountMaps: data.approved.sheets.accountMaps.length,
        resolvedActiveAccountMaps: resolvedActiveMaps,
        expectedActiveAccountMaps: expectedActiveMaps,
        unresolvedActiveAccountMaps: unresolvedActiveMaps.length,
        postingControlLines: approvedLines,
        expectedPostingControlLines: data.approved.sheets.postingControls.length,
        costCentres: approvedCentres,
        expectedCostCentres: data.approved.sheets.costCentres.length,
        loaded: approvedMaps >= data.approved.sheets.accountMaps.length &&
          approvedLines >= data.approved.sheets.postingControls.length &&
          approvedCentres >= data.approved.sheets.costCentres.length &&
          approvedAccounts >= targetRows.length && missingTargetCodes.length === 0 && metadataMismatches.length === 0 &&
          resolvedActiveMaps >= expectedActiveMaps && unresolvedActiveMaps.length === 0,
      },
      targetChart: {
        source: data.approved.source,
        expectedAccounts: targetRows.length,
        presentAccounts: targetRows.length - missingTargetCodes.length,
        resolvedActivePostingMaps: resolvedActiveMaps,
        expectedActivePostingMaps: expectedActiveMaps,
        missingAccountNumbers: missingTargetCodes,
        metadataMismatches,
        activeAccountsOutsideTarget: activeOutsideTarget,
        unresolvedPostingMaps: unresolvedActiveMaps,
        roles,
        unresolvedRoles,
        configurationsOutsideTarget,
        ready: unresolvedRoles.length === 0 && configurationsOutsideTarget.length === 0 && missingTargetCodes.length === 0 && metadataMismatches.length === 0 && activeOutsideTarget.length === 0 &&
          unresolvedActiveMaps.length === 0 && resolvedActiveMaps >= expectedActiveMaps,
      },
      /** LEGACY until the company is moved to the selected approved workbook chart. */
      chartVersion: company?.chartVersion ?? 'LEGACY',
    };
  }

  async provision(companyId: string, actorId: string | null) {
    const data = load();
    const approved = await this.loadApprovedEngine(companyId, data.approved);
    const chart = await this.loadSpecChart(companyId, data);
    const control = await this.loadKeysAndRules(companyId, data);
    const configurations = await this.ensureApprovedConfigurations(companyId);

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
          `(${control.linked} linked to an account); ${chart.created} historical compatibility accounts added.`,
        metadata: { ...chart, ...control, approved },
      });
    }
    this.logger.log(`Company ${companyId}: ${control.rules} rules, ${control.keys} keys, ${chart.created} accounts added.`);
    return { accountsCreated: chart.created, accountsExisting: chart.existing, ...control, approved, configurations };
  }

  /**
   * Sales and procurement post through their company configuration. For a
   * company on the approved chart, give it the workbook's defaults
   * (chart.ts APPROVED_SALES_DEFAULTS / APPROVED_PROCUREMENT_DEFAULTS) if it
   * has none. One that already has a configuration is left alone — repointing
   * it is part of the balance cutover — and shows in status() if it still
   * names accounts outside the approved chart.
   */
  private async ensureApprovedConfigurations(companyId: string): Promise<{ sales: 'created' | 'kept' | 'skipped'; procurement: 'created' | 'kept' | 'skipped' }> {
    const result = { sales: 'skipped', procurement: 'skipped' } as { sales: 'created' | 'kept' | 'skipped'; procurement: 'created' | 'kept' | 'skipped' };
    if ((await chartVersionOf(this.prisma, companyId)) !== 'APPROVED') return result;
    const wanted = [...Object.values(APPROVED_SALES_DEFAULTS), ...Object.values(APPROVED_PROCUREMENT_DEFAULTS)];
    const rows = await this.prisma.gLAccount.findMany({
      where: { companyId, accountNumber: { in: wanted }, active: true },
      select: { id: true, accountNumber: true },
    });
    const id = new Map(rows.map((r) => [r.accountNumber, r.id]));
    const effectiveFrom = new Date('2026-01-01');

    const [sales, procurement] = await Promise.all([
      this.prisma.salesConfiguration.count({ where: { companyId } }),
      this.prisma.procurementConfiguration.count({ where: { companyId } }),
    ]);
    if (sales > 0) result.sales = 'kept';
    else if (Object.values(APPROVED_SALES_DEFAULTS).every((n) => id.has(n))) {
      await this.prisma.salesConfiguration.create({
        data: {
          companyId,
          receivableGlAccountId: id.get(APPROVED_SALES_DEFAULTS.receivable)!,
          revenueGlAccountId: id.get(APPROVED_SALES_DEFAULTS.revenue)!,
          costOfSalesGlAccountId: id.get(APPROVED_SALES_DEFAULTS.costOfSales)!,
          inventoryGlAccountId: id.get(APPROVED_SALES_DEFAULTS.inventory)!,
          whtReceivableGlAccountId: id.get(APPROVED_SALES_DEFAULTS.whtReceivable)!,
          effectiveFrom,
        },
      });
      result.sales = 'created';
    }
    if (procurement > 0) result.procurement = 'kept';
    else if (Object.values(APPROVED_PROCUREMENT_DEFAULTS).every((n) => id.has(n))) {
      await this.prisma.procurementConfiguration.create({
        data: {
          companyId,
          grniGlAccountId: id.get(APPROVED_PROCUREMENT_DEFAULTS.grni)!,
          payablesGlAccountId: id.get(APPROVED_PROCUREMENT_DEFAULTS.payables)!,
          whtPayableGlAccountId: id.get(APPROVED_PROCUREMENT_DEFAULTS.whtPayable)!,
          effectiveFrom,
        },
      });
      result.procurement = 'created';
    }
    return result;
  }

  /** Import the approved workbook chart, account maps, posting lines and centres without remapping old posted GL balances. */
  private async loadApprovedEngine(companyId: string, workbook: ApprovedWorkbook) {
    const accounts = workbook.sheets.accounts.filter((r) => text(r.Status) === 'Active');
    const accountIds = new Map<string, string>();
    for (const row of accounts) {
      const code = text(row['GL Code']);
      const accountType = approvedAccountType(text(row['Account Type']), code);
      const normalBalance = text(row['Normal Balance']).toLowerCase().startsWith('credit') ? NormalBalance.CREDIT : NormalBalance.DEBIT;
      const flags = {
        name: text(row['GL Name']), accountType, normalBalance,
        isPostingAccount: yes(row['Posting Account']), isControlAccount: yes(row['Control Account']),
        manualJournalAllowed: yes(row['Manual Journal']),
        approvedStatement: text(row.Statement), ifrsCategory: text(row['IFRS Category']),
        ifrsLine: text(row['IFRS Line / Subcategory']), approvedPostingGroup: text(row['Posting Group']),
        applicationScope: text(row['Application Scope']), businessStream: text(row['Business Stream']),
        legalEntityScope: text(row['Legal Entity']), costCentreRule: text(row['Cost Centre Rule']),
        approvedEffectiveFrom: dateValue(row['Effective Date']),
        requiresCostCentre: text(row['Cost Centre Rule']).toLowerCase().startsWith('required'),
        active: true,
      };
      const account = await this.prisma.gLAccount.upsert({
        where: { companyId_accountNumber: { companyId, accountNumber: code } },
        create: { companyId, accountNumber: code, ...flags },
        update: flags,
        select: { id: true },
      });
      accountIds.set(code, account.id);
    }

    const maps = workbook.sheets.accountMaps;
    for (const row of maps) {
      const date = dateValue(row['Effective Date']);
      if (!date) continue;
      const application = text(row.Application), postingGroup = text(row['Posting Group']), postingKey = text(row['Posting Key']);
      const accountCode = text(row['GL Code']);
      await this.prisma.approvedPostingMap.upsert({
        where: { companyId_application_postingGroup_postingKey_effectiveFrom: { companyId, application, postingGroup, postingKey, effectiveFrom: date } },
        create: {
          companyId, application, postingGroup, postingKey, effectiveFrom: date,
          mapKey: text(row['Map Key']), accountCode, glAccountId: accountIds.get(accountCode) ?? null,
          status: text(row.Status), resolutionNote: text(row['Resolution Note']) || null,
        },
        update: {
          mapKey: text(row['Map Key']), accountCode, glAccountId: accountIds.get(accountCode) ?? null,
          status: text(row.Status), resolutionNote: text(row['Resolution Note']),
        },
      });
    }

    const controls = workbook.sheets.postingControls;
    for (const row of controls) {
      const application = text(row.Application), applicationRuleId = text(row['Application Rule ID']);
      const lineNumber = intValue(row['Line No.']);
      await this.prisma.approvedPostingControlLine.upsert({
        where: { companyId_application_applicationRuleId_lineNumber: { companyId, application, applicationRuleId, lineNumber } },
        create: controlLineData(companyId, row), update: controlLineData(companyId, row),
      });
    }

    const centres = workbook.sheets.costCentres;
    const centreIds = new Map<string, string>();
    for (const row of centres) {
      const code = text(row['Cost Centre Code']);
      const centre = await this.prisma.costCentre.upsert({
        where: { companyId_code: { companyId, code } },
        create: {
          companyId, code, name: text(row['Cost Centre Name']), effectiveDate: dateValue(new Date())!,
          approvedApplication: text(row.Application), businessUnit: text(row['Business Unit']),
          functionName: text(row.Function), activityStage: text(row['Activity or Stage']),
          location: text(row.Location), responsibilityOwner: text(row['Responsibility Owner']),
          postingAllowed: yes(row['Posting Allowed']), active: text(row.Status) === 'Active',
        },
        update: {
          name: text(row['Cost Centre Name']), approvedApplication: text(row.Application),
          businessUnit: text(row['Business Unit']), functionName: text(row.Function),
          activityStage: text(row['Activity or Stage']), location: text(row.Location),
          responsibilityOwner: text(row['Responsibility Owner']), postingAllowed: yes(row['Posting Allowed']),
          active: text(row.Status) === 'Active',
        }, select: { id: true },
      });
      centreIds.set(code, centre.id);
    }
    for (const row of centres) {
      const code = text(row['Cost Centre Code']), parentCode = text(row['Parent Cost Centre']);
      const parentId = centreIds.get(parentCode);
      await this.prisma.costCentre.update({
        where: { id: centreIds.get(code)! },
        data: { parentId: parentId ?? null },
      });
    }

    return {
      source: workbook.source, accounts: accounts.length, accountMaps: maps.length,
      postingControlLines: controls.length, costCentres: centres.length,
      mappedAccounts: maps.filter((row) => accountIds.has(text(row['GL Code']))).length,
    };
  }

  /* --- Historical six-digit compatibility accounts -------------------- */

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

    // On the approved chart the processing and feed-mill keys are linked to
    // the five-digit accounts (chart.ts APPROVED_PROCESSING_KEYS); every other
    // key keeps its historical six-digit link until it is moved.
    const approved = (await chartVersionOf(this.prisma, companyId)) === 'APPROVED';

    let linked = 0;
    for (const row of data.keys) {
      const override = approved ? APPROVED_PROCESSING_KEYS[row.key] : undefined;
      const code = override ? override.account : (row.glCode ?? '').trim();
      const atomic = override ? true : /^\d{6}$/.test(code);
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

interface Loaded { coa: CoaRow[]; keys: KeyRow[]; rules: RuleRow[]; approved: ApprovedWorkbook }
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
      const approved = JSON.parse(readFileSync(join(candidate, 'approved-posting-engine.json'), 'utf8')) as ApprovedWorkbook;
      cache = { coa, keys: control.keys, rules: control.rules, approved };
      return cache;
    }
    dir = dirname(dir);
  }
  throw new Error('Could not find packages/database/src/posting-control.json from ' + __dirname);
}

function text(value: unknown): string { return value === null || value === undefined ? '' : String(value).trim(); }
function yes(value: unknown): boolean { return text(value).toLowerCase() === 'yes'; }
function intValue(value: unknown): number { const number = Number(value); return Number.isInteger(number) ? number : 0; }
function dateValue(value: unknown): Date | null {
  const date = value instanceof Date ? value : value ? new Date(String(value)) : null;
  return date && Number.isFinite(date.getTime()) ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())) : null;
}
function approvedAccountType(type: string, code: string): AccountType {
  const kind = type.toLowerCase();
  if (kind === 'asset' || kind === 'contra asset') return AccountType.ASSET;
  if (kind === 'liability') return AccountType.LIABILITY;
  if (kind === 'equity') return AccountType.EQUITY;
  if (kind === 'income') return AccountType.REVENUE;
  if (kind === 'expense' || kind === 'contra expense') return AccountType.EXPENSE;
  // Mixed settlement/clearing and suspense accounts are non-posting by policy;
  // their statement class follows the approved balance-sheet caption.
  if (kind === 'asset/liability') return code.startsWith('1') ? AccountType.ASSET : AccountType.LIABILITY;
  throw new Error(`Unsupported approved COA account type "${type}" for ${code}.`);
}
function controlLineData(companyId: string, row: ApprovedRow) {
  return {
    companyId, application: text(row.Application), applicationRuleId: text(row['Application Rule ID']),
    baseRuleId: text(row['Base Rule ID']), module: text(row['Module / Category']),
    businessEvent: text(row['Business Event']), sequence: intValue(row.Sequence),
    sourceDocument: text(row['Source Document']), requiredStatus: text(row['Required Status']),
    requiredFields: text(row['Required Fields Before Posting']), lineNumber: intValue(row['Line No.']),
    side: text(row.Side), postingKey: text(row['Posting Key']), groupSource: text(row['Group Source']),
    postingGroup: text(row['Resolved Posting Group']), mapKey: text(row['Unique Link Key']),
    resolvedGl: text(row['Resolved GL']), amountBasis: text(row['Amount Basis']),
    reversalCorrection: text(row['Reversal / Correction']), blockingControls: text(row['Blocking Controls']),
    postingMode: text(row['Posting Mode']), auditRequirements: text(row['Audit Requirements']),
    costCentreRequirement: text(row['Cost Centre Requirement']), costCentreSource: text(row['Cost Centre Source']),
    costCentreValidation: text(row['Cost Centre Validation']),
  };
}

/* --- Copied from seed-spec-coa.ts / seed-posting-control.ts ------------ */

/**
 * Accounts the workbook implies but never names with a single code — see
 * migration 0003, which adds the same two to farms loaded before them.
 */
const EXTRA_ACCOUNTS: Array<[string, string]> = [
  ['420210', 'Agricultural Produce Gain — Eggs'], // PCR-067-CR "130210/420210"
  ['623100', 'Feed Mill Overhead Expense'], // PCR-031-DR "Processing/Feed-mill OH Expense"
  ['125200', 'WHT Receivable'], // the old chart's 1602, which the spec chart lacks
  ['690100', 'Operating Expenses'], // the old chart's 5401, which the spec chart lacks
  ['630200', 'Impairment Loss - Fixed Assets'], // IAS 36; the spec chart names no impairment account
  ['130590', 'Finished Goods - Capitalised Variance'], // POL-009 proration; no spec number
  ['130595', 'Work in Progress - Capitalised Variance'], // POL-009 proration; no spec number
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
