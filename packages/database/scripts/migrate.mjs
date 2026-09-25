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
// On Render this runs from the API's start command (see render.yaml).

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

/*
 * Migrations need a DIRECT connection. `migrate deploy` holds a Postgres
 * advisory lock for the whole run, and a transaction-mode pooler (Neon's
 * `-pooler` host, PgBouncer) cannot keep one — production timed out on it
 * (P1002, 2026-09-24). DIRECT_URL wins if set; otherwise a Neon pooled host is
 * turned into its direct host, which is the same name without `-pooler`. The
 * API itself keeps using the pooled URL.
 */
const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL.replace(/(ep-[a-z0-9-]+?)-pooler\./, '$1.');
if (directUrl !== process.env.DATABASE_URL) {
  console.log('Using the direct (unpooled) connection for migrations.');
  process.env.DATABASE_URL = directUrl;
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
 * A database that is still waking (Neon suspends when idle) or another
 * instance holding the migration lock is worth waiting for: retried with
 * backoff for about a minute. Anything else, or still unreachable after
 * that, fails the run — on Render that fails the deploy, and the previous
 * version keeps serving on the schema it was built for, which is the point.
 *
 * (Until 2026-09-25 a failure here on Render was waved through and retried
 * from inside the running API, on the theory that a starting Render
 * instance could not reach the database. The real cause was DATABASE_URL
 * pointing at an unused Render Postgres; with the database on Neon that
 * workaround only meant new code could start on an old schema.)
 */
/** Unreachable (P1001) or reached but timed out, e.g. on the migration lock (P1002). */
const transient = (output) => output.includes('P1001') || output.includes('P1002');
const attempts = 6;
let first;
for (let attempt = 1; ; attempt += 1) {
  first = run('prisma', ['migrate', 'deploy'], { allowFailure: true });
  if (first.ok || !transient(first.output) || attempt >= attempts) break;
  const wait = 2000 * 2 ** (attempt - 1);
  console.log(`Database not reachable yet — retrying in ${wait / 1000}s (attempt ${attempt + 1} of ${attempts}).`);
  await new Promise((r) => setTimeout(r, wait));
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
