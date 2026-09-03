import { Module, OnModuleInit } from '@nestjs/common';
import { BiologicalAssetService } from './biological-asset.service';
import {
  BiologicalAssetValuationPostingHandler,
  BiologicalAssetAbnormalMortalityPostingHandler,
} from './biological-asset.handler';
import { WorkflowService } from '../workflow/workflow.service';

/** Consolidated Reference §43, §61, §67 — biological assets under IAS 41. */
@Module({
  providers: [
    BiologicalAssetService,
    BiologicalAssetValuationPostingHandler,
    BiologicalAssetAbnormalMortalityPostingHandler,
  ],
  exports: [BiologicalAssetService],
})
export class BiologicalAssetModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly handler: BiologicalAssetValuationPostingHandler,
    private readonly abnormalMortalityHandler: BiologicalAssetAbnormalMortalityPostingHandler,
  ) {}

  onModuleInit(): void {
    this.workflow.register(this.handler);
    this.workflow.register(this.abnormalMortalityHandler);
  }
}
