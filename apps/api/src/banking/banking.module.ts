import { Module } from '@nestjs/common';
import { BankingController } from './banking.controller';
import { BankingService } from './banking.service';

/** Bank accounts, imported statements and reconciliation. Prisma and audit are global. */
@Module({
  controllers: [BankingController],
  providers: [BankingService],
})
export class BankingModule {}
