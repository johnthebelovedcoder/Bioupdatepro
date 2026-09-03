import { Module } from '@nestjs/common';
import { RoutingService } from './routing.service';

/** Routing and activity-based costing — US-897-014/015. */
@Module({
  providers: [RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
