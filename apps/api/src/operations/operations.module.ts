import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { OperationsReadService } from './operations-read.service';
import { TradeService } from './trade.service';
import { OperationsPostingService } from './operations-posting.service';
import { SalesModule } from '../sales/sales.module';
import { ProcurementModule } from '../procurement/procurement.module';

/**
 * Operations — the livestock and the work recorded against it.
 *
 * Prisma, audit and idempotency all come from the global CoreModule, so this
 * declares only what is its own.
 *
 * Sales and Procurement are imported because the outbox also carries trade, and
 * TradeService hands it to them rather than raising its own documents. The
 * dependency runs this way round on purpose: operations knows about O2C, and
 * O2C knows nothing about a phone.
 */
@Module({
  // PostingService, Prisma, audit and idempotency are all global (CoreModule).
  imports: [SalesModule, ProcurementModule],
  controllers: [OperationsController],
  providers: [
    OperationsService,
    OperationsReadService,
    TradeService,
    OperationsPostingService,
  ],
  exports: [OperationsService, OperationsReadService],
})
export class OperationsModule {}
