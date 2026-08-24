import { PrismaClient, AccountType, NormalBalance } from '../generated/client';
import recommended from './recommended-coa.json';
import control from './posting-control.json';

/**
 * The chart of accounts the specification posts to.
 *
 * `POSTING_COA_MASTER` resolves every posting key to a six-digit account —
 * 130100 Raw Materials, 210200 GRNI, 410100 Revenue — and this database carried
 * a four-digit chart of its own. So the posting rules seeded perfectly and
 * resolved to nothing at all: 172 keys, 0 accounts found. A posting-control
 * table that cannot reach an account is a table, not a control.
 *
 * Two sources, and the difference matters.
 *
 * `RECOMMENDED_COA_CC` states 36 accounts with their class and normal balance.
 * Those are taken exactly as written.
 *
 * The remaining accounts are named in `POSTING_COA_MASTER` itself — it gives
 * both the code and the account name for all 132 atomic keys — but not their
 * class. That is derived from the leading digit, which is the workbook's own
 * scheme and holds without exception across all 36 confirmed rows: 1 asset,
 * 2 liability, 3 equity, 4 income, 5 and 6 expense, with `149xxx` contra-asset
 * and `2198xx` clearing as the two named exceptions. Derived accounts are
 * marked so the distinction between what the client stated and what follows
 * from their scheme stays visible.
 *
 * This does NOT migrate the existing four-digit chart or anything posted to it.
 * That is a separate exercise needing the client's sign-off and a plan for the
 * balances already there, and doing it quietly inside a seed would be the worst
 * possible way to carry it out.
 */

interface CoaRow {
  module: string;
  code: string;
  name: string;
  klass: string;
  normal: string;
  purpose: string;
}

interface KeyRow {
  key: string;
  glCode: string;
  glName: string;
  cycle: string;
}

/** Class and normal balance from the code, per the workbook's own scheme. */
function derive(code: string): { type: AccountType; normal: NormalBalance } {
  // Accumulated depreciation sits in the asset range and behaves as a credit.
  if (code.startsWith('149')) return { type: AccountType.ASSET, normal: NormalBalance.CREDIT };
  // The recovery/clearing accounts — S_Recovery_GL, P_Recovery_GL, Feed Mill.
  // Credit-normal because standard cost is absorbed into WIP against them.
  if (code.startsWith('2198')) return { type: AccountType.LIABILITY, normal: NormalBalance.CREDIT };

  switch (code[0]) {
    case '1':
      return { type: AccountType.ASSET, normal: NormalBalance.DEBIT };
    case '2':
      return { type: AccountType.LIABILITY, normal: NormalBalance.CREDIT };
    case '3':
      return { type: AccountType.EQUITY, normal: NormalBalance.CREDIT };
    case '4':
      return { type: AccountType.REVENUE, normal: NormalBalance.CREDIT };
    default:
      return { type: AccountType.EXPENSE, normal: NormalBalance.DEBIT };
  }
}

function statedType(klass: string): AccountType | null {
  const k = klass.toLowerCase();
  if (k.startsWith('asset') || k.startsWith('contra asset')) return AccountType.ASSET;
  if (k.startsWith('liability') || k.startsWith('clearing')) return AccountType.LIABILITY;
  if (k.startsWith('equity')) return AccountType.EQUITY;
  if (k.startsWith('income/expense')) return AccountType.REVENUE;
  if (k.startsWith('income')) return AccountType.REVENUE;
  if (k.startsWith('expense')) return AccountType.EXPENSE;
  return null;
}

function statedNormal(normal: string): NormalBalance | null {
  const n = normal.trim().toLowerCase();
  // "Credit/Debit" means it swings both ways; the first named side is its
  // normal one, which is how the workbook writes gain/loss and variance rows.
  if (n.startsWith('debit')) return NormalBalance.DEBIT;
  if (n.startsWith('credit')) return NormalBalance.CREDIT;
  return null;
}

export async function seedSpecChart(prisma: PrismaClient, companyId: string) {
  const coa = recommended as CoaRow[];
  const { keys } = control as { keys: KeyRow[] };

  /** code -> { name, type, normal, stated } */
  const wanted = new Map<
    string,
    { name: string; type: AccountType; normal: NormalBalance; stated: boolean }
  >();

  for (const row of coa) {
    const type = statedType(row.klass);
    const normal = statedNormal(row.normal);
    if (!type || !normal) continue;
    wanted.set(row.code, { name: row.name, type, normal, stated: true });
  }

  for (const key of keys) {
    const code = (key.glCode ?? '').trim();
    if (!/^\d{6}$/.test(code) || wanted.has(code)) continue;
    const { type, normal } = derive(code);
    wanted.set(code, { name: key.glName, type, normal, stated: false });
  }

  let created = 0;
  let existing = 0;
  for (const [code, account] of wanted) {
    const already = await prisma.gLAccount.findFirst({
      where: { companyId, accountNumber: code },
      select: { id: true },
    });
    if (already) {
      existing += 1;
      continue;
    }
    await prisma.gLAccount.create({
      data: {
        companyId,
        accountNumber: code,
        name: account.name,
        accountType: account.type,
        normalBalance: account.normal,
        isPostingAccount: true,
        active: true,
        // Work in progress must be attributable. §10.5, and the same rule the
        // four-digit chart already applies to 1501.
        requiresCostCentre: code.startsWith('1304'),
      },
    });
    created += 1;
  }

  const stated = [...wanted.values()].filter((a) => a.stated).length;
  return { total: wanted.size, created, existing, stated, derived: wanted.size - stated };
}

/* Runnable on its own: `tsx packages/database/src/seed-spec-coa.ts`. */
if (process.argv[1]?.includes('seed-spec-coa')) {
  const prisma = new PrismaClient();
  (async () => {
    for (const company of await prisma.company.findMany({ select: { id: true, name: true } })) {
      const result = await seedSpecChart(prisma, company.id);
      console.log(
        `${company.name}: ${result.total} specification accounts ` +
          `(${result.created} created, ${result.existing} already present) — ` +
          `${result.stated} as stated by the client, ${result.derived} derived from the code`,
      );
    }
    await prisma.$disconnect();
  })();
}
