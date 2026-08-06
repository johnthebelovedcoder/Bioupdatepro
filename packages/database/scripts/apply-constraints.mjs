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

const client = new pg.Client({ connectionString: url });
await client.connect();

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
