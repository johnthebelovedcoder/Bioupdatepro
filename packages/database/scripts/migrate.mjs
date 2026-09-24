// Bring a database up to the current schema with Prisma migrations, then
// apply the SQL invariants (constraints and immutability triggers) on top.
//
// This replaces `push.mjs` for deploys (2026-09-24). `db push
// --accept-data-loss` applied whatever the schema said with nothing between a
// wrong schema change and the production data; a migration is a reviewed file,
// applied once, in order, and recorded.
//
// The first run against a database that was built by `db push` — production,
// and any existing dev database — finds tables but no migration history. That
// database already IS the baseline, so the baseline is marked applied, never
// executed (executing it would fail on "relation already exists"). Every later
// migration then applies normally. A brand-new database gets the baseline run
// like any other migration.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageDir, '..', '..');
const BASELINE = '0000_baseline';

if (!process.env.DATABASE_URL) {
  const envPath = join(repoRoot, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set and no .env was found at the repo root.');
  process.exit(1);
}

const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: packageDir,
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let builtByPush = false;
try {
  const exists = async (table) =>
    (await client.query('SELECT to_regclass($1) AS t', [`public.${table}`])).rows[0].t !== null;
  const hasHistory = await exists('_prisma_migrations');
  const hasSchema = await exists('companies');
  builtByPush = hasSchema && !hasHistory;
} finally {
  await client.end();
}

if (builtByPush) {
  console.log(`Existing schema with no migration history — marking ${BASELINE} as already applied.`);
  run('prisma', ['migrate', 'resolve', '--applied', BASELINE]);
}

run('prisma', ['migrate', 'deploy']);
run('node', [join(packageDir, 'scripts', 'apply-constraints.mjs')]);
