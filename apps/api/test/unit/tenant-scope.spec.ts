import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { companyScopedModels, scan } from './tenant-scope';

/**
 * Every query over a company-owned table either names the company, or is on
 * the reviewed list below with the reason it is safe.
 *
 * A new query that does neither fails this test. That is the point: the
 * approval notifications that reached another farm's staff (2026-09-25), and
 * the order and journal lines that could name another company's item or
 * account, were each one missing `companyId` that nothing checked.
 *
 * When this fails:
 *   - Add \`companyId\` to the query's where-clause (almost always the fix), or
 *   - if it is genuinely safe — its ids come from rows already scoped to the
 *     company, or the route's OwnedRecord guard has already checked the
 *     parent — add it to tenant-scope.allowlist.json with that reason.
 * Set UPDATE_TENANT_ALLOWLIST=1 to print the entries to paste in.
 */

const root = join(__dirname, '..', '..');
const allowlistPath = join(__dirname, 'tenant-scope.allowlist.json');

interface AllowEntry {
  key: string;
  reason: string;
}

describe('Tenant isolation — every company-owned query names its company', () => {
  const models = companyScopedModels(join(root, '..', '..', 'packages', 'database', 'prisma', 'schema.prisma'));
  const findings = scan(join(root, 'src'), models);
  const allowlist: AllowEntry[] = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  const allowed = new Set(allowlist.map((e) => e.key));

  it('finds the company-owned models in the schema', () => {
    // A guard against the scanner silently scanning nothing.
    expect(models.size).toBeGreaterThan(50);
    expect(models.has('journalLine')).toBe(true);
  });

  it('has no unreviewed query that reads across companies', () => {
    const unreviewed = findings.filter((f) => !allowed.has(f.key));
    if (process.env.UPDATE_TENANT_ALLOWLIST) {
      writeFileSync(
        join(__dirname, 'tenant-scope.unreviewed.json'),
        JSON.stringify(unreviewed.map((f) => ({ key: f.key, reason: 'TODO — why is this safe?' })), null, 2),
      );
    }
    expect(
      unreviewed.map((f) => `${f.file}:${f.line} ${f.model}.${f.operation} has no companyId`),
    ).toEqual([]);
  });

  it('keeps every reviewed entry honest', () => {
    const present = new Set(findings.map((f) => f.key));
    // An entry whose query has changed or gone must be re-reviewed, not kept.
    expect(allowlist.filter((e) => !present.has(e.key)).map((e) => e.key)).toEqual([]);
    expect(allowlist.filter((e) => !e.reason || e.reason.startsWith('TODO')).map((e) => e.key)).toEqual([]);
  });
});
