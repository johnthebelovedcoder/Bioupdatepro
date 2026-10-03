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
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, '..', '..');
const results = { unit: join(here, 'results-unit.json'), integration: join(here, 'results-integration.json') };

if (!process.argv.includes('--score')) {
  for (const [kind, config] of [['unit', 'vitest.unit.config.ts'], ['integration', 'vitest.config.ts']]) {
    // A failed launch must never leave an older passing report in place to be
    // mistaken for evidence from this run.
    rmSync(results[kind], { force: true });
    try {
      execSync(`npx vitest run --config ${config} --reporter=json --outputFile=${results[kind]}`, { cwd: api, stdio: 'inherit' });
    } catch {
      // A failing suite still writes its results; the scoring below says which UAT tests it breaks.
    }
  }
}

/** fullName → status, across both suites. */
const outcomes = new Map();
const suiteStatus = {};
for (const [kind, file] of Object.entries(results)) {
  if (!existsSync(file)) {
    suiteStatus[kind] = 'MISSING';
    continue;
  }
  const run = JSON.parse(readFileSync(file, 'utf8'));
  suiteStatus[kind] = run.success === true ? 'PASS' : 'FAIL';
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

/*
 * The workbook's own check sheets (workbook-checks.json), row by row.
 *
 * A figure row compares a case replay's figure (case-500-snail.json,
 * case-500-poultry.json) with the workbook's: MATCH when equal, EXPLAINED
 * when the difference is exactly the causes named for it, FAIL otherwise. A
 * payroll row reads the payroll replay (case-payroll.json). A tests row needs
 * every named test to have run and passed. WORKBOOK-ONLY rows count the
 * workbook's own rows or sample data; GAP rows are not built yet, with the
 * phase that builds them; MANUAL rows need a person. A replay that did not
 * run leaves its rows MISSING — blank is not a pass.
 */
const checkRegister = JSON.parse(readFileSync(join(here, 'workbook-checks.json'), 'utf8'));
const load = (name) => {
  const file = join(here, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};
const cases = { snail: load('case-500-snail.json'), poultry: load('case-500-poultry.json'), payroll: load('case-payroll.json') };

/** "snail.pbt + poultry.pbt" → kobo (or a count); null when a replay is missing. */
function figure(expression) {
  let total = 0n;
  let sign = 1n;
  for (const token of expression.split(/\s+/)) {
    if (token === '+') sign = 1n;
    else if (token === '-') sign = -1n;
    else {
      const [product, key] = token.split('.');
      const value = cases[product]?.figures?.[key];
      if (value === undefined) return null;
      total += sign * BigInt(value);
    }
  }
  return total;
}
/** A named cause in kobo: a replay's own ("snail.breeders", "-snail.openingStock") or the register's. */
function cause(name) {
  const negative = name.startsWith('-');
  const bare = negative ? name.slice(1) : name;
  const [product, key] = bare.split('.');
  let amount = null;
  if (key !== undefined) amount = cases[product]?.causes?.[key] !== undefined ? BigInt(cases[product].causes[key]) : null;
  else if (checkRegister.causes[bare]) amount = BigInt(Math.round(checkRegister.causes[bare].naira * 100));
  return amount === null ? null : negative ? -amount : amount;
}
const testStatus = (names) => {
  const each = names.map((t) => {
    const matches = [...outcomes.entries()].filter(([name]) => name.includes(t));
    return matches.length === 0 ? 'missing' : matches.every(([, st]) => st === 'passed') ? 'passed' : 'failed';
  });
  return each.includes('failed') ? 'FAIL' : each.includes('missing') ? 'MISSING' : 'PASS';
};
const sheetStatus = (rows) => {
  const st = rows.filter((r) => !r.summary).map((r) => r.status);
  if (st.some((x) => x === 'FAIL')) return 'FAIL';
  if (st.some((x) => x === 'MISSING')) return 'MISSING';
  if (st.some((x) => x === 'GAP' || x === 'PARTIAL')) return 'PARTIAL';
  return 'PASS';
};

const sheets = [];
for (const sheet of checkRegister.sheets) {
  const rows = sheet.rows.map((row) => {
    if (row.summary) return { ...row };
    if (row.workbook) return { ...row, status: 'WORKBOOK-ONLY', detail: row.workbook };
    if (row.gap) return { ...row, status: 'GAP', detail: `Phase ${row.phase}: ${row.gap}` };
    if (row.manual) return { ...row, status: 'MANUAL', detail: row.manual };
    if (row.tests) return { ...row, status: testStatus(row.tests), detail: row.tests.join('; ') };
    if (row.sheet) {
      const other = sheets.find((s) => s.sheet === row.sheet);
      return { ...row, status: other ? (other.status === 'PARTIAL' ? 'PASS' : other.status) : 'MISSING', detail: `${row.sheet}: ${other?.status ?? 'not scored'}` };
    }
    if (row.payroll) {
      const [group, key] = [row.payroll.slice(0, row.payroll.indexOf('.')), row.payroll.slice(row.payroll.indexOf('.') + 1)];
      const hit = cases.payroll?.[group]?.[key];
      if (!hit) return { ...row, status: 'MISSING' };
      return { ...row, workbook: BigInt(hit.expected), application: BigInt(hit.application), status: hit.expected === hit.application ? 'MATCH' : 'FAIL', money: !/employees|IDs|records|present|complete|active|approved|events|pass/i.test(key) };
    }
    const application = figure(row.figure);
    if (application === null) return { ...row, status: 'MISSING' };
    const workbook = row.unit === 'count' ? BigInt(row.expected) : BigInt(Math.round(row.expected * 100));
    const difference = application - workbook;
    const named = (row.causes ?? []).map((c) => [c, cause(c)]);
    const explained = named.reduce((sum, [, a]) => sum + (a ?? 0n), 0n);
    const status = difference === 0n ? 'MATCH' : named.length > 0 && named.every(([, a]) => a !== null) && difference === explained ? 'EXPLAINED' : 'FAIL';
    return { ...row, workbook, application, difference, status, money: row.unit !== 'count', named: named.filter(([, a]) => a) };
  });
  const status = sheetStatus(rows);
  for (const row of rows) if (row.summary) row.status = status === 'PARTIAL' ? 'PASS' : status;
  sheets.push({ sheet: sheet.sheet, status, rows });
}

const naira = (k) => `₦${(Number(k) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shown = (row, v) => (v === undefined ? '' : row.money === false ? v.toLocaleString('en-NG') : naira(v));
const allRows = sheets.flatMap((s) => s.rows);
const tally = allRows.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] ?? 0) + 1 }), {});
const checksPass = !allRows.some((r) => r.status === 'FAIL' || r.status === 'MISSING');
writeFileSync(
  join(here, 'workbook-checks-report.md'),
  [
    '# Workbook check sheets — scored against the application',
    '',
    `Run ${new Date().toISOString()}. ${allRows.length} checks in ${sheets.length} sheets: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}.`,
    '',
    'MATCH / EXPLAINED: a case replay’s figure equals the workbook’s, or differs by exactly its named causes (see each case’s report). PASS: the named tests ran and passed. WORKBOOK-ONLY: counts the workbook’s own rows or sample data, which says nothing about the application. GAP: not built yet — the phase that builds it is named. MANUAL: a person must do it. A sheet is PARTIAL while it has a gap.',
    '',
    '| Sheet | Status |',
    '|---|---|',
    ...sheets.map((s) => `| ${s.sheet} | **${s.status}** |`),
    '',
    ...sheets.flatMap((s) => [
      `## ${s.sheet} — ${s.status}`,
      '',
      '| Check | Workbook | Application | Difference | Status | Evidence |',
      '|---|---|---|---|---|---|',
      ...s.rows.map(
        (r) =>
          `| ${r.check} | ${shown(r, r.workbook)} | ${shown(r, r.application)} | ${r.difference ? shown(r, r.difference) : ''} | **${r.status}** | ${
            r.named?.length ? r.named.map(([c, a]) => `${c} ${naira(a)}`).join('; ') : (r.detail ?? '')
          }${r.note ? ` _${r.note}_` : ''} |`,
      ),
      '',
    ]),
    '## Causes named by this register',
    '',
    ...Object.entries(checkRegister.causes).map(([k, c]) => `- **${k}** — ${c.why}`),
  ].join('\n'),
);
const checkSummary = [
  '## Workbook check sheets',
  '',
  `${allRows.length} checks in ${sheets.length} sheets: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}. Row by row in workbook-checks-report.md.`,
  '',
  '| Sheet | Status |',
  '|---|---|',
  ...sheets.map((s) => `| ${s.sheet} | **${s.status}** |`),
];

