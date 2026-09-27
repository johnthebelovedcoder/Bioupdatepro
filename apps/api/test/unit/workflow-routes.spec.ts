import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every document type the application submits for approval has a route when
 * a farm signs up. A type with no route is refused outright ("must not bypass
 * approval"), so a missing one silently disables that part of the product for
 * every new farm — as payroll payments were until the 40-step rehearsal ran.
 */
const src = join(__dirname, '..', '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('approval routes at sign-up', () => {
  it('cover every transaction type the application submits', () => {
    const provisioning = readFileSync(join(src, 'auth', 'provisioning.service.ts'), 'utf8');
    const block = provisioning.slice(provisioning.indexOf('const WORKFLOW_TYPES'), provisioning.indexOf('];', provisioning.indexOf('const WORKFLOW_TYPES')));
    const routed = new Set([...block.matchAll(/type: '([A-Z_]+)'/g)].map((m) => m[1]));

    const submitted = new Set<string>();
    for (const file of files(src)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/transactionType: '([A-Z_]+)'/g)) submitted.add(m[1]!);
    }
    // Types submitted through a constant or a journal type's own setting are covered by the routes those reach.
    expect(submitted.size).toBeGreaterThan(10);
    expect([...submitted].filter((type) => !routed.has(type)).sort()).toEqual([]);
  });
});
