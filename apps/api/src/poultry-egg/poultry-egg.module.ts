import { Module } from '@nestjs/common';
import { PoultryEggService } from './poultry-egg.service';

/** PoultryPro egg production, incubation and hatching. */
@Module({
  providers: [PoultryEggService],
  exports: [PoultryEggService],
})
export class PoultryEggModule {}
