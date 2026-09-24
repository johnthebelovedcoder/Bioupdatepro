import { Injectable } from '@nestjs/common';
import { AuditAction } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AccountingRuleViolation } from '../common/errors';
import { parseMoney, parseStatementCsv, StatementParseError } from './statement-csv';

/**
 * Bank reconciliation — proving the ledger's bank account against the bank.
 *
 * The ledger already knew what it paid and received through each bank GL
 * account; nothing checked that against what the bank says happened. A
 * statement is imported, each line is matched to the posted ledger line it
 * is (automatically where amount and date make it unambiguous, by hand
 * otherwise), and what is left on either side is the reconciliation:
 *
 *   statement closing balance
 *     = ledger balance
 *     − ledger movements the bank has not shown yet (uncleared)
 *     + statement lines not yet in the ledger (bank charges, interest…)
 *
 * When that holds to the kobo, the account is reconciled.
 */
const RULE = 'Bank reconciliation';
const AUTO_MATCH_DAYS = 5;

@Injectable()
export class BankingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /* --- Accounts --------------------------------------------------------- */

  async listAccounts(companyId: string) {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { companyId },
      orderBy: { name: 'asc' },
      include: {
        statements: { orderBy: { periodTo: 'desc' }, take: 1 },
      },
    });
    const gl = await this.prisma.gLAccount.findMany({
      where: { id: { in: accounts.map((a) => a.glAccountId) } },
      select: { id: true, accountNumber: true, name: true },
    });
    const glById = new Map(gl.map((g) => [g.id, g]));

    return Promise.all(
      accounts.map(async (account) => {
        const unmatched = await this.prisma.bankStatementLine.count({
          where: { status: 'UNMATCHED', statement: { bankAccountId: account.id } },
        });
        const latest = account.statements[0] ?? null;
        return {
          id: account.id,
          name: account.name,
          bankName: account.bankName,
          accountNumberMasked: mask(account.accountNumber),
          active: account.active,
          glAccount: glById.get(account.glAccountId) ?? null,
          ledgerBalanceKobo: (await this.ledgerBalance(account.glAccountId)).toString(),
          latestStatement: latest
            ? {
                periodTo: latest.periodTo.toISOString().slice(0, 10),
                closingBalanceKobo: latest.closingBalanceKobo.toString(),
              }
            : null,
          unmatchedLines: unmatched,
        };
      }),
    );
  }

  async createAccount(params: {
    companyId: string;
    actorId: string;
    glAccountId: string;
    name: string;
    bankName: string;
    accountNumber: string;
  }) {
    const name = String(params.name ?? '').trim();
    const bankName = String(params.bankName ?? '').trim();
    const accountNumber = String(params.accountNumber ?? '').replace(/\s+/g, '');
    if (!name || !bankName || !accountNumber) {
      throw new AccountingRuleViolation(RULE, 'Give the account a name, the bank, and its account number.', {});
    }

    const gl = await this.prisma.gLAccount.findFirst({
      where: { id: params.glAccountId, companyId: params.companyId },
    });
    if (!gl || !gl.active || !gl.isPostingAccount || gl.accountType !== 'ASSET') {
      throw new AccountingRuleViolation(
        RULE,
        'A bank account has to sit on an active asset account that can be posted to.',
        {},
      );
    }
    const taken = await this.prisma.bankAccount.findFirst({
      where: { companyId: params.companyId, glAccountId: gl.id },
    });
    if (taken) {
      throw new AccountingRuleViolation(
        RULE,
        `${gl.accountNumber} ${gl.name} is already the ledger account for "${taken.name}". Two bank ` +
          'accounts on one ledger account could never be reconciled apart.',
        {},
      );
    }

    const account = await this.prisma.bankAccount.create({
      data: {
        companyId: params.companyId,
        glAccountId: gl.id,
        name,
        bankName,
        accountNumber,
        createdById: params.actorId,
      },
    });
    await this.audit.write({
      transactionId: account.id,
      module: 'banking',
      entityType: 'BankAccount',
      entityId: account.id,
      status: 'ACTIVE',
      action: AuditAction.CREATE,
      userId: params.actorId,
      comments: `Added bank account ${name} (${bankName} ${mask(accountNumber)}) on ${gl.accountNumber}.`,
    });
    return { id: account.id };
  }

  /* --- Statements ------------------------------------------------------- */

  /**
   * Import a statement. The opening and closing balances are the bank's and
   * are checked against the lines: if opening + every line ≠ closing, the
   * file is incomplete or mis-read, and it is refused rather than imported.
   */
  async importStatement(params: {
    companyId: string;
    actorId: string;
    bankAccountId: string;
    csv: string;
    openingBalance: string;
    closingBalance: string;
    fileName?: string | null;
  }) {
    const account = await this.ownAccount(params.companyId, params.bankAccountId);

    const opening = parseMoney(String(params.openingBalance ?? ''));
    const closing = parseMoney(String(params.closingBalance ?? ''));
    if (opening === null || closing === null) {
      throw new AccountingRuleViolation(
        RULE,
        'Enter the opening and closing balances exactly as the statement prints them.',
        {},
      );
    }

    let lines;
    try {
      lines = parseStatementCsv(String(params.csv ?? ''));
    } catch (error) {
      if (error instanceof StatementParseError) throw new AccountingRuleViolation(RULE, error.message, {});
      throw error;
    }

    const movement = lines.reduce((sum, line) => sum + line.amountKobo, 0n);
    if (opening + movement !== closing) {
      throw new AccountingRuleViolation(
        RULE,
        `The lines do not add up: opening ${naira(opening)} plus ${lines.length} lines totalling ` +
          `${naira(movement)} is ${naira(opening + movement)}, but the statement closes at ` +
          `${naira(closing)}. The file is incomplete, or a balance was mistyped.`,
        { difference: (closing - opening - movement).toString() },
      );
    }

    const dates = lines.map((line) => line.valueDate.getTime());
    const periodFrom = new Date(Math.min(...dates));
    const periodTo = new Date(Math.max(...dates));

    const statement = await this.prisma.bankStatement.create({
      data: {
        companyId: params.companyId,
        bankAccountId: account.id,
        periodFrom,
        periodTo,
        openingBalanceKobo: opening,
        closingBalanceKobo: closing,
        sourceFileName: params.fileName?.trim() || null,
        importedById: params.actorId,
        lines: {
          createMany: {
            data: lines.map((line) => ({
              lineNumber: line.lineNumber,
              valueDate: line.valueDate,
              description: line.description,
              reference: line.reference,
              amountKobo: line.amountKobo,
            })),
          },
        },
      },
    });

    await this.audit.write({
      transactionId: statement.id,
      module: 'banking',
      entityType: 'BankStatement',
      entityId: statement.id,
      status: 'IMPORTED',
      action: AuditAction.CREATE,
      userId: params.actorId,
      comments: `Imported ${lines.length} lines for ${account.name}, ${iso(periodFrom)} to ${iso(periodTo)}.`,
    });

    const matched = await this.autoMatch(params.companyId, account.id, params.actorId);
    return { statementId: statement.id, lines: lines.length, autoMatched: matched.matched };
  }

  /* --- Matching --------------------------------------------------------- */

  /**
   * Match every unmatched line to the one posted ledger line with the same
   * signed amount within a few days of it. Only unambiguous pairs: two
   * ₦50,000 payments in the same week are left for a person to tell apart.
   */
  async autoMatch(companyId: string, bankAccountId: string, actorId: string) {
    const account = await this.ownAccount(companyId, bankAccountId);
    const lines = await this.prisma.bankStatementLine.findMany({
      where: { status: 'UNMATCHED', statement: { bankAccountId: account.id } },
      orderBy: [{ valueDate: 'asc' }, { lineNumber: 'asc' }],
    });
    if (lines.length === 0) return { matched: 0 };

    const ledger = await this.unmatchedLedgerLines(account.glAccountId);
    const used = new Set<string>();
    let matched = 0;

    for (const line of lines) {
      const window = AUTO_MATCH_DAYS * 86_400_000;
      const candidates = ledger.filter(
        (l) =>
          !used.has(l.id) &&
          l.signedKobo === line.amountKobo &&
          Math.abs(l.journalDate.getTime() - line.valueDate.getTime()) <= window,
      );
      if (candidates.length !== 1) continue;
      const pick = candidates[0]!;
      used.add(pick.id);
      await this.prisma.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: 'MATCHED',
          matchedJournalLineId: pick.id,
          settledById: actorId,
          settledAt: new Date(),
        },
      });
      matched += 1;
    }
    return { matched };
  }

  async match(params: { companyId: string; actorId: string; lineId: string; journalLineId: string }) {
    const line = await this.ownLine(params.companyId, params.lineId);
    if (line.status !== 'UNMATCHED') {
      throw new AccountingRuleViolation(RULE, 'That line is already settled. Undo it first.', {});
    }
    const account = line.statement.bankAccount;
    const ledgerLine = await this.prisma.journalLine.findFirst({
      where: {
        id: params.journalLineId,
        glAccountId: account.glAccountId,
        journalEntry: { status: 'POSTED', companyId: params.companyId },
      },
      include: { journalEntry: { select: { journalNumber: true } } },
    });
    if (!ledgerLine) {
      throw new AccountingRuleViolation(RULE, 'That is not a posted line on this bank account.', {});
    }
    const signed = ledgerLine.debitKobo - ledgerLine.creditKobo;
    if (signed !== line.amountKobo) {
      throw new AccountingRuleViolation(
        RULE,
        `Amounts differ: the bank shows ${naira(line.amountKobo)}, ` +
          `${ledgerLine.journalEntry.journalNumber} shows ${naira(signed)}. A match must be exact — ` +
          'a difference is a separate item (a bank charge, a short payment) to journal.',
        {},
      );
    }
    const claimed = await this.prisma.bankStatementLine.findUnique({
      where: { matchedJournalLineId: ledgerLine.id },
    });
    if (claimed) {
      throw new AccountingRuleViolation(RULE, `${ledgerLine.journalEntry.journalNumber} is already matched to another bank line.`, {});
    }

    await this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: { status: 'MATCHED', matchedJournalLineId: ledgerLine.id, settledById: params.actorId, settledAt: new Date() },
    });
    return { matched: true };
  }

  async ignore(params: { companyId: string; actorId: string; lineId: string; reason: string }) {
    const line = await this.ownLine(params.companyId, params.lineId);
    const reason = String(params.reason ?? '').trim();
    if (!reason) {
      throw new AccountingRuleViolation(
        RULE,
        'Say why this line is set aside — a charge still to journal, a transfer between the farm\'s own accounts.',
        {},
      );
    }
    if (line.status !== 'UNMATCHED') {
      throw new AccountingRuleViolation(RULE, 'That line is already settled. Undo it first.', {});
    }
    await this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: { status: 'IGNORED', ignoredReason: reason, settledById: params.actorId, settledAt: new Date() },
    });
    return { ignored: true };
  }

  async unsettle(params: { companyId: string; lineId: string }) {
    const line = await this.ownLine(params.companyId, params.lineId);
    await this.prisma.bankStatementLine.update({
      where: { id: line.id },
      data: {
        status: 'UNMATCHED',
        matchedJournalLineId: null,
        ignoredReason: null,
        settledById: null,
        settledAt: null,
      },
    });
    return { unmatched: true };
  }

  /* --- The reconciliation ----------------------------------------------- */

  /**
   * One bank account, as at its latest statement: every statement line with
   * its status and match, every posted ledger line the bank has not shown,
   * and whether the identity holds.
   */
  async reconciliation(companyId: string, bankAccountId: string) {
    const account = await this.ownAccount(companyId, bankAccountId);
    const gl = await this.prisma.gLAccount.findUniqueOrThrow({
      where: { id: account.glAccountId },
      select: { accountNumber: true, name: true },
    });
    const latest = await this.prisma.bankStatement.findFirst({
      where: { bankAccountId: account.id },
      orderBy: { periodTo: 'desc' },
    });

    const lines = await this.prisma.bankStatementLine.findMany({
      where: { statement: { bankAccountId: account.id } },
      orderBy: [{ valueDate: 'desc' }, { lineNumber: 'desc' }],
      take: 500,
    });
    const matchedIds = lines.map((l) => l.matchedJournalLineId).filter((id): id is string => !!id);
    const matchedLedger = await this.prisma.journalLine.findMany({
      where: { id: { in: matchedIds } },
      include: { journalEntry: { select: { journalNumber: true, journalDate: true } } },
    });
    const ledgerById = new Map(matchedLedger.map((l) => [l.id, l]));

    const asOf = latest?.periodTo ?? null;
    /*
     * Ledger movements from before the first imported statement are already
     * inside that statement's opening balance, so they are not "waiting to
     * clear" — only what falls within the imported range can be. If the
     * ledger's history before then disagrees with the opening balance, that
     * shows as a difference, which is exactly what it is.
     */
    const earliest = await this.prisma.bankStatement.findFirst({
      where: { bankAccountId: account.id },
      orderBy: { periodFrom: 'asc' },
      select: { periodFrom: true },
    });
    const since = earliest?.periodFrom ?? null;
    const unmatchedLedger =
      asOf && since
        ? (await this.unmatchedLedgerLines(account.glAccountId)).filter(
            (l) => l.journalDate >= since && l.journalDate <= asOf,
          )
        : [];
    const ledgerBalance = asOf ? await this.ledgerBalance(account.glAccountId, asOf) : await this.ledgerBalance(account.glAccountId);

    const unclearedKobo = unmatchedLedger.reduce((sum, l) => sum + l.signedKobo, 0n);
    const notInLedgerKobo = lines
      .filter((l) => l.status !== 'MATCHED' && (!asOf || l.valueDate <= asOf))
      .reduce((sum, l) => sum + l.amountKobo, 0n);
    const expected = ledgerBalance - unclearedKobo + notInLedgerKobo;
    const difference = latest ? latest.closingBalanceKobo - expected : null;

    return {
      bankAccount: {
        id: account.id,
        name: account.name,
        bankName: account.bankName,
        accountNumberMasked: mask(account.accountNumber),
        glAccount: gl,
      },
      asOf: asOf ? iso(asOf) : null,
      statementClosingKobo: latest?.closingBalanceKobo.toString() ?? null,
      ledgerBalanceKobo: ledgerBalance.toString(),
      unclearedKobo: unclearedKobo.toString(),
      notInLedgerKobo: notInLedgerKobo.toString(),
      differenceKobo: difference?.toString() ?? null,
      reconciled: difference === 0n,
      lines: lines.map((l) => {
        const ledger = l.matchedJournalLineId ? ledgerById.get(l.matchedJournalLineId) : undefined;
        return {
          id: l.id,
          valueDate: iso(l.valueDate),
          description: l.description,
          reference: l.reference,
          amountKobo: l.amountKobo.toString(),
          status: l.status,
          ignoredReason: l.ignoredReason,
          matchedJournal: ledger
            ? { journalNumber: ledger.journalEntry.journalNumber, journalDate: iso(ledger.journalEntry.journalDate) }
            : null,
        };
      }),
      uncleared: unmatchedLedger.map((l) => ({
        id: l.id,
        journalNumber: l.journalNumber,
        journalDate: iso(l.journalDate),
        description: l.description,
        signedKobo: l.signedKobo.toString(),
      })),
    };
  }

  /* --- Helpers ---------------------------------------------------------- */

  private async ownAccount(companyId: string, bankAccountId: string) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id: bankAccountId, companyId } });
    if (!account) throw new AccountingRuleViolation(RULE, 'No such bank account.', {});
    return account;
  }

  private async ownLine(companyId: string, lineId: string) {
    const line = await this.prisma.bankStatementLine.findFirst({
      where: { id: lineId, statement: { companyId } },
      include: { statement: { include: { bankAccount: true } } },
    });
    if (!line) throw new AccountingRuleViolation(RULE, 'No such statement line.', {});
    return line;
  }

  /** Posted lines on the bank's GL account not yet matched to any statement line. */
  private async unmatchedLedgerLines(glAccountId: string) {
    const [lines, matched] = await Promise.all([
      this.prisma.journalLine.findMany({
        where: { glAccountId, journalEntry: { status: 'POSTED' } },
        include: { journalEntry: { select: { journalNumber: true, journalDate: true } } },
        orderBy: { journalEntry: { journalDate: 'asc' } },
      }),
      this.prisma.bankStatementLine.findMany({
        where: { matchedJournalLineId: { not: null } },
        select: { matchedJournalLineId: true },
      }),
    ]);
    const taken = new Set(matched.map((m) => m.matchedJournalLineId));
    return lines
      .filter((l) => !taken.has(l.id))
      .map((l) => ({
        id: l.id,
        journalNumber: l.journalEntry.journalNumber,
        journalDate: l.journalEntry.journalDate,
        description: l.description,
        signedKobo: l.debitKobo - l.creditKobo,
      }));
  }

  private async ledgerBalance(glAccountId: string, asOf?: Date) {
    const sum = await this.prisma.journalLine.aggregate({
      where: {
        glAccountId,
        journalEntry: { status: 'POSTED', ...(asOf ? { journalDate: { lte: asOf } } : {}) },
      },
      _sum: { debitKobo: true, creditKobo: true },
    });
    return (sum._sum.debitKobo ?? 0n) - (sum._sum.creditKobo ?? 0n);
  }
}

function mask(accountNumber: string): string {
  return accountNumber.length <= 4 ? accountNumber : `••••${accountNumber.slice(-4)}`;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function naira(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}₦${whole}.${(abs % 100n).toString().padStart(2, '0')}`;
}
