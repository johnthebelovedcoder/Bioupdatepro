import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageDir, '..', '..');
const require = createRequire(import.meta.url);
const prismaCli = join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');

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

const result = spawnSync(process.execPath, [prismaCli, 'generate'], {
  cwd: packageDir,
  env: process.env,
  stdio: 'inherit',
});

if (result.status !== 0) process.exit(result.status ?? 1);
