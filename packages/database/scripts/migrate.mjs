// Bring a database up to the current schema with Prisma migrations, then
// apply the SQL invariants (constraints and immutability triggers) on top.
//
// This replaces `push.mjs` for deploys (2026-09-24). `db push
// --accept-data-loss` applied whatever the schema said with nothing between a
// wrong schema change and the production data; a migration is a reviewed file,
// applied once, in order, and recorded.
//
// The first run against a database that was built by `db push` — production,
// and any existing dev database — finds tables but no migration history, and
// Prisma refuses with P3005 ("the database schema is not empty"). That
// database already IS the baseline, so the baseline is marked applied, never
// executed, and deploy runs again. A brand-new database gets the baseline run
// like any other migration.
//
// Everything here goes through Prisma, deliberately: the first version of this
// script checked for migration history with its own `pg` connection first,
// and on Render's build machine that lookup of the database's internal
// hostname failed (ENOTFOUND) where Prisma's own connection succeeds.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Run a command, echo its output, and hand back what it printed. */
const run = (command, args, { allowFailure = false } = {}) => {
  const result = spawnSync(command, args, {
    cwd: packageDir,
    env: process.env,
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  if (result.status !== 0 && !allowFailure) process.exit(result.status ?? 1);
  return { ok: result.status === 0, output };
};

const first = run('prisma', ['migrate', 'deploy'], { allowFailure: true });
if (!first.ok) {
  if (!first.output.includes('P3005')) process.exit(1);
  console.log(`\nExisting schema with no migration history — marking ${BASELINE} as already applied.`);
  run('prisma', ['migrate', 'resolve', '--applied', BASELINE]);
  run('prisma', ['migrate', 'deploy']);
}

run('node', [join(packageDir, 'scripts', 'apply-constraints.mjs')]);
