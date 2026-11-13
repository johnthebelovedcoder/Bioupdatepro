import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const prismaCli = join(dirname(require.resolve('prisma/package.json')), 'build', 'index.js');

// Prisma config requires a datasource URL even though client generation never
// connects to it. Do not require or load a real database secret during builds.
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@127.0.0.1:5432/bioassetpro_codegen';

const result = spawnSync(process.execPath, [prismaCli, 'generate'], {
  cwd: packageDir,
  env: process.env,
  stdio: 'inherit',
});

if (result.status !== 0) process.exit(result.status ?? 1);
