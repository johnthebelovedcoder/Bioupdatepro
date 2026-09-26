import { Module } from '@nestjs/common';
import { TraceabilityController } from './traceability.controller';
import { TraceabilityService } from './traceability.service';

/** Lot traceability (AC-011). Its controller lives here, so nothing needs exporting. */
@Module({
  providers: [TraceabilityService],
  controllers: [TraceabilityController],
  exports: [TraceabilityService],
})
export class TraceabilityModule {}
