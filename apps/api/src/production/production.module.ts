import { Module } from '@nestjs/common';
import { ProductionOrderService } from './production-order.service';
import { CostAllocationService } from './cost-allocation.service';
import { MastersModule } from '../masters/masters.module';
import { BiologicalAssetModule } from '../biological-assets/biological-asset.module';
import { PostingControlModule } from '../posting-control/posting-control.module';

/** Production orders — the SnailPro processing slice (Phase 6, US-897-016–020). */
@Module({
  imports: [MastersModule, BiologicalAssetModule, PostingControlModule],
  providers: [ProductionOrderService, CostAllocationService],
  // ProductionOrderController is registered in AppModule, matching every
  // other feature module's controller in this codebase.
  exports: [ProductionOrderService],
})
export class ProductionModule {}
