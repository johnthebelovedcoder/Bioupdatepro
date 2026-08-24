import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PostingControlService } from './posting-control.service';
import { PostingControlChecksService } from './posting-control-checks.service';
import { CurrentCompany } from '../auth/current-user.decorator';
import { AnyRole, Roles } from '../auth/roles.guard';

/**
 * The posting rules, readable.
 *
 * §66.4 makes adding a rule a controlled act with a Finance Controller's
 * approval, so the register has to be something a controller can actually open
 * and read — not a table only the database knows about. Reading is open to any
 * signed-in role: knowing that receiving stock debits inventory and credits
 * GRNI is how somebody learns the system, and none of it is confidential.
 *
 * There is deliberately no route here that changes a rule. §66.4 requires a new
 * effective-dated version approved by a Finance Controller, with positive,
 * negative, reversal, duplicate, closed-period, missing-dimension,
 * inactive-account and unbalanced-journal tests run against it before it goes
 * active. A PATCH endpoint would quietly make all of that optional.
 */
@Controller('posting-control')
export class PostingControlController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly control: PostingControlService,
    private readonly checks: PostingControlChecksService,
  ) {}

  @AnyRole('The posting rules are how the system explains itself.')
  @Get('rules')
  async rules(@CurrentCompany() companyId: string, @Query('cycle') cycle?: string) {
    const rules = await this.prisma.postingRule.findMany({
      where: { companyId, ...(cycle ? { cycle } : {}) },
      orderBy: [{ module: 'asc' }, { cycle: 'asc' }, { sequence: 'asc' }, { ruleId: 'asc' }],
    });

    const keys = await this.prisma.postingKey.findMany({
      where: { companyId },
      include: { glAccount: { select: { accountNumber: true, name: true, active: true } } },
    });
    const byKey = new Map(keys.map((k) => [k.key, k]));

    /*
     * Which accounts are closed to manual journals, in fact.
     *
     * The workbook gives one account two different flags across its keys —
     * 130100 Raw Materials is GENERAL on four rows and CONTROL on others — and
     * the guard takes the restrictive reading, because §66.3 lists inventory
     * among the control ledgers. Showing each key's own flag would then tell a
     * controller they may journal an account the system will refuse, which is
     * the one thing this page must not do. So the effective flag is shown, and
     * where it disagrees with the row the page says so.
     */
    const controlled = new Set(
      keys
        .filter((k) => k.ledgerFlag === 'CONTROL' && k.glAccountId)
        .map((k) => k.glAccountId as string),
    );

    return rules.map((rule) => {
      const debit = byKey.get(rule.debitKey);
      const credit = byKey.get(rule.creditKey);
      return {
        ruleId: rule.ruleId,
        module: rule.module,
        cycle: rule.cycle,
        trigger: rule.trigger,
        sourceDocument: rule.sourceDocument,
        scenario: rule.scenario,
        measurementBasis: rule.measurementBasis,
        requiredDimensions: rule.requiredDimensions,
        makerRole: rule.makerRole,
        approverRole: rule.approverRole,
        blockingControl: rule.blockingControl,
        reversalMethod: rule.reversalMethod,
        status: rule.status,
        version: rule.version,
        debit: describe(debit, controlled),
        credit: describe(credit, controlled),
        postsNothing: debit?.ledgerFlag === 'NO_JOURNAL' && credit?.ledgerFlag === 'NO_JOURNAL',
      };
    });
  }

  /** One rule, resolved exactly as a posting would resolve it. */
  @AnyRole('The posting rules are how the system explains itself.')
  @Get('rules/:ruleId')
  async rule(@CurrentCompany() companyId: string, @Param('ruleId') ruleId: string) {
    try {
      const resolved = await this.control.resolve({ companyId, ruleId, on: new Date() });
      return { resolvable: true, ...resolved };
    } catch (error) {
      // A rule that cannot resolve is the interesting case, so it is an answer
      // rather than a 422 — the reason is what somebody came here to read.
      return {
        ruleId,
        resolvable: false,
        reason: error instanceof Error ? error.message : 'Could not resolve.',
      };
    }
  }

  /**
   * §66.5 release gate.
   *
   * Restricted, unlike the register: this decides whether a release may
   * proceed, and it is a controller's judgement rather than general reading.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CEO')
  @Get('checks')
  async release(@CurrentCompany() companyId: string) {
    return this.checks.run(companyId);
  }
}

function describe(
  key:
    | {
        key: string;
        glAccountCode: string | null;
        glAccountName: string;
        ledgerFlag: string;
        atomic: boolean;
        active: boolean;
        glAccountId: string | null;
        glAccount: { accountNumber: string; name: string; active: boolean } | null;
      }
    | undefined,
  controlled: ReadonlySet<string>,
) {
  if (!key) return null;

  // What the workbook says on this row, and what the system will actually do.
  // They differ for exactly one account, and the page shows both.
  const stated = key.ledgerFlag;
  const effective =
    key.glAccountId && controlled.has(key.glAccountId) ? 'CONTROL' : key.ledgerFlag;

  return {
    key: key.key,
    code: key.glAccount?.accountNumber ?? key.glAccountCode,
    name: key.glAccount?.name ?? key.glAccountName,
    ledgerFlag: effective,
    /** Set when this row's own flag is less restrictive than the account's. */
    flagConflict: effective !== stated ? stated : null,
    /** False when the key names an expression the client has not yet pinned down. */
    resolved: Boolean(key.atomic && key.glAccount?.active),
  };
}
