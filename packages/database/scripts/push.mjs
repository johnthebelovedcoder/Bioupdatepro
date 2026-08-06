// Push the Prisma schema, then apply the SQL invariants on top.
//
// npm workspace scripts run with the package as cwd, so Prisma does not see the
// repo-root .env. Rather than duplicating the connection string into every
// package, this resolves the root .env once and passes it down. DATABASE_URL
// already in the environment always wins, so CI needs no .env at all.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageDir, '..', '..');

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
  console.error(
    'DATABASE_URL is not set and no .env was found at the repo root.\n' +
      'Start a database with `npm run db:start`, or export DATABASE_URL yourself.',
  );
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

run('prisma', ['db', 'push', '--skip-generate']);
run('node', [join(packageDir, 'scripts', 'apply-constraints.mjs')]);
