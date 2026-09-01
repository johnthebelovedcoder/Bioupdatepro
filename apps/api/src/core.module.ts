import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { AuditService } from './audit/audit.service';
import { IdempotencyService } from './idempotency/idempotency.service';
import { PeriodService } from './periods/period.service';
import { DimensionValidatorService } from './enterprise-dimensions/dimension-validator.service';
import { PostingService } from './posting/posting.service';
import { StockMovementService } from './inventory/stock-movement.service';
import { TrialBalanceService } from './reporting/trial-balance.service';
import { ProfitLossService } from './reporting/profit-loss.service';
import { BalanceSheetService } from './reporting/balance-sheet.service';
import { CashFlowService } from './reporting/cash-flow.service';
import { ControlAccountReconciliationService } from './reporting/control-account-reconciliation.service';

/**
 * The shared platform every later module builds on.
 *
 * Global by design: Rule 5 says one workflow engine and one tax engine, and the
 * same reasoning applies here — one posting service, one audit service, one
 * dimension validator. Making them global means a module cannot accidentally
 * instantiate its own.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    AuditService,
    IdempotencyService,
    PeriodService,
    DimensionValidatorService,
    PostingService,
    StockMovementService,
    TrialBalanceService,
    ProfitLossService,
    BalanceSheetService,
    CashFlowService,
    ControlAccountReconciliationService,
  ],
  exports: [
    PrismaService,
    AuditService,
    IdempotencyService,
    PeriodService,
    DimensionValidatorService,
    PostingService,
    StockMovementService,
    TrialBalanceService,
    ProfitLossService,
    BalanceSheetService,
    CashFlowService,
    ControlAccountReconciliationService,
  ],
})
export class CoreModule {}
