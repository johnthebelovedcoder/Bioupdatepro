import { Injectable } from '@nestjs/common';
import { LedgerFlag, PostingRuleStatus, Prisma } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingRuleViolation } from '../common/errors';

/**
 * Consolidated Reference §66 — posting rules, resolved rather than written.
 *
 * The rule this implements is one sentence: "A transaction user must never type
 * a GL account. The approved business event selects debit and credit posting
 * keys; the system retrieves both GL code and GL name from POSTING_COA_MASTER,
 * validates the Ledger Flag, dimensions, period and approval, and then posts
 * one balanced atomic journal."
 *
 * Every posting in this application used to name its accounts in TypeScript.
 * That is not a matter of taste. A rule in code cannot be effective-dated,
 * cannot be approved by a Finance Controller, cannot be retired, and cannot
 * be audited without reading a diff — and §66.4 requires all four. It also left
 * nothing enforcing the Ledger Flag, so a manual journal could be posted
 * straight into GRNI or trade payables, which is exactly what the flag exists
 * to prevent.
 *
 * Everything below refuses rather than guesses. §66.2 step 4 is explicit that a
 * missing, duplicate, inactive or **non-atomic** result blocks posting, and
 * forty of the 172 keys are currently one of those — either a no-journal event
 * or an expression like "Species BA acquisition GL" that the client has not yet
 * pinned to an account. Resolving one of those on the farm's behalf would put
 * real money into an account nobody approved.
 */

export interface ResolvedSide {
  key: string;
  glAccountId: string;
  accountNumber: string;
  accountName: string;
  ledgerFlag: LedgerFlag;
}

export interface ResolvedRule {
  ruleId: string;
  version: number;
  module: string;
  cycle: string;
  trigger: string;
  sourceDocument: string;
  measurementBasis: string;
  /** As the workbook states them, semicolon separated. */
  requiredDimensions: string[];
  makerRole: string;
  approverRole: string;
  blockingControl: string;
  reversalMethod: string;
  /** Null for a NO-JOURNAL rule: approval and audit only, no accounting. */
  debit: ResolvedSide | null;
  credit: ResolvedSide | null;
  /** True when this rule deliberately creates no journal. */
  postsNothing: boolean;
}

