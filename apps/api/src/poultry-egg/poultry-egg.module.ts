import { Module } from '@nestjs/common';
import { PoultryEggService } from './poultry-egg.service';
import { EggPostingService } from './egg-posting.service';
import { IncubationLogService } from './incubation-log.service';
import { IncubationLogController } from './incubation-log.controller';

/** PoultryPro egg production, incubation and hatching. */
@Module({
  providers: [PoultryEggService, EggPostingService, IncubationLogService],
  controllers: [IncubationLogController],
  exports: [PoultryEggService, EggPostingService, IncubationLogService],
})
export class PoultryEggModule {}
