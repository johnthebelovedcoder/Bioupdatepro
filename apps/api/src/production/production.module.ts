import { Module } from '@nestjs/common';
import { ProductionOrderService } from './production-order.service';
import { CostAllocationService } from './cost-allocation.service';
import { MastersModule } from '../masters/masters.module';
import { PostingControlModule } from '../posting-control/posting-control.module';

/**
 * Production orders — SnailPro (PCR-051–058) and PoultryPro (PCR-074–080)
 * processing, one engine driven by `SPECIES_PROCESSING_RULES` (Phase 6,
 * US-897-016–020).
 */
@Module({
  imports: [MastersModule, PostingControlModule],
  providers: [ProductionOrderService, CostAllocationService],
  // ProductionOrderController is registered in AppModule, matching every
  // other feature module's controller in this codebase.
  exports: [ProductionOrderService],
})
export class ProductionModule {}
