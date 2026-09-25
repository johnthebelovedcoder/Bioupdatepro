import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PostingControlService } from './posting-control.service';
import { PostingControlChecksService } from './posting-control-checks.service';
import { PostingControlProvisioningService } from './posting-control-provisioning.service';
import { ChartUnificationService, PRODUCT_CLASSES, ProductClass, UnificationOptions } from '../chart/chart-unification.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { WorkflowActor } from '../workflow/workflow.types';
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
    private readonly provisioning: PostingControlProvisioningService,
    private readonly unification: ChartUnificationService,
  ) {}

  /**
   * The move to the six-digit chart: what would happen, then doing it.
   * The preview changes nothing and can be asked for as often as needed;
   * the run is one transaction, audited, and only a CFO may start it.
   */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Get('chart-unification')
  async unificationPreview(
    @CurrentCompany() companyId: string,
    @Query('cutover') cutover?: string,
    @Query('defaultClass') defaultClass?: string,
    @Query('defaultSpecies') defaultSpecies?: string,
  ) {
    const date = cutover ? parseDay(cutover) : await this.unification.suggestedCutover(companyId);
    if (!date) {
      return { cutoverDate: null, canRun: false, blockers: ['No future month is open. Set up the next financial period first.'], warnings: [], accounts: [], items: [], untouched: [], classes: PRODUCT_CLASSES };
    }
    const preview = await this.unification.preview(companyId, date, parseOptions({ defaultClass, defaultSpecies }));
    return { ...preview, classes: PRODUCT_CLASSES };
  }

  /** The same preview with the person's choices for each item. */
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Post('chart-unification/preview')
  async unificationPreviewWith(
    @CurrentCompany() companyId: string,
    @Body() body: { cutover?: string; itemClasses?: Record<string, string>; defaultClass?: string; defaultSpecies?: string },
  ) {
    if (!body?.cutover) throw new BadRequestException('Give the cutover date.');
    const preview = await this.unification.preview(companyId, parseDay(body.cutover), parseOptions(body));
    return { ...preview, classes: PRODUCT_CLASSES };
  }

  @Roles('CFO')
  @Post('chart-unification')
  async unificationRun(
    @CurrentCompany() companyId: string,
    @CurrentUser() actor: WorkflowActor,
    @Body() body: { cutover?: string; itemClasses?: Record<string, string>; defaultClass?: string; defaultSpecies?: string },
  ) {
    if (!body?.cutover) throw new BadRequestException('Give the cutover date.');
    const result = await this.unification.run({ companyId, cutoverDate: parseDay(body.cutover), options: parseOptions(body), actor });
    return { journals: result.journals, moved: result.moved, repointed: result.repointed, retired: result.retired };
  }

  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
  @Get('provisioning')
  async provisioningStatus(@CurrentCompany() companyId: string) {
    return this.provisioning.status(companyId);
  }

  /**
   * Load the client's posting rules, keys and six-digit chart into this
   * company — what a farm that signed up before sign-up did this never got.
   * Adds accounts, changes none, and is audited against whoever asked.
   */
  @Roles('FINANCE_CONTROLLER', 'CFO')
  @Post('provision')
  async provision(@CurrentCompany() companyId: string, @CurrentUser() actor: WorkflowActor) {
    return this.provisioning.provision(companyId, actor.userId);
  }

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
  @Roles('FINANCE_MANAGER', 'FINANCE_CONTROLLER', 'CFO')
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
        dynamicResolution: string | null;
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
    /** True when this row itself names one active account. */
    resolved: Boolean(key.atomic && key.glAccount?.active),
    /**
     * Where a non-atomic key's real account comes from instead, when it does.
     * This table is not consulted by any domain service — each resolves its
     * own accounts and posts through the one shared engine directly — so a
     * key can be genuinely working without `resolved` ever being true here.
     */
    dynamicResolution: key.dynamicResolution,
  };
}

function parseDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Dates are YYYY-MM-DD.');
  return new Date(`${value}T00:00:00.000Z`);
}

function parseOptions(body: { itemClasses?: Record<string, string>; defaultClass?: string; defaultSpecies?: string }): UnificationOptions {
  const isClass = (v: unknown): v is ProductClass => typeof v === 'string' && v in PRODUCT_CLASSES;
  const options: UnificationOptions = {};
  if (body.defaultClass) {
    if (!isClass(body.defaultClass)) throw new BadRequestException(`Unknown product type ${body.defaultClass}.`);
    options.defaultClass = body.defaultClass;
  }
  if (body.defaultSpecies) {
    if (body.defaultSpecies !== 'poultry' && body.defaultSpecies !== 'snail') throw new BadRequestException('Species is poultry or snail.');
    options.defaultSpecies = body.defaultSpecies;
  }
  if (body.itemClasses) {
    options.itemClasses = {};
    for (const [itemId, cls] of Object.entries(body.itemClasses)) {
      if (!isClass(cls)) throw new BadRequestException(`Unknown product type ${String(cls)}.`);
      options.itemClasses[itemId] = cls;
    }
  }
  return options;
}
