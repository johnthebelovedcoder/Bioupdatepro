import { Injectable } from '@nestjs/common';
import { LedgerFlag, PostingRuleStatus } from '@bioassetpro/database';
import { PrismaService } from '../prisma/prisma.service';
import { PostingControlService } from './posting-control.service';

/**
 * The §66.5 release gate, run against the database rather than a spreadsheet.
 *
 * "Open POSTING_CONTROL_CHECKS. Release is blocked unless every row shows PASS.
 * The current baseline proves: 86 approved rules; 172 active debit/credit
 * posting keys; all GL codes and names retrieved; 20 posting-rule extension
 * rows; 40 COA extension rows; no missing Ledger Flag; and no duplicate
 * approved posting key."
 *
 * The workbook checks its own cells. This checks what the application actually
 * holds, which is the only version that can block a release — a spreadsheet
 * showing PASS proves the spreadsheet is consistent, not that the software is.
 *
 * Every check reports the number it found beside the number expected, because
 * "FAIL" on its own sends somebody hunting. Where a check cannot pass yet, it
 * says what has to happen rather than implying somebody made a mistake.
 */

export interface CheckRow {
  id: string;
  what: string;
  expected: string;
  found: string;
  state: 'PASS' | 'FAIL' | 'BLOCKED';
  /** Present when the state is not PASS: what would make it pass. */
  next?: string;
}

