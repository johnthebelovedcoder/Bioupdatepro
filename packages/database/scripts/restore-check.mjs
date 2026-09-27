// Restore drill check: is a restored database complete and consistent?
//
// Run against the database a restore produced — on Neon, a branch created
// from a past point in time — never against production itself:
//
//   RESTORE_CHECK_URL="postgres://…restored-branch…" npm run restore:check -w @bioassetpro/database
//
// With RESTORE_CHECK_URL unset it checks DATABASE_URL (from the repo's .env),
// which is how the script is exercised locally.
//
// It reads only. It checks that every migration is applied, every protective
// trigger exists, every journal balances, each company's ledger balances, and
// every close pack still hashes to its fingerprint; and it prints the newest
// posting and audit entry, which is the recovery point the restore reached.
// Exit code 1 if anything fails, so the drill record is unambiguous.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageDir, '..', '..');

if (!process.env.RESTORE_CHECK_URL && !process.env.DATABASE_URL) {
  const envPath = join(repoRoot, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(DATABASE_URL)\s*=\s*(.*)\s*$/.exec(line);
      if (match) process.env.DATABASE_URL = match[2].replace(/^["']|["']$/g, '');
    }
  }
}
const url = process.env.RESTORE_CHECK_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set RESTORE_CHECK_URL to the restored database.');
  process.exit(2);
}

/** Same canonical form as apps/api/src/closing/close-pack.ts. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const q = async (sql, params) => (await client.query(sql, params)).rows;

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

const [{ now, db, version }] = await q(`SELECT now() AS now, current_database() AS db, current_setting('server_version') AS version`);

// 1. Every migration in the repo is applied and finished.
const expected = readdirSync(join(packageDir, 'prisma', 'migrations'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const applied = new Set((await q(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`)).map((r) => r.migration_name));
const missingMigrations = expected.filter((m) => !applied.has(m));
check('Migrations applied', missingMigrations.length === 0, missingMigrations.length ? `missing: ${missingMigrations.join(', ')}` : `${expected.length} of ${expected.length}`);

// 2. Every protective trigger the SQL files create exists.
const sqlDir = join(packageDir, 'prisma', 'sql');
const triggerNames = [
  ...new Set(
    readdirSync(sqlDir)
      .filter((f) => f.endsWith('.sql'))
      .flatMap((f) => [...readFileSync(join(sqlDir, f), 'utf8').matchAll(/CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+("?)(\w+)\1/gi)].map((m) => m[2])),
  ),
];
const present = new Set((await q(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`)).map((r) => r.tgname));
const missingTriggers = triggerNames.filter((t) => !present.has(t));
check('Protective triggers present', missingTriggers.length === 0, missingTriggers.length ? `missing: ${missingTriggers.join(', ')}` : `${triggerNames.length} triggers`);

// 3. Every journal balances.
const [{ unbalanced }] = await q(`
  SELECT count(*)::int AS unbalanced FROM (
    SELECT journal_entry_id FROM journal_lines GROUP BY journal_entry_id HAVING sum(debit_kobo) <> sum(credit_kobo)
  ) x`);
check('Every journal balances', unbalanced === 0, `${unbalanced} unbalanced`);

// 4. Each company's ledger balances in total.
const companies = await q(`
  SELECT je.company_id, sum(jl.debit_kobo)::text AS dr, sum(jl.credit_kobo)::text AS cr
  FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
  GROUP BY je.company_id`);
const offCompanies = companies.filter((c) => c.dr !== c.cr);
check('Each company ledger balances', offCompanies.length === 0, `${companies.length} companies${offCompanies.length ? `, ${offCompanies.length} out of balance` : ''}`);

// 5. Close packs still hash to their fingerprints.
let packs = [];
try {
  packs = await q(`SELECT id, content, sha256 FROM close_packs`);
} catch {
  packs = null;
}
if (packs) {
  const altered = packs.filter((p) => createHash('sha256').update(canonicalJson(p.content), 'utf8').digest('hex') !== p.sha256);
  check('Close packs intact', altered.length === 0, `${packs.length} packs${altered.length ? `, ${altered.length} altered` : ''}`);
}

// 6. The recovery point: the newest records the restore holds.
const [{ lastJournal }] = await q(`SELECT to_char(max(created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastJournal" FROM journal_entries`);
const [{ lastAudit }] = await q(`SELECT to_char(max(occurred_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastAudit" FROM audit_records`);
const counts = {};
for (const table of ['companies', 'users', 'journal_entries', 'journal_lines', 'audit_records', 'employees', 'livestock_groups', 'stock_movements', 'payroll_runs', 'close_packs']) {
  try {
    counts[table] = (await q(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
  } catch {
    counts[table] = null;
  }
}

await client.end();

const ok = results.every((r) => r.ok);
console.log(
  JSON.stringify(
    {
      checkedAt: new Date(now).toISOString(),
      database: db,
      postgres: version,
      // Prisma stores UTC in timestamp columns; formatted in SQL so the driver does not shift them to local time.
      recoveryPoint: { lastJournal, lastAudit },
      checks: results,
      counts,
      result: ok ? 'PASS' : 'FAIL',
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
