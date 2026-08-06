import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

/**
 * Brings up a real PostgreSQL for the integration suite.
 *
 * Phase 1's guarantees live partly in the database — the immutability triggers,
 * the single-side CHECK constraint, and the deferred balance assertion. A
 * mocked or SQLite-backed suite would report green while testing none of them,
 * which for a financial system is worse than having no suite at all.
 *
 * This uses `embedded-postgres`, which unpacks genuine PostgreSQL binaries and
 * runs them on a scratch data directory — no Docker and no administrator
 * rights. (An earlier attempt used PGlite, Postgres compiled to WASM. It runs
 * fine until a trigger raises an exception, at which point the WASM build dies
 * with "cannot resolve symbol setTempRet0". Since this suite deliberately
 * provokes Postgres exceptions to prove the immutability rules, PGlite is
 * exactly the wrong tool here.)
 *
 * If DATABASE_URL is already set we use that server and leave it alone, so CI
 * against a managed Postgres needs no changes.
 */

let postgres: EmbeddedPostgres | undefined;
let dataDir: string | undefined;

export async function setup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    const port = Number(process.env.TEST_PG_PORT ?? 54329);
    dataDir = mkdtempSync(join(tmpdir(), 'bap-pg-'));

    postgres = new EmbeddedPostgres({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port,
      // `persistent: false` would have embedded-postgres delete the data
      // directory on stop. On Windows that races the server's own file handles
      // and throws EBUSY, failing the run after every test has already passed.
      // We keep the directory and remove it ourselves, with retries.
      persistent: true,
    });

    await postgres.initialise();
    await postgres.start();
    await postgres.createDatabase('bioassetpro_test');

    process.env.DATABASE_URL =
      `postgresql://postgres:postgres@127.0.0.1:${port}/bioassetpro_test`;
    console.log(`\n[test] PostgreSQL started on 127.0.0.1:${port}`);
  }

  // Push the schema, then apply the SQL invariants on top.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  await new Promise<void>((resolvePush, rejectPush) => {
    const child = spawn('npm', ['run', 'push', '-w', '@bioassetpro/database'], {
      stdio: 'inherit',
      env: { ...process.env },
      cwd: repoRoot,
      shell: process.platform === 'win32',
    });
    child.on('error', rejectPush);
    child.on('exit', (code) =>
      code === 0
        ? resolvePush()
        : rejectPush(new Error(`Schema push failed with exit code ${code}`)),
    );
  });
}

export async function teardown(): Promise<void> {
  await postgres?.stop();
  if (!dataDir) return;

  // Windows releases the server's file handles a moment after the process
  // exits. Retry briefly, then give up — a stray scratch directory under the
  // system temp folder is never worth failing a green test run over.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
