import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrialBalanceService } from '../reporting/trial-balance.service';
import { AuditService } from '../audit/audit.service';
import { OwnedRecord } from '../auth/owned-record.guard';
import { Roles } from '../auth/roles.guard';

/**
 * Phase 1 read/create endpoints for the core masters.
 *
 * Deliberately thin. Master data does not post to the GL, so it does not go
 * through the posting pipeline; what it does need — and gets in Phase 2 — is
 * workflow governance on changes (Consolidated Reference §2 lists "System
 * Configuration" and "Role Changes" as workflow-governed transactions).
 */
@Controller('core')
@Roles('FINANCE_MANAGER', 'FINANCIAL_CONTROLLER', 'MANAGING_DIRECTOR')
export class MastersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trialBalance: TrialBalanceService,
    private readonly audit: AuditService,
  ) {}

  @Get('companies')
  listCompanies() {
    return this.prisma.company.findMany({
      include: { baseCurrency: true },
      orderBy: { code: 'asc' },
    });
  }

  @Get('companies/:companyId/branches')
  listBranches(@Param('companyId') companyId: string) {
    return this.prisma.branch.findMany({
      where: { companyId },
      orderBy: { code: 'asc' },
    });
  }

  @Get('companies/:companyId/cost-centres')
  listCostCentres(@Param('companyId') companyId: string) {
    return this.prisma.costCentre.findMany({
      where: { companyId },
      include: { parent: { select: { code: true, name: true } } },
      orderBy: { code: 'asc' },
    });
  }

  @Get('companies/:companyId/accounts')
  listAccounts(@Param('companyId') companyId: string) {
    return this.prisma.gLAccount.findMany({
      where: { companyId },
      orderBy: { accountNumber: 'asc' },
    });
  }

  @Get('companies/:companyId/periods')
  listPeriods(@Param('companyId') companyId: string) {
    return this.prisma.financialPeriod.findMany({
      where: { financialYear: { companyId } },
      include: { financialYear: { select: { code: true, status: true } } },
      orderBy: [{ financialYear: { code: 'asc' } }, { periodNumber: 'asc' }],
    });
  }

  @Get('companies/:companyId/trial-balance')
  getTrialBalance(
    @Param('companyId') companyId: string,
    @Query('financialPeriodId') financialPeriodId?: string,
    @Query('financialYearId') financialYearId?: string,
    @Query('costCentreId') costCentreId?: string,
    @Query('farmId') farmId?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.trialBalance
      .build({
        companyId,
        financialPeriodId,
        financialYearId,
        costCentreId,
        farmId,
        branchId,
      })
      .then(serialiseBigInts);
  }

  @OwnedRecord('journalEntry', 'journalEntryId')
  @Get('journals/:journalEntryId')
  async getJournal(@Param('journalEntryId') journalEntryId: string) {
    const entry = await this.prisma.journalEntry.findUnique({
      where: { id: journalEntryId },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: {
            glAccount: { select: { accountNumber: true, name: true } },
            costCentre: { select: { code: true, name: true } },
          },
        },
      },
    });
    return serialiseBigInts(entry);
  }

  @OwnedRecord('journalEntry', 'journalEntryId')
  @Get('journals/:journalEntryId/audit')
  getJournalAudit(@Param('journalEntryId') journalEntryId: string) {
    return this.audit.findForTransaction(journalEntryId);
  }

  @OwnedRecord('financialPeriod', 'periodId')
  @Post('periods/:periodId/status')
  async setPeriodStatus(
    @Param('periodId') periodId: string,
    @Body() body: { status: 'OPEN' | 'SOFT_CLOSED' | 'CLOSED' | 'ARCHIVED' },
  ) {
    // Phase 11 routes this through the Workflow Engine and writes a
    // PeriodCloseLog. Phase 1 exposes it directly so the posting gate is
    // testable; it is not the finished close process.
    return this.prisma.financialPeriod.update({
      where: { id: periodId },
      data: { status: body.status },
    });
  }
}

/** JSON has no bigint. Amounts cross the wire as strings, never as numbers. */
function serialiseBigInts<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === 'bigint' ? v.toString() : v,
    ),
  );
}
