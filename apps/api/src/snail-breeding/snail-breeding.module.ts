import { Module } from '@nestjs/common';
import { SnailBreedingController } from './snail-breeding.controller';
import { SnailBreedingService } from './snail-breeding.service';
import { PostingControlModule } from '../posting-control/posting-control.module';

/** Snail breeding cycles. Prisma and audit are global. */
@Module({
  imports: [PostingControlModule],
  controllers: [SnailBreedingController],
  providers: [SnailBreedingService],
})
export class SnailBreedingModule {}
