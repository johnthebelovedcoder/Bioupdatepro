// Applies the database-level invariants in prisma/sql/ after `prisma db push`.
//
// `prisma db push` only knows about the declarative schema. Triggers, CHECK
// constraints and the deferred balance assertion live in SQL and are applied
// here. Every file is idempotent, so this is safe to run on every push.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, '..', 'prisma', 'sql');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

// Retried: on a build machine the database's internal hostname has been
// seen to fail to resolve on the first attempt (ENOTFOUND) and succeed a few
// seconds later. Each attempt uses a fresh client — a failed pg.Client
// cannot be reconnected.
async function connect(attempts = 6) {
  for (let attempt = 1; ; attempt += 1) {
    const candidate = new pg.Client({ connectionString: url });
    try {
      await candidate.connect();
      return candidate;
    } catch (error) {
      await candidate.end().catch(() => {});
      if (attempt >= attempts) throw error;
      const wait = 1000 * 2 ** (attempt - 1);
      console.log(`  database not reachable yet (${error.code ?? error.message}) — retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
const client = await connect();

/*
 * One run at a time, for the whole set.
 *
 * Every file is idempotent on its own, but idempotent is not the same as
 * concurrency-safe: `CREATE EXTENSION IF NOT EXISTS` checks the catalogue and
 * then inserts, so two runs that reach 030_tax_constraints.sql together have
 * both passed the check and the slower one fails with "duplicate key value
 * violates unique constraint pg_extension_name_index" — taking the whole
 * migration down with it. `DROP CONSTRAINT IF EXISTS` / `ADD CONSTRAINT` pairs
 * race the same way.
 *
 * That is a real deployment, not a hypothetical: the API runs `db:migrate` from
 * its start command (render.yaml), so two instances starting together, or a
 * deploy overlapping a manual run, race here. `prisma migrate deploy` already
 * holds an advisory lock for its own run; this step needs its own.
 *
 * The lock is released when the session ends, so a crashed run cannot wedge the
 * next one. The key is arbitrary but fixed — it only has to be the same number
 * in every copy of this script.
 */
const LOCK_KEY = 8_314_207;

await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

try {
  const files = readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(sqlDir, file), 'utf8');
    await client.query(sql);
    console.log(`  applied ${file}`);
  }
  console.log(`Applied ${files.length} SQL file(s).`);
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
  await client.end();
}
