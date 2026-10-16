import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The two PoultryPro recording screens sit beside each other and are used by
 * the same people on the same floor: the incubation log and the egg
 * collection/set/hatch endpoints.
 *
 * They drifted. The incubation log had always listed the supervisor roles among
 * its RECORDERS; the egg controller had not, so a production supervisor opening
 * the collection form was told "No active poultry flock" while four flocks were
 * laying — the API refused the request and the web helper turned that refusal
 * into an empty list. This pins the two together so the next person to add a
 * role to one is told about the other.
 */
const src = join(__dirname, '..', '..', 'src', 'poultry-egg');

/*
 * Roles that keep the incubation log but are NOT on the egg endpoints, listed
 * here so the difference is a decision somebody can see rather than an
 * oversight. This is not a claim that the difference is right: whether a QA
 * officer should grade a collection into hatching, table and reject is an open
 * question for the farm, raised by the third walk-through. Granting it is a
 * one-word change here and in the controller.
 */
const NOT_YET_ON_EGGS = new Set(['QA_OFFICER']);

/** The roles on the class-level `@Roles(...)` — the guard every endpoint inherits. */
function classRoles(file: string): Set<string> {
  const text = readFileSync(join(src, file), 'utf8');
  const at = text.indexOf('@Roles(');
  const roles = text.slice(at, text.indexOf(')', at));
  return new Set([...roles.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!));
}

describe('who may record in PoultryPro', () => {
  it('lets the floor roles that keep the incubation log also record an egg collection', () => {
    const log = readFileSync(join(src, 'incubation-log.controller.ts'), 'utf8');
    const recorders = new Set(
      [...log.slice(log.indexOf('const RECORDERS'), log.indexOf(']', log.indexOf('const RECORDERS'))).matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!),
    );
    expect(recorders.size).toBeGreaterThan(0);

    const eggs = classRoles('poultry-egg.controller.ts');
    const missing = [...recorders].filter((role) => !eggs.has(role) && !NOT_YET_ON_EGGS.has(role));
    expect(missing, `roles that keep the incubation log but cannot record a collection: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps both supervisor roles on the egg endpoints', () => {
    const eggs = classRoles('poultry-egg.controller.ts');
    expect(eggs.has('PRODUCTION_SUPERVISOR')).toBe(true);
    expect(eggs.has('POULTRY_SUPERVISOR')).toBe(true);
  });
});
