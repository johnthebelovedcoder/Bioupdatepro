import { Module } from '@nestjs/common';
import { FarmCostAllocationController } from './farm-cost-allocation.controller';
import { FarmCostAllocationService } from './farm-cost-allocation.service';
import { TimesheetService } from './timesheet.service';

/** Farm labour and overhead charged to populations. Posting, audit and Prisma are global (CoreModule). */
@Module({
  controllers: [FarmCostAllocationController],
  providers: [FarmCostAllocationService, TimesheetService],
  exports: [FarmCostAllocationService, TimesheetService],
})
export class CostAllocationModule {}