@Injectable()
export class PostingControlService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Steps 2 to 5 of §66.2: select the rule, resolve the keys, retrieve the
   * chart, enforce the flag.
   *
   * The caller supplies a rule id because the business event knows which rule
   * it is — a goods receipt of stock is PCR-004 and nothing else. Resolving by
   * searching on module and cycle would make the mapping implicit again, which
   * is the thing this replaces.
   */
  async resolve(params: {
    companyId: string;
    ruleId: string;
    on: Date;
  }): Promise<ResolvedRule> {
    const day = new Date(
      Date.UTC(params.on.getUTCFullYear(), params.on.getUTCMonth(), params.on.getUTCDate()),
    );

    /* Step 2 — the active rule. Draft and retired rules cannot post. */
    const rule = await this.prisma.postingRule.findFirst({
      where: {
        companyId: params.companyId,
        ruleId: params.ruleId,
        status: PostingRuleStatus.APPROVED,
        effectiveFrom: { lte: day },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: day } }],
      },
      orderBy: { version: 'desc' },
    });

    if (!rule) {
      const anyVersion = await this.prisma.postingRule.findFirst({
        where: { companyId: params.companyId, ruleId: params.ruleId },
        select: { status: true, effectiveFrom: true },
      });
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting rule',
        anyVersion
          ? `Posting rule ${params.ruleId} is ${anyVersion.status.toLowerCase()} and not ` +
              `effective on ${day.toISOString().slice(0, 10)}. Only an approved, ` +
              `effective-dated rule may post.`
          : `No posting rule ${params.ruleId} exists for this company. A business event ` +
              `with no approved rule must not post.`,
        { ruleId: params.ruleId, on: day.toISOString().slice(0, 10) },
      );
    }

    /* Steps 3 and 4 — the keys, and the one account each must resolve to. */
    const [debit, credit] = await Promise.all([
      this.side(params.companyId, rule.debitKey, rule.ruleId),
      this.side(params.companyId, rule.creditKey, rule.ruleId),
    ]);

    const postsNothing =
      debit.flag === LedgerFlag.NO_JOURNAL && credit.flag === LedgerFlag.NO_JOURNAL;

    /*
     * A rule half of which posts nothing is a rule nobody can act on: it would
     * write one line and leave the journal unbalanced. Caught here rather than
     * at the balance check so the message names the cause.
     */
    if (!postsNothing && (debit.flag === LedgerFlag.NO_JOURNAL || credit.flag === LedgerFlag.NO_JOURNAL)) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Ledger Flag',
        `Posting rule ${rule.ruleId} has one NO-JOURNAL side and one posting side, so it ` +
          `would write an unbalanced journal. Both sides must post, or neither.`,
        { ruleId: rule.ruleId, debitKey: rule.debitKey, creditKey: rule.creditKey },
      );
    }

    return {
      ruleId: rule.ruleId,
      version: rule.version,
      module: rule.module,
      cycle: rule.cycle,
      trigger: rule.trigger,
      sourceDocument: rule.sourceDocument,
      measurementBasis: rule.measurementBasis,
      requiredDimensions: rule.requiredDimensions
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean),
      makerRole: rule.makerRole,
      approverRole: rule.approverRole,
      blockingControl: rule.blockingControl,
      reversalMethod: rule.reversalMethod,
      debit: postsNothing ? null : debit.resolved,
      credit: postsNothing ? null : credit.resolved,
      postsNothing,
    };
  }

  /**
   * One key, to one active atomic account — or a refusal saying which.
   *
   * The four failure modes §66.2 names are each reported separately, because
   * "could not post" tells a Finance Controller nothing about whether they
   * need to activate an account, create one, or decide which of two a dynamic
   * expression means.
   */
  private async side(
    companyId: string,
    key: string,
    ruleId: string,
  ): Promise<{ flag: LedgerFlag; resolved: ResolvedSide }> {
    const row = await this.prisma.postingKey.findUnique({
      where: { companyId_key: { companyId, key } },
      include: { glAccount: true },
    });

    if (!row) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting key',
        `Posting rule ${ruleId} names key ${key}, which does not exist in the posting ` +
          `chart. A missing key blocks posting.`,
        { ruleId, key },
      );
    }

    if (!row.active) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting key',
        `Posting key ${key} is not active. Draft keys cannot post.`,
        { ruleId, key },
      );
    }

    if (row.ledgerFlag === LedgerFlag.NO_JOURNAL) {
      return {
        flag: LedgerFlag.NO_JOURNAL,
        resolved: {
          key,
          glAccountId: '',
          accountNumber: '',
          accountName: row.glAccountName,
          ledgerFlag: LedgerFlag.NO_JOURNAL,
        },
      };
    }

    if (!row.atomic) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting key',
        `Posting key ${key} resolves to "${row.glAccountCode ?? row.glAccountName}", which ` +
          `is not a single account. §66 requires one active atomic GL before posting — ` +
          `somebody has to decide which account this means before ${ruleId} can be used.`,
        { ruleId, key, expression: row.glAccountCode ?? row.glAccountName },
      );
    }

    if (!row.glAccount) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting key',
        `Posting key ${key} names account ${row.glAccountCode} (${row.glAccountName}), ` +
          `which does not exist in this company's chart of accounts.`,
        { ruleId, key, accountNumber: row.glAccountCode },
      );
    }

    if (!row.glAccount.active) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §66 — Posting key',
        `Account ${row.glAccount.accountNumber} (${row.glAccount.name}) is inactive, so ` +
          `posting key ${key} cannot be used.`,
        { ruleId, key, accountNumber: row.glAccount.accountNumber },
      );
    }

    return {
      flag: row.ledgerFlag,
      resolved: {
        key,
        glAccountId: row.glAccount.id,
        accountNumber: row.glAccount.accountNumber,
        accountName: row.glAccount.name,
        ledgerFlag: row.ledgerFlag,
      },
    };
  }

  /**
   * §66.3 — refuse a manual journal to a control account.
   *
   * "Block direct manual journals. Accept only an authorised event from the
   * owning subledger or system process." This is the guard that makes the flag
   * mean something: without it, a controller could hand-journal GRNI back to
   * zero and the three-way match would have nothing left to reconcile against.
   *
   * Called with the accounts a proposed journal touches. Silent for accounts
   * carrying no posting key — the four-digit chart this database still uses is
   * not in the posting master, and refusing everything unmapped would stop the
   * application dead rather than protect anything.
   *
   * One account is blocked on the restrictive reading, and it is worth stating
   * why. `POSTING_COA_MASTER` gives 130100 Raw Materials and Consumables the
   * flag GENERAL on four keys (PCR-004-DR, PCR-012-CR, PCR-013-DR, PCR-014-CR)
   * and CONTROL on others — the only account in the workbook carrying two
   * different flags. §66.3's own definition lists "inventory" among the control
   * ledgers, so CONTROL is taken as correct and the four GENERAL rows read as
   * an inconsistency to raise with the client. Any key marking an account
   * CONTROL closes it: a control account wrongly left open is a reconciliation
   * somebody can quietly break, while one wrongly closed is a message asking
   * them to correct the source document.
   */
  async assertManualJournalAllowed(params: {
    companyId: string;
    glAccountIds: readonly string[];
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    if (params.glAccountIds.length === 0) return;
    const client = params.tx ?? this.prisma;

    const controlled = await client.postingKey.findMany({
      where: {
        companyId: params.companyId,
        glAccountId: { in: [...new Set(params.glAccountIds)] },
        ledgerFlag: LedgerFlag.CONTROL,
        active: true,
      },
      select: { key: true, glAccount: { select: { accountNumber: true, name: true } } },
    });

    if (controlled.length === 0) return;

    const named = [
      ...new Set(
        controlled.map(
          (row) => `${row.glAccount?.accountNumber ?? '?'} ${row.glAccount?.name ?? row.key}`,
        ),
      ),
    ];

    throw new AccountingRuleViolation(
      'Consolidated Reference §66.3 — Ledger Flag',
      `${named.join(', ')} ${named.length === 1 ? 'is a control account' : 'are control accounts'} ` +
        `— subledger and system postings only. A manual journal cannot touch ` +
        `${named.length === 1 ? 'it' : 'them'}. Correct the source document instead, and the ` +
        `subledger will post the change.`,
      { accounts: named },
    );
  }
}
