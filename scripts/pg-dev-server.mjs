/**
 * A real PostgreSQL for local development — no Docker, no admin rights.
 *
 * `embedded-postgres` unpacks genuine PostgreSQL binaries and runs them against
 * a data directory in the repo (`.pgdata`, gitignored). This is the same engine
 * the integration suite uses, so what passes locally is what passes in CI.
 *
 * The accounting invariants in this system are enforced by Postgres triggers
 * and a deferred constraint trigger. Developing against anything that is not
 * really Postgres would mean developing against a different product.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.PG_DATA_DIR ?? join(repoRoot, '.pgdata');
const port = Number(process.env.PG_PORT ?? 5433);
const database = process.env.PG_DATABASE ?? 'bioassetpro';

const firstRun = !existsSync(dataDir);

const postgres = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
});

if (firstRun) {
  console.log('Initialising a new PostgreSQL data directory…');
  await postgres.initialise();
}

await postgres.start();

if (firstRun) {
  await postgres.createDatabase(database);
}

// `start()` resolves when the process is up, which is a moment before the
// postmaster is accepting connections. Announcing readiness early makes the
// very next command — a push or a seed — fail with "can't reach database
// server", so wait until a real connection actually succeeds.
await waitUntilAcceptingConnections();

console.log(
  `PostgreSQL listening on 127.0.0.1:${port}\n` +
    `  data directory: ${dataDir}\n` +
    `  DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${port}/${database}"\n` +
    `\nNext: npm run db:push && npm run db:seed`,
);

async function waitUntilAcceptingConnections(attempts = 40) {
  const { Client } = await import('pg');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const client = new Client({
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password: 'postgres',
      database,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch {
      await client.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(
    `PostgreSQL started but did not accept a connection on port ${port}.`,
  );
}

const shutdown = async () => {
  console.log('\nStopping PostgreSQL…');
  await postgres.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
