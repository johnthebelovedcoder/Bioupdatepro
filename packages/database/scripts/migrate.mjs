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
// On Render this runs from the API's start command, not its build: build
// machines are not on the private network, and the database's internal
// hostname cannot be reached from them at all (see render.yaml).

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

/*
 * Retried while the database cannot be reached (P1001). This runs as the API
 * starts, and a free-tier database can still be waking when it does; giving
 * up at once would crash-loop the service over a delay of a few seconds.
 */
let first;
for (let attempt = 1; ; attempt += 1) {
  first = run('prisma', ['migrate', 'deploy'], { allowFailure: true });
  if (first.ok || !first.output.includes('P1001') || attempt >= 6) break;
  const wait = 2000 * 2 ** (attempt - 1);
  console.log(`Database not reachable yet — retrying in ${wait / 1000}s (attempt ${attempt + 1} of 6).`);
  await new Promise((r) => setTimeout(r, wait));
}
if (!first.ok) {
  if (!first.output.includes('P3005')) process.exit(1);
  console.log(`\nExisting schema with no migration history — marking ${BASELINE} as already applied.`);
  run('prisma', ['migrate', 'resolve', '--applied', BASELINE]);
  run('prisma', ['migrate', 'deploy']);
}

run('node', [join(packageDir, 'scripts', 'apply-constraints.mjs')]);
