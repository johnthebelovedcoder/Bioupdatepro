#!/usr/bin/env node
/**
 * The UAT evidence run (UAT_CONTROL_REGISTER, UAT_RELEASE_SIGNOFF).
 *
 * Runs the unit and integration suites with a JSON reporter, then scores each
 * of the 26 consolidated UAT tests in register.json against the automated
 * tests that evidence it — its positive path AND its negative/integrity test.
 * A UAT test PASSES only when every evidencing test ran and passed; one with
 * no evidence is MISSING, never a pass ("blank application values are not a
 * pass").
 *
 * Writes uat-report.md (human) and uat-report.json (machine) next to this
 * file and exits non-zero unless all 26 pass, so CI blocks release on it.
 *
 *   node test/uat/run-uat.mjs            run the suites, then score
 *   node test/uat/run-uat.mjs --score    score existing results only
 *
 * What automation cannot evidence is said so in the register (manual: true)
 * and reported as MANUAL — the observed user test UX_ACCEPTANCE requires, for
 * one — so the report never claims more than the machine proved.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, '..', '..');
const results = { unit: join(here, 'results-unit.json'), integration: join(here, 'results-integration.json') };

if (!process.argv.includes('--score')) {
  for (const [kind, config] of [['unit', 'vitest.unit.config.ts'], ['integration', 'vitest.config.ts']]) {
    try {
      execSync(`npx vitest run --config ${config} --reporter=json --outputFile=${results[kind]}`, { cwd: api, stdio: 'inherit' });
    } catch {
      // A failing suite still writes its results; the scoring below says which UAT tests it breaks.
    }
  }
}

/** fullName → status, across both suites. */
const outcomes = new Map();
for (const file of Object.values(results)) {
  if (!existsSync(file)) continue;
  const run = JSON.parse(readFileSync(file, 'utf8'));
  for (const suite of run.testResults ?? []) {
    for (const test of suite.assertionResults ?? []) {
      const name = [...(test.ancestorTitles ?? []), test.title].join(' > ');
      outcomes.set(name, test.status);
    }
  }
}

const register = JSON.parse(readFileSync(join(here, 'register.json'), 'utf8'));
const scored = register.map((uat) => {
  const evidence = [...uat.positive.map((t) => ({ kind: 'positive', t })), ...uat.negative.map((t) => ({ kind: 'negative', t }))].map(
    ({ kind, t }) => {
      const matches = [...outcomes.entries()].filter(([name]) => name.includes(t));
      const status = matches.length === 0 ? 'missing' : matches.every(([, s]) => s === 'passed') ? 'passed' : 'failed';
      return { kind, test: t, status, matched: matches.length };
    },
  );
  const hasPositive = evidence.some((e) => e.kind === 'positive');
  const hasNegative = evidence.some((e) => e.kind === 'negative');
  let status;
  if (evidence.some((e) => e.status === 'failed')) status = 'FAIL';
  else if (!hasPositive || !hasNegative || evidence.some((e) => e.status === 'missing')) status = 'MISSING';
  else status = 'PASS';
  if (status === 'PASS' && uat.manual) status = 'PASS + MANUAL';
  return { ...uat, status, evidence };
});

const counts = scored.reduce((c, u) => ({ ...c, [u.status]: (c[u.status] ?? 0) + 1 }), {});
const lines = [
  '# UAT evidence — UAT_CONTROL_REGISTER',
  '',
  `Run ${new Date().toISOString()}. ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')} of ${scored.length}.`,
  '',
  '| Test | Process | Status | Evidence |',
  '|---|---|---|---|',
  ...scored.map(
    (u) =>
      `| ${u.id} | ${u.title} | **${u.status}** | ${u.evidence.map((e) => `${e.kind === 'negative' ? '✗ ' : ''}${e.test} (${e.status})`).join('<br>')}${u.manual ? `<br>_Manual:_ ${u.manual}` : ''} |`,
  ),
  '',
  '✗ marks the negative / integrity test. PASS + MANUAL: automated evidence passes; the manual step named must still be observed and signed.',
];
writeFileSync(join(here, 'uat-report.md'), lines.join('\n'));
writeFileSync(join(here, 'uat-report.json'), JSON.stringify(scored, null, 2));
console.log(lines.slice(0, 3).join('\n'));
for (const u of scored) console.log(`${u.id.padEnd(8)} ${u.status.padEnd(14)} ${u.title}`);
process.exit(scored.every((u) => u.status.startsWith('PASS')) ? 0 : 1);
