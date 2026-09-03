import { Module, OnModuleInit } from '@nestjs/common';
import { ProductionOrderService } from './production-order.service';
import { CostAllocationService } from './cost-allocation.service';
import { ProductionOrderAbnormalLossPostingHandler } from './production-order.handlers';
import { MastersModule } from '../masters/masters.module';
import { PostingControlModule } from '../posting-control/posting-control.module';
import { WorkflowService } from '../workflow/workflow.service';

/**
 * Production orders — SnailPro (PCR-051–058) and PoultryPro (PCR-074–080)
 * processing, one engine driven by `SPECIES_PROCESSING_RULES` (Phase 6,
 * US-897-016–020).
 */
@Module({
  imports: [MastersModule, PostingControlModule],
  providers: [ProductionOrderService, CostAllocationService, ProductionOrderAbnormalLossPostingHandler],
  // ProductionOrderController is registered in AppModule, matching every
  // other feature module's controller in this codebase.
  exports: [ProductionOrderService],
})
export class ProductionModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly abnormalLossHandler: ProductionOrderAbnormalLossPostingHandler,
  ) {}

  onModuleInit(): void {
    this.workflow.register(this.abnormalLossHandler);
  }
}
