/**
 * One command to get a working local copy: `npm run setup`.
 *
 * It does what the README's "Getting started" lists, and nothing it would not do by
 * hand: create `.env` with a fresh JWT secret if there is none, generate the
 * database client, start the development PostgreSQL if it is not already up, apply
 * migrations, and load the demo data only into an empty database. Safe to run again
 * after every `git pull`: it never overwrites an existing `.env` and never reseeds a
 * database that already has a company in it.
 *
 * It does not start the apps. Run `npm run dev` afterwards.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const step = (text) => console.log(`\n==> ${text}`);

/* 1. .env ------------------------------------------------------------------ */

step('Checking .env');
if (!existsSync('.env')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example');
}
let envText = readFileSync('.env', 'utf8');
if (!/^JWT_SECRET="?[^"\s]+"?\s*$/m.test(envText)) {
  const secret = randomBytes(48).toString('base64url');
  envText = /^JWT_SECRET=.*$/m.test(envText)
    ? envText.replace(/^JWT_SECRET=.*$/m, `JWT_SECRET="${secret}"`)
    : `${envText.trimEnd()}\nJWT_SECRET="${secret}"\n`;
  writeFileSync('.env', envText);
  console.log('Generated a JWT_SECRET (the API will not start without one).');
} else {
  console.log('.env already has a JWT_SECRET; left as it is.');
}

// Authenticator MFA is required for finance, approval, farm-manager, supervisor and
// administrator roles, and enrolment refuses to start without this 32-byte hex key.
if (!/^MFA_ENCRYPTION_KEY="?[0-9a-fA-F]{64}"?\s*$/m.test(envText)) {
  const key = randomBytes(32).toString('hex');
  envText = /^MFA_ENCRYPTION_KEY=.*$/m.test(envText)
    ? envText.replace(/^MFA_ENCRYPTION_KEY=.*$/m, `MFA_ENCRYPTION_KEY="${key}"`)
    : `${envText.trimEnd()}\nMFA_ENCRYPTION_KEY="${key}"\n`;
  writeFileSync('.env', envText);
  console.log('Generated an MFA_ENCRYPTION_KEY (needed to enrol an authenticator). Keep it: losing it locks enrolled users out.');
}

/** The values in .env, for the child processes that do not read it themselves. */
function readEnv() {
  const values = {};
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*(?:#.*)?$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}
const env = { ...process.env, ...readEnv() };

function run(command, label) {
  step(label);
  const result = spawnSync(command, { stdio: 'inherit', shell: true, env });
  if (result.status !== 0) {
    console.error(`\nSetup stopped: "${command}" failed. Fix that and run \`npm run setup\` again.`);
    process.exit(result.status ?? 1);
  }
}

/* 2. database client ------------------------------------------------------- */

run('npm run db:generate', 'Generating the database client');

/* 3. PostgreSQL ------------------------------------------------------------ */

const port = Number(env.PG_PORT ?? 5433);
const database = env.PG_DATABASE ?? 'bioassetpro';
const { default: pg } = await import('pg');

async function query(sql) {
  const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

async function databaseUp() {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

step('Checking the development database');
if (await databaseUp()) {
  console.log(`PostgreSQL is already accepting connections on :${port}.`);
} else {
  const log = openSync(join(root, '.pgdata.log'), 'a');
  const server = spawn(process.execPath, ['scripts/pg-dev-server.mjs'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env,
  });
  server.unref();
  console.log(`Starting PostgreSQL on :${port} in the background (log: .pgdata.log) …`);
  let up = false;
  for (let attempt = 0; attempt < 90 && !up; attempt += 1) {
    await new Promise((done) => setTimeout(done, 1000));
    up = await databaseUp();
  }
  if (!up) {
    console.error('PostgreSQL did not come up in 90 seconds. See .pgdata.log.');
    process.exit(1);
  }
  console.log('PostgreSQL is up. It keeps running after this script ends; stop it by ending the "node scripts/pg-dev-server.mjs" process.');
}

/* 4. migrations and demo data --------------------------------------------- */

run('npm run db:migrate', 'Applying migrations');

let empty = true;
try {
  empty = Number((await query('SELECT count(*)::int AS n FROM companies')).rows[0].n) === 0;
} catch {
  empty = true;
}

if (empty) {
  run('npm run db:seed', 'Loading the chart of accounts, tax codes and calendar');
  run('npm run db:seed:users', 'Creating one user per approval level');
  run('npm run db:seed:ops', 'Loading illustrative livestock and 30 days of history');
  run('npm run db:seed:trade', 'Loading customers, suppliers, feed and medication items');
} else {
  step('The database already has a company, so demo data is left alone');
}

console.log(`
Done. Start the apps with:

    npm run dev

then open http://localhost:3000 and sign in as cfo@bioassetpro.ng with the password admin123@
(other roles are listed in the README). The API is on :3001.
`);
