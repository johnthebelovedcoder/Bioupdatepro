import { Body, Controller, Get, Post } from '@nestjs/common';
import { Public } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { PostingService } from '../posting/posting.service';
import { TrialBalanceService } from '../reporting/trial-balance.service';
import { AuditService } from '../audit/audit.service';
import { kobo } from '../common/money';
import { AnyRole } from '../auth/roles.guard';

/**
 * A thin driver for the Phase 1 control panel.
 *
 * This exists so the accounting core can be exercised and inspected from a
 * browser during phase review. It posts through the same PostingService every
 * other module will use — there is no back door here, which is precisely what
 * makes it a fair demonstration.
 *
 * It is NOT part of the product surface. Phase 2 replaces it with real
 * workflow-governed transactions.
 */
// Dev scaffolding: registered only outside production (see AppModule).
@Public()
@Controller('demo')
export class DemoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly posting: PostingService,
    private readonly trialBalance: TrialBalanceService,
    private readonly audit: AuditService,
  ) {}

  @AnyRole('Development-only demo panel; never routable in production.')
  @Get('context')
  async context() {
    const company = await this.prisma.company.findFirst({
      where: { code: 'BAP' },
      include: { baseCurrency: true },
    });
    if (!company) return { seeded: false };

    const [branch, period, costCentres, accounts, farm] = await Promise.all([
      this.prisma.branch.findFirst({ where: { companyId: company.id } }),
      this.prisma.financialPeriod.findFirst({
        where: { financialYear: { companyId: company.id } },
        orderBy: { periodNumber: 'asc' },
        include: { financialYear: true },
      }),
      this.prisma.costCentre.findMany({
        where: { companyId: company.id },
        orderBy: { code: 'asc' },
        include: { parent: { select: { code: true } } },
      }),
      this.prisma.gLAccount.findMany({
        where: { companyId: company.id },
        orderBy: { accountNumber: 'asc' },
      }),
      this.prisma.farm.findFirst({ where: { companyId: company.id } }),
    ]);

    return {
      seeded: true,
      company: { id: company.id, code: company.code, name: company.name },
      currency: company.baseCurrency.code,
      branch,
      period,
      farm,
      costCentres,
      accounts,
    };
  }

  @AnyRole('Development-only demo panel; never routable in production.')
  @Get('periods')
  async periods() {
    return this.prisma.financialPeriod.findMany({
      where: { financialYear: { company: { code: 'BAP' } } },
      orderBy: { periodNumber: 'asc' },
      include: { financialYear: { select: { code: true, status: true } } },
    });
  }

  @AnyRole('Development-only demo panel; never routable in production.')
  @Get('trial-balance')
  async tb() {
    const company = await this.prisma.company.findFirstOrThrow({
      where: { code: 'BAP' },
    });
    const result = await this.trialBalance.build({ companyId: company.id });
    return {
      balanced: result.balanced,
      totalDebitKobo: result.totalDebitKobo.toString(),
      totalCreditKobo: result.totalCreditKobo.toString(),
      rows: result.rows.map((r) => ({
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        normalBalance: r.normalBalance,
        totalDebitKobo: r.totalDebitKobo.toString(),
        totalCreditKobo: r.totalCreditKobo.toString(),
        displayedBalanceKobo: r.displayedBalanceKobo.toString(),
      })),
    };
  }

  @AnyRole('Development-only demo panel; never routable in production.')
  @Get('journals')
  async journals() {
    const entries = await this.prisma.journalEntry.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: {
            glAccount: { select: { accountNumber: true, name: true } },
            costCentre: { select: { code: true } },
          },
        },
      },
    });
    return entries.map((e) => ({
      id: e.id,
      journalNumber: e.journalNumber,
      journalDate: e.journalDate,
      narration: e.narration,
      status: e.status,
      sourceModule: e.sourceModule,
      sourceDocumentType: e.sourceDocumentType,
      reversalOfId: e.reversalOfId,
      postedAt: e.postedAt,
      lines: e.lines.map((l) => ({
        lineNumber: l.lineNumber,
        account: `${l.glAccount.accountNumber} ${l.glAccount.name}`,
        costCentre: l.costCentre?.code ?? null,
        debitKobo: l.debitKobo.toString(),
        creditKobo: l.creditKobo.toString(),
      })),
    }));
  }

  @AnyRole('Development-only demo panel; never routable in production.')
  @Get('audit')
  async auditTrail() {
    const records = await this.prisma.auditRecord.findMany({
      orderBy: { occurredAt: 'desc' },
      take: 30,
      include: { user: { select: { fullName: true } } },
    });
    return records.map((r) => ({
      occurredAt: r.occurredAt,
      action: r.action,
      module: r.module,
      entityType: r.entityType,
      status: r.status,
      user: r.user.fullName,
      comments: r.comments,
      metadata: r.metadata,
    }));
  }

  /**
   * Post a scenario through the real posting pipeline. `variant` selects
   * either a valid entry or one of the rule violations, so the panel can show
   * both that correct postings land and that incorrect ones are refused.
   */
  @AnyRole('Development-only demo panel; never routable in production.')
  @Post('post')
  async postScenario(
    @Body()
    body: {
      variant:
        | 'material-issue'
        | 'unbalanced'
        | 'missing-cost-centre'
        | 'summary-account'
        | 'replay';
      idempotencyKey?: string;
    },
  ) {
    const company = await this.prisma.company.findFirstOrThrow({
      where: { code: 'BAP' },
    });
    const [branch, period, costCentre, farm, wip, raw, summaryParent] =
      await Promise.all([
        this.prisma.branch.findFirstOrThrow({ where: { companyId: company.id } }),
        this.prisma.financialPeriod.findFirstOrThrow({
          where: { financialYear: { companyId: company.id } },
          orderBy: { periodNumber: 'asc' },
          include: { financialYear: true },
        }),
        this.prisma.costCentre.findFirstOrThrow({
          where: { companyId: company.id, code: 'SN-SLIME' },
        }),
        this.prisma.farm.findFirstOrThrow({ where: { companyId: company.id } }),
        this.prisma.gLAccount.findFirstOrThrow({
          where: { companyId: company.id, accountNumber: '1501' },
        }),
        this.prisma.gLAccount.findFirstOrThrow({
          where: { companyId: company.id, accountNumber: '1301' },
        }),
        this.prisma.gLAccount.findFirst({
          where: { companyId: company.id, isPostingAccount: false },
        }),
      ]);

    const actor = await this.ensureDemoUser();
    const stamp = Date.now().toString(36);
    const key = body.idempotencyKey ?? `demo-${stamp}`;

    const base = {
      companyId: company.id,
      branchId: branch.id,
      financialYearId: period.financialYearId,
      financialPeriodId: period.id,
      currencyId: company.baseCurrencyId,
      exchangeRate: '1.00000000',
    };

    const dimensions = { ...base };
    // ₦195,500.00 — the SnailPro workbook's PO-SN-001 material issue.
    const amount = kobo(195_500_00);

    const request = {
      sourceModule: 'demo',
      sourceDocumentType: 'MaterialIssue',
      sourceDocumentId: `MI-DEMO-${stamp}`,
      journalNumber: `JRN-DEMO-${stamp}`,
      journalDate: new Date('2026-01-15'),
      narration: 'Materials issued from inventory to production',
      ...base,
      idempotencyKey: key,
      actor: { userId: actor.id, roles: actor.roles },
      lines: [
        {
          glAccountId: wip.id,
          description: 'Work in Progress',
          debit: amount,
          dimensions: { ...dimensions, costCentreId: costCentre.id, farmId: farm.id },
        },
        {
          glAccountId: raw.id,
          description: 'Raw Material Inventory',
          credit: amount,
          dimensions: { ...dimensions, farmId: farm.id },
        },
      ],
    };

    switch (body.variant) {
      case 'unbalanced':
        request.lines[1]!.credit = kobo(195_499_00);
        break;
      case 'missing-cost-centre':
        delete (request.lines[0]!.dimensions as Record<string, unknown>)
          .costCentreId;
        break;
      case 'summary-account': {
        // The seeded chart of accounts contains only the accounts the source
        // workbooks actually name, and none of them is a summary account
        // (see docs/assumptions.md A2). Rather than invent one in the seed,
        // create it here, clearly labelled as demo scaffolding.
        const summary =
          summaryParent ?? (await this.ensureDemoSummaryAccount(company.id));
        request.lines[1]!.glAccountId = summary.id;
        break;
      }
      case 'replay':
        request.idempotencyKey = 'demo-fixed-key';
        request.journalNumber = 'JRN-DEMO-REPLAY';
        request.sourceDocumentId = 'MI-DEMO-REPLAY';
        break;
      default:
        break;
    }

    const result = await this.posting.post(request);
    return {
      ok: true,
      journalNumber: result.journalNumber,
      journalEntryId: result.journalEntryId,
      replayed: result.replayed,
      totalDebitKobo: result.totalDebitKobo.toString(),
      totalCreditKobo: result.totalCreditKobo.toString(),
    };
  }

  /**
   * Attempt a forbidden UPDATE straight at the database, bypassing every line
   * of application code. The trigger's own message is returned verbatim so the
   * panel can show where the refusal came from.
   */
  @AnyRole('Development-only demo panel; never routable in production.')
  @Post('tamper')
  async tamper(@Body() body: { journalEntryId: string }) {
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE journal_entries SET narration = 'TAMPERED' WHERE id = $1::uuid`,
        body.journalEntryId,
      );
      return {
        blocked: false,
        message: 'The UPDATE succeeded — immutability is broken.',
      };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // Prisma wraps the driver error in several lines of context; the trigger's
      // RAISE EXCEPTION text is the line we actually want to show.
      const triggerMessage =
        raw
          .split('\n')
          .map((line) => line.trim())
          .find((line) => /posted and cannot be|append-only|does not balance/i.test(line)) ??
        raw.split('\n').filter(Boolean).pop() ??
        raw;
      return { blocked: true, message: triggerMessage };
    }
  }

  @AnyRole('Development-only demo panel; never routable in production.')
  @Post('reverse')
  async reverse(@Body() body: { journalEntryId: string }) {
    const actor = await this.ensureDemoUser();
    const original = await this.prisma.journalEntry.findUniqueOrThrow({
      where: { id: body.journalEntryId },
    });
    const stamp = Date.now().toString(36);
    const result = await this.posting.reverse(body.journalEntryId, {
      journalNumber: `JRN-REV-${stamp}`,
      journalDate: new Date('2026-01-20'),
      narration: `Reversal of ${original.journalNumber}`,
      financialYearId: original.financialYearId,
      financialPeriodId: original.financialPeriodId,
      idempotencyKey: `rev-${stamp}`,
      actor: { userId: actor.id, roles: actor.roles },
    });
    return {
      ok: true,
      journalNumber: result.journalNumber,
      journalEntryId: result.journalEntryId,
    };
  }

  @AnyRole('Development-only demo panel; never routable in production.')
  @Post('period-status')
  async setPeriodStatus(
    @Body() body: { status: 'OPEN' | 'SOFT_CLOSED' | 'CLOSED' | 'ARCHIVED' },
  ) {
    const period = await this.prisma.financialPeriod.findFirstOrThrow({
      where: { financialYear: { company: { code: 'BAP' } } },
      orderBy: { periodNumber: 'asc' },
    });
    await this.prisma.financialPeriod.update({
      where: { id: period.id },
      data: { status: body.status },
    });
    return { ok: true, period: period.name, status: body.status };
  }

  @AnyRole('Development-only demo panel; never routable in production.')
  @Post('reset')
  async reset() {
    // Demo data only: journals, their lines, the idempotency log and the audit
    // trail. TRUNCATE bypasses the row triggers by design — this is a review
    // sandbox, and the triggers guard application DML, not a deliberate reset.
    await this.prisma.$executeRawUnsafe(
      `TRUNCATE TABLE audit_records, idempotency_records, journal_lines, journal_entries RESTART IDENTITY CASCADE;`,
    );
    return { ok: true };
  }

  /** Demo-only. A non-posting parent account, so the refusal can be shown. */
  private async ensureDemoSummaryAccount(companyId: string) {
    const existing = await this.prisma.gLAccount.findFirst({
      where: { companyId, accountNumber: '1000' },
    });
    if (existing) return existing;
    return this.prisma.gLAccount.create({
      data: {
        companyId,
        accountNumber: '1000',
        name: 'Current Assets (summary — demo only)',
        accountType: 'ASSET',
        normalBalance: 'DEBIT',
        isPostingAccount: false,
      },
    });
  }

  private async ensureDemoUser() {
    /*
     * Belongs to the demo company, like any other operator.
     *
     * Audit records are stamped with the acting user's company, so a demo
     * operator with no company writes records that belong to no tenant — and
     * they then vanish from the audit screen, which is company-scoped. The
     * postings would be real and their trail invisible, which is precisely the
     * impression this scaffolding exists to avoid giving.
     */
    const company = await this.prisma.company.findFirstOrThrow({ where: { code: 'BAP' } });

    const existing = await this.prisma.user.findUnique({
      where: { email: 'demo@bioassetpro.local' },
    });
    if (existing) {
      // Attach one created before the company link existed.
      if (existing.companyId === company.id) return existing;
      return this.prisma.user.update({
        where: { id: existing.id },
        data: { companyId: company.id },
      });
    }

    return this.prisma.user.create({
      data: {
        email: 'demo@bioassetpro.local',
        fullName: 'Demo Operator',
        passwordHash: 'not-a-real-account',
        roles: ['PRODUCTION_SUPERVISOR', 'FINANCE_MANAGER'],
        companyId: company.id,
      },
    });
  }
}
