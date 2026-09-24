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

try {
  const files = readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(join(sqlDir, file), 'utf8');
    await client.query(sql);
    console.log(`  applied ${file}`);
  }
  console.log(`Applied ${files.length} SQL file(s).`);
} finally {
  await client.end();
}