const counts = scored.reduce((c, u) => ({ ...c, [u.status]: (c[u.status] ?? 0) + 1 }), {});
const suitesPassed = Object.values(suiteStatus).every((status) => status === 'PASS');
const suiteSummary = `Suites: ${Object.entries(suiteStatus).map(([name, status]) => `${name} ${status}`).join(', ')}.`;
const lines = [
  '# UAT evidence — UAT_CONTROL_REGISTER',
  '',
  `Run ${new Date().toISOString()}. ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')} of ${scored.length}.`,
  '',
  suiteSummary,
  '',
  '| Test | Process | Status | Evidence |',
  '|---|---|---|---|',
  ...scored.map(
    (u) =>
      `| ${u.id} | ${u.title} | **${u.status}** | ${u.evidence.map((e) => `${e.kind === 'negative' ? '✗ ' : ''}${e.test} (${e.status})`).join('<br>')}${u.manual ? `<br>_Manual:_ ${u.manual}` : ''} |`,
  ),
  '',
  '✗ marks the negative / integrity test. PASS + MANUAL: automated evidence passes; the manual step named must still be observed and signed.',
  '',
  ...checkSummary,
];
writeFileSync(join(here, 'uat-report.md'), lines.join('\n'));
writeFileSync(join(here, 'uat-report.json'), JSON.stringify(scored, null, 2));
console.log(lines.slice(0, 3).join('\n'));
console.log(suiteSummary);
for (const u of scored) console.log(`${u.id.padEnd(8)} ${u.status.padEnd(14)} ${u.title}`);
for (const sheet of sheets) console.log(`SHEET    ${sheet.status.padEnd(14)} ${sheet.sheet}`);
process.exit(suitesPassed && scored.every((u) => u.status.startsWith('PASS')) && checksPass ? 0 : 1);
