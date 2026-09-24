import { Module } from '@nestjs/common';
import { PoultryEggService } from './poultry-egg.service';
import { EggPostingService } from './egg-posting.service';

/** PoultryPro egg production, incubation and hatching. */
@Module({
  providers: [PoultryEggService, EggPostingService],
  exports: [PoultryEggService, EggPostingService],
})
export class PoultryEggModule {}
