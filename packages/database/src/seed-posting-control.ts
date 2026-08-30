import { PrismaClient, LedgerFlag, PostingKeySide, PostingRuleStatus } from '../generated/client';
import control from './posting-control.json';

/**
 * Load the client's posting rules and posting keys.
 *
 * Consolidated Reference §66. Every row here comes from the approved workbook —
 * `Posting_Control` and `POSTING_COA_MASTER` — extracted rather than retyped,
 * because a posting rule transcribed by hand is a posting rule with a typo in
 * it, and a typo in this table is a journal to the wrong account.
 *
 * Two things this deliberately does NOT do.
 *
 * It does not invent an account for a key the workbook leaves open. Thirty-two
 * of the 172 keys carry an expression rather than a code — "Species BA
 * acquisition GL", "210100/210200", "1302xx" — stored exactly as written and
 * marked `atomic: false`, so this table refuses to post through them itself.
 * Roughly a third of those turn out to already resolve correctly, just not
 * through this table: the real account depends on something about the
 * transaction (which item, which population's stage, which journal is being
 * reversed) that a dedicated service already looks up — see
 * `DYNAMIC_RESOLUTION` below. The rest genuinely have no such service, either
 * because a client decision is still owed or because the module that would
 * need it (feed mill, processing, ABC costing) does not exist yet. Guessing
 * either kind would put real money in an account nobody approved.
 *
 * It does not create GL accounts. The workbook's six-digit chart (130100,
 * 210200) is not the four-digit chart this database currently carries, so a key
 * links to an account only where one with that code already exists. The rest
 * resolve to nothing yet, which is visible and fixable, rather than silently
 * pointing at whatever happened to match.
 */

interface RuleRow {
  ruleId: string;
  module: string;
  cycle: string;
  seq: number;
  trigger: string;
  sourceDocument: string;
  scenario: string;
  debitKey: string;
  creditKey: string;
  basis: string;
  dimensions: string;
  maker: string;
  approver: string;
  blocking: string;
  reversal: string;
  reportImpact: string;
  status: string;
}

interface KeyRow {
  key: string;
  glCode: string;
  glName: string;
  module: string;
  cycle: string;
  side: string;
  status: string;
  ledgerFlag: string;
}

/** The workbook's three flags, mapped to the enum. */
function ledgerFlagOf(value: string): LedgerFlag {
  if (value.startsWith('CONTROL')) return LedgerFlag.CONTROL;
  if (value.startsWith('GENERAL')) return LedgerFlag.GENERAL;
  if (value.startsWith('NO-JOURNAL')) return LedgerFlag.NO_JOURNAL;
  throw new Error(`Unrecognised Ledger Flag "${value}". §66.3 defines exactly three.`);
}

/**
 * Whether a code names exactly one account.
 *
 * The workbook's atomic codes are six digits. Anything else — an em dash for a
 * no-journal key, a slash between two accounts, a wildcard like `1302xx`, or a
 * sentence describing a profile — is an instruction to a human that has not yet
 * been turned into an account.
 */
function isAtomic(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}

/**
 * Non-atomic keys a dedicated service already resolves correctly per
 * transaction, verified by reading that service's actual code rather than
 * assumed from the rule's description.
 *
 * None of these needed a client decision — each one's real account was
 * already derivable from data the client HAD supplied (an item's configured
 * revenue/expense account, a population's current stage, the account an
 * original journal posted through), just not through this table. Every
 * other non-atomic key genuinely has no such service yet, either because it
 * belongs to a module that is not built (feed mill, processing, ABC costing)
 * or because it is a true open question — and stays unresolved, honestly.
 */
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

  // Fixed Assets (US-897-027) — did not exist when this table was built.
  // PCR-029-DR/030-DR/030-CR already resolve atomically (the recommended
  // six-digit chart carries 140100/630100/149100 alongside this database's
  // provisional four-digit accounts), so they needed nothing here. Only the
  // credit side of capitalisation names a genuinely dual account — "AP or
  // GRNI" — which FixedAssetService always resolves to Trade Payables,
  // never GRNI: a capitalised asset is its own capex event, not a receipt
  // already sitting in the P2P goods-received-not-invoiced holding account.
  'PCR-029-CR': 'FixedAssetService.resolveAccounts() — payables (2201)',
};

function statusOf(value: string): PostingRuleStatus {
  const v = value.trim().toLowerCase();
  if (v === 'approved') return PostingRuleStatus.APPROVED;
  if (v === 'retired') return PostingRuleStatus.RETIRED;
  return PostingRuleStatus.DRAFT;
}

export async function seedPostingControl(prisma: PrismaClient, companyId: string) {
  const { rules, keys } = control as { rules: RuleRow[]; keys: KeyRow[] };

  // The chart this database actually has, so a key links to a real account
  // where one exists and to nothing where it does not.
  const accounts = await prisma.gLAccount.findMany({
    where: { companyId },
    select: { id: true, accountNumber: true },
  });
  const accountByNumber = new Map(accounts.map((a) => [a.accountNumber, a.id]));

  let linked = 0;
  let unresolved = 0;
  let dynamicallyResolved = 0;

  for (const row of keys) {
    const code = (row.glCode ?? '').trim();
    const atomic = isAtomic(code);
    const glAccountId = atomic ? (accountByNumber.get(code) ?? null) : null;
    const dynamicResolution = atomic ? null : (DYNAMIC_RESOLUTION[row.key] ?? null);
    if (glAccountId) linked += 1;
    else if (dynamicResolution) dynamicallyResolved += 1;
    else unresolved += 1;

    await prisma.postingKey.upsert({
      where: { companyId_key: { companyId, key: row.key } },
      update: {
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
      },
      create: {
        companyId,
        key: row.key,
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
      },
    });
  }

  for (const row of rules) {
    await prisma.postingRule.upsert({
      where: { companyId_ruleId_version: { companyId, ruleId: row.ruleId, version: 1 } },
      update: {
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
      },
      create: {
        companyId,
        ruleId: row.ruleId,
        version: 1,
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
        // The workbook's own baseline date. Effective dating exists so a
        // correction is a new version rather than an edit to a rule that has
        // already posted.
        effectiveFrom: new Date('2026-01-01'),
      },
    });
  }

  return { rules: rules.length, keys: keys.length, linked, dynamicallyResolved, unresolved };
}

/* Runnable on its own: `tsx packages/database/src/seed-posting-control.ts`. */
if (process.argv[1]?.includes('seed-posting-control')) {
  const prisma = new PrismaClient();
  (async () => {
    const companies = await prisma.company.findMany({ select: { id: true, name: true } });
    for (const company of companies) {
      const result = await seedPostingControl(prisma, company.id);
      console.log(
        `${company.name}: ${result.rules} rules, ${result.keys} keys ` +
          `(${result.linked} linked to a GL account, ${result.dynamicallyResolved} resolved by ` +
          `dedicated application code, ${result.unresolved} still unresolved)`,
      );
    }
    console.log(
      '\nStill-unresolved keys are either NO-JOURNAL, a genuine open question for the\n' +
        'client, or a six-digit code this database does not carry. Posting through one\n' +
        'is refused. "Resolved by dedicated application code" keys are NOT posted\n' +
        'through this table at all — see DYNAMIC_RESOLUTION above for which service\n' +
        'actually resolves each one.',
    );
    await prisma.$disconnect();
  })();
}
