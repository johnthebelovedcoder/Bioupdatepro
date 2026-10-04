import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CROSSWALK, crosswalkTargets, APPROVED_PRODUCT_CLASSES, APPROVED_STOCK_ACCOUNTS, proposeStockClass } from '../../src/chart/approved-crosswalk';
import { ROLE_ACCOUNTS } from '../../src/chart/chart';
import { allocate } from '../../src/chart/approved-cutover.service';

/**
 * The cutover's account crosswalk against the approved workbook's account
 * master, the chart role map the app posts through, and the review CSV.
 */
const workbook = JSON.parse(
  readFileSync(join(__dirname, '../../../../packages/database/src/approved-posting-engine.json'), 'utf8'),
) as { sheets: { accounts: Array<{ 'GL Code': string; Status: string }> } };
const active = new Set(workbook.sheets.accounts.filter((a) => a.Status === 'Active').map((a) => a['GL Code']));

describe('approved-chart crosswalk', () => {
  it('names only accounts that are active on the approved chart', () => {
    const missing = crosswalkTargets().filter((n) => !active.has(n));
    expect(missing).toEqual([]);
  });

  it('agrees with the role map the app posts through, for every role that has an approved account', () => {
    for (const [role, [legacy, spec, approved]] of Object.entries(ROLE_ACCOUNTS)) {
      if (!approved) {
        // No workbook account: the cutover refuses while the old account holds a balance.
        for (const old of [legacy, spec]) expect(CROSSWALK[old], `${role} ${old}`).toMatchObject({ kind: 'blocked' });
        continue;
      }
      for (const old of [legacy, spec]) {
        const rule = CROSSWALK[old];
        expect(rule, `${role} ${old}`).toBeDefined();
        if (rule!.kind === 'one' || rule!.kind === 'pick') {
          // Where the role has one approved account the balance goes there; a choice must offer it.
          if (rule!.kind === 'one') expect(rule!.to, `${role} ${old}`).toBe(approved);
          else expect([rule!.to, ...rule!.alternatives], `${role} ${old}`).toContain(approved);
        }
      }
    }
  });

  it('sends each recommended single account in the review CSV to that account, where the app has no reason to differ', () => {
    const csv = readFileSync(join(__dirname, '../../../../docs/approved-coa-crosswalk-review.csv'), 'utf8').trim().split('\n').slice(1);
    // Where the app posts a purpose to a different approved account than the crosswalk recommends, or the
    // role map decides (payroll, the egg flow), the difference is documented in target-coa-decision.md.
    const differs = new Set(['130215', '130216', '620100', '620200', '620300', '224100', '690100']);
    let checked = 0;
    for (const line of csv) {
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''));
      const source = cells[0]!;
      const recommended = cells[8]!;
      const rule = CROSSWALK[source];
      expect(rule, `${source} has no rule`).toBeDefined();
      if (differs.has(source) || (rule!.kind !== 'one' && rule!.kind !== 'pick')) continue;
      if (/^\d{5}$/.test(recommended.trim())) {
        expect(rule!.to, source).toBe(recommended.trim());
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('has an account for every product class, and keeps the egg accounts the egg module posts to', () => {
    expect(APPROVED_PRODUCT_CLASSES.EGGS).toMatchObject({ revenue: '40330', costOfSales: '50330', inventory: '12420' });
    for (const c of Object.values(APPROVED_PRODUCT_CLASSES)) for (const n of [c.revenue, c.costOfSales, c.inventory]) expect(active.has(n), n).toBe(true);
    expect(Object.values(APPROVED_STOCK_ACCOUNTS).every((n) => active.has(n))).toBe(true);
  });

  it('classes stock by what the item is', () => {
    expect(proposeStockClass('Grower mash', 'FEED', true)).toBe('FEED');
    expect(proposeStockClass('Egg cartons')).toBe('PACKAGING');
    expect(proposeStockClass('Disinfectant')).toBe('CONSUMABLE');
    expect(proposeStockClass('Maize')).toBe('RAW');
  });
});

describe('allocate', () => {
  it('shares to the kobo by weight, largest remainder first, and keeps the sign', () => {
    const parts = allocate(100n, [{ account: 'A', weight: 1n }, { account: 'B', weight: 1n }, { account: 'C', weight: 1n }]);
    expect(parts.reduce((s, p) => s + p.amount, 0n)).toBe(100n);
    expect(allocate(-100n, [{ account: 'A', weight: 1n }, { account: 'B', weight: 3n }])).toEqual([
      { account: 'A', amount: -25n },
      { account: 'B', amount: -75n },
    ]);
  });
});
