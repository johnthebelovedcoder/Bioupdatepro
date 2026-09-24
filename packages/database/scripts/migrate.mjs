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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
 * On Render a starting instance cannot reach the database over the private
 * network until it is serving — seen in production: two minutes of P1001
 * from the start command while the already-running API queried the same
 * database without trouble. So on Render this is only a first attempt: if
 * the database is unreachable it says so and exits cleanly, and the API runs
 * this same script again once it is listening (apps/api/src/main.ts).
 * Everywhere else (local, CI, tests) unreachable is an error, retried a few
 * times for a database that is still starting.
 */
const onRender = process.env.RENDER === 'true';
const deferIfUnreachable = onRender && process.env.MIGRATE_FROM_API !== '1';
const attempts = deferIfUnreachable ? 2 : 6;
let first;
for (let attempt = 1; ; attempt += 1) {
  first = run('prisma', ['migrate', 'deploy'], { allowFailure: true });
  if (first.ok || !first.output.includes('P1001') || attempt >= attempts) break;
  const wait = 2000 * 2 ** (attempt - 1);
  console.log(`Database not reachable yet — retrying in ${wait / 1000}s (attempt ${attempt + 1} of ${attempts}).`);
  await new Promise((r) => setTimeout(r, wait));
}
if (!first.ok && first.output.includes('P1001') && deferIfUnreachable) {
  console.log(
    '\nDatabase not reachable before the service is live — migrations will run from the ' +
      'API once it is listening. Continuing to start.',
  );
  process.exit(0);
}
if (!first.ok) {
  if (!first.output.includes('P3005')) process.exit(1);
  /*
   * A database built by `db push` from a LATER schema than the baseline —
   * production on Neon was pushed up to date before migrations existed — is
   * already past some migrations too, and running them fails on tables that
   * exist. If it matches the current schema exactly, every migration is
   * already in it; otherwise only the baseline is.
   */
  const diff = run(
    'prisma',
    // --from-schema-datasource reads DATABASE_URL itself, so the URL never
    // passes through a shell (on Windows it would split at its `&`).
    ['migrate', 'diff', '--from-schema-datasource', 'prisma/schema.prisma', '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code'],
    { allowFailure: true },
  );
  const upToDate = diff.ok;
  const toMark = upToDate
    ? readdirSync(join(packageDir, 'prisma', 'migrations'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [BASELINE];
  console.log(
    `\nExisting schema with no migration history — marking ${toMark.join(', ')} as already applied` +
      (upToDate ? ' (it already matches the current schema).' : '.'),
  );
  for (const name of toMark) run('prisma', ['migrate', 'resolve', '--applied', name]);
  run('prisma', ['migrate', 'deploy']);
}

run('node', [join(packageDir, 'scripts', 'apply-constraints.mjs')]);