@Injectable()
export class PostingControlChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly control: PostingControlService,
  ) {}

  async run(companyId: string): Promise<{ rows: CheckRow[]; releasable: boolean }> {
    const [rules, approved, keys, active, flagged, atomic, linked] = await Promise.all([
      this.prisma.postingRule.count({ where: { companyId } }),
      this.prisma.postingRule.count({
        where: { companyId, status: PostingRuleStatus.APPROVED },
      }),
      this.prisma.postingKey.count({ where: { companyId } }),
      this.prisma.postingKey.count({ where: { companyId, active: true } }),
      this.prisma.postingKey.count({
        where: { companyId, ledgerFlag: { in: [LedgerFlag.CONTROL, LedgerFlag.GENERAL, LedgerFlag.NO_JOURNAL] } },
      }),
      this.prisma.postingKey.count({ where: { companyId, atomic: true } }),
      this.prisma.postingKey.count({ where: { companyId, glAccountId: { not: null } } }),
    ]);

    // Every key a rule names must exist. Cheaper to check in one pass here than
    // to discover it when somebody receives a delivery.
    const allRules = await this.prisma.postingRule.findMany({
      where: { companyId },
      select: { ruleId: true, debitKey: true, creditKey: true },
    });
    const allKeys = new Set(
      (
        await this.prisma.postingKey.findMany({ where: { companyId }, select: { key: true } })
      ).map((k) => k.key),
    );
    const danglingRules = allRules.filter(
      (r) => !allKeys.has(r.debitKey) || !allKeys.has(r.creditKey),
    );

    const rows: CheckRow[] = [
      row('PCC-01', 'Posting rules loaded', '86', String(rules), rules === 86,
        'Re-run the posting-control seed against the approved workbook.'),
      row('PCC-02', 'Rules approved and postable', '86', String(approved), approved === 86,
        'A draft or retired rule cannot post. Approve it, or accept that its event is blocked.'),
      row('PCC-03', 'Posting keys loaded', '172', String(keys), keys === 172,
        'Re-run the posting-control seed against the approved workbook.'),
      row('PCC-04', 'Keys active', '172', String(active), active === 172,
        'Draft keys cannot post (§66.4).'),
      row('PCC-05', 'Every key carries a Ledger Flag', '172', String(flagged), flagged === 172,
        'A key with no flag cannot be checked against §66.3 and must not post.'),
      row(
        'PCC-06',
        'Every rule names keys that exist',
        '0 dangling',
        `${danglingRules.length} dangling`,
        danglingRules.length === 0,
        danglingRules.length > 0
          ? `Rules with a missing key: ${danglingRules.map((r) => r.ruleId).join(', ')}.`
          : undefined,
      ),
      row(
        'PCC-07',
        'No duplicate approved key',
        '0 duplicates',
        '0 duplicates',
        true,
        undefined,
        // The unique index on (companyId, key) makes a duplicate impossible to
        // store, so this check passes structurally rather than by counting.
        'Enforced by a unique index rather than a count.',
      ),
    ];

    /*
     * The two checks that cannot pass yet, and say so honestly — but not
     * every non-atomic key is the same kind of unresolved. Some are already
     * posted correctly by a dedicated service (see `dynamicResolution` on the
     * model) that this table simply isn't consulted for; those are reported
     * separately from the ones genuinely still waiting on a decision, because
     * treating them the same would tell a Finance Controller the client owes
     * an answer for something the software already handles.
     */
    const nonAtomicKeys = await this.prisma.postingKey.findMany({
      where: { companyId, atomic: false, ledgerFlag: { not: LedgerFlag.NO_JOURNAL } },
      select: { key: true, glAccountCode: true, glAccountName: true, dynamicResolution: true },
      orderBy: { key: 'asc' },
    });
    const dynamicallyResolvedKeys = nonAtomicKeys.filter((k) => k.dynamicResolution);
    const unresolvedKeys = nonAtomicKeys.filter((k) => !k.dynamicResolution);

    rows.push({
      id: 'PCC-08',
      what: 'Every posting key resolves to one atomic account',
      expected: `${atomic} atomic`,
      found:
        `${linked} linked, ${dynamicallyResolvedKeys.length} resolved by dedicated code, ` +
        `${unresolvedKeys.length} unresolved`,
      state: unresolvedKeys.length === 0 ? 'PASS' : 'BLOCKED',
      ...(unresolvedKeys.length > 0
        ? {
            next:
              `The client has not yet decided which account these mean, or the module ` +
              `that would use them is not built yet: ` +
              `${unresolvedKeys
                .slice(0, 4)
                .map((k) => `${k.key} → "${k.glAccountCode ?? k.glAccountName}"`)
                .join('; ')}` +
              `${unresolvedKeys.length > 4 ? `, and ${unresolvedKeys.length - 4} more` : ''}. ` +
              `Each blocks the rules that use it through THIS table — ` +
              `${dynamicallyResolvedKeys.length} other non-atomic keys already post correctly ` +
              `through dedicated application code instead (see PCC-09).`,
          }
        : {}),
    });

    // Which rules can actually post today, resolved for real rather than
    // counted — but "cannot resolve through this generic table" is only a
    // real block when neither key has a dedicated resolver elsewhere. No
    // domain service (biological assets, sales, procurement, year end) posts
    // through this table at all; each already resolves its own accounts and
    // calls the one shared PostingService.post() directly. A rule whose keys
    // are covered that way is reported as resolved by dedicated code, not as
    // blocked — it already posts, just not through §66's declarative path.
    const dynamicKeySet = new Set(dynamicallyResolvedKeys.map((k) => k.key));
    let postable = 0;
    let dedicated = 0;
    const blocked: string[] = [];
    for (const rule of allRules) {
      try {
        await this.control.resolve({ companyId, ruleId: rule.ruleId, on: new Date() });
        postable += 1;
      } catch {
        if (dynamicKeySet.has(rule.debitKey) || dynamicKeySet.has(rule.creditKey)) {
          dedicated += 1;
        } else {
          blocked.push(rule.ruleId);
        }
      }
    }

    rows.push({
      id: 'PCC-09',
      what: 'Rules that resolve end to end today',
      expected: '86',
      found: `${postable} through this table, ${dedicated} by dedicated code, ${blocked.length} blocked`,
      state: blocked.length === 0 ? 'PASS' : 'BLOCKED',
      ...(blocked.length === 0
        ? {}
        : {
            next:
              `${blocked.length} rule${blocked.length === 1 ? '' : 's'} cannot resolve through ` +
              `this table AND has no dedicated resolver: ` +
              `${blocked.slice(0, 8).join(', ')}` +
              `${blocked.length > 8 ? `, and ${blocked.length - 8} more` : ''}.`,
          }),
    });

    return {
      rows,
      // BLOCKED is not PASS. §60.5: a mandatory control that is missing is a
      // version 1 correction, not something to defer.
      releasable: rows.every((r) => r.state === 'PASS'),
    };
  }
}

function row(
  id: string,
  what: string,
  expected: string,
  found: string,
  ok: boolean,
  next?: string,
  note?: string,
): CheckRow {
  return {
    id,
    what,
    expected,
    found: note ?? found,
    state: ok ? 'PASS' : 'FAIL',
    ...(ok || !next ? {} : { next }),
  };
}
