import { Module } from '@nestjs/common';
import { SnailBreedingController } from './snail-breeding.controller';
import { SnailBreedingService } from './snail-breeding.service';

/** Snail breeding cycles. Prisma and audit are global. */
@Module({
  controllers: [SnailBreedingController],
  providers: [SnailBreedingService],
})
export class SnailBreedingModule {}
