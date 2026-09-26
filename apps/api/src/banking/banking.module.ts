import { Module } from '@nestjs/common';
import { BankingController } from './banking.controller';
import { BankingService } from './banking.service';
import { PaymentFileService } from './payment-file.service';
import { PaymentFilesController } from './payment-files.controller';

/** Bank accounts, imported statements and reconciliation. Prisma and audit are global. */
@Module({
  controllers: [BankingController, PaymentFilesController],
  providers: [BankingService, PaymentFileService],
})
export class BankingModule {}
