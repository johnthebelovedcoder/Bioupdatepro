import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@bioassetpro/database';
import type { TrialBalance, TrialBalanceService } from '../reporting/trial-balance.service';

type Client = Prisma.TransactionClient | PrismaClient;

/**
 * The close pack (handbook §8, audit evidence): what the ledger said when a
 * period or year was closed, kept with its SHA-256 fingerprint.
 *
 * The pack holds the trial balance — every account's debits and credits for
 * the period or year — from which the income statement and balance sheet are
 * drawn. Checking a pack answers two questions: has the stored pack itself
 * been altered (its content no longer hashes to its fingerprint), and does the
 * ledger still say what it said at close (a rebuilt trial balance hashes the
 * same). A posting into a closed period after a reopen shows up here, account
 * by account.
 */

export interface PackContent {
  report: 'TRIAL_BALANCE';
  scope: 'PERIOD' | 'YEAR';
  financialYearId: string;
  financialPeriodId: string | null;
  /** [account number, account name, debit kobo, credit kobo], by account number. */
  rows: Array<[string, string, string, string]>;
  totalDebitKobo: string;
  totalCreditKobo: string;
}

/** JSON with keys sorted at every level, so the same content always gives the same text (Postgres jsonb reorders keys). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const fingerprintOf = (content: PackContent) => createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex');

export function packContent(tb: TrialBalance, scope: { financialYearId: string; financialPeriodId: string | null }): PackContent {
  return {
    report: 'TRIAL_BALANCE',
    scope: scope.financialPeriodId ? 'PERIOD' : 'YEAR',
    financialYearId: scope.financialYearId,
    financialPeriodId: scope.financialPeriodId,
    rows: tb.rows
      .filter((r) => r.totalDebitKobo !== 0n || r.totalCreditKobo !== 0n)
      .map((r): [string, string, string, string] => [r.accountNumber, r.accountName, r.totalDebitKobo.toString(), r.totalCreditKobo.toString()])
      .sort((a, b) => a[0].localeCompare(b[0])),
    totalDebitKobo: tb.totalDebitKobo.toString(),
    totalCreditKobo: tb.totalCreditKobo.toString(),
  };
}

/** Store the pack for a close. Called inside the close's own transaction where there is one. */
export async function recordClosePack(
  client: Client,
  params: { companyId: string; financialYearId: string; financialPeriodId: string | null; tb: TrialBalance; createdById: string },
) {
  const content = packContent(params.tb, params);
  return client.closePack.create({
    data: {
      companyId: params.companyId,
      financialYearId: params.financialYearId,
      financialPeriodId: params.financialPeriodId,
      scope: content.scope,
      report: content.report,
      content: content as unknown as Prisma.InputJsonValue,
      sha256: fingerprintOf(content),
      createdById: params.createdById,
    },
  });
}

/** Rebuild what a pack recorded, from the ledger as it is now. */
export async function rebuild(trialBalance: TrialBalanceService, pack: { companyId: string; financialYearId: string; financialPeriodId: string | null }) {
  const tb = await trialBalance.build(
    pack.financialPeriodId
      ? { companyId: pack.companyId, financialPeriodId: pack.financialPeriodId }
      : { companyId: pack.companyId, financialYearId: pack.financialYearId },
  );
  return packContent(tb, pack);
}
