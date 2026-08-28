import { Module, OnModuleInit } from '@nestjs/common';
import { FixedAssetService } from './fixed-asset.service';
import {
  FixedAssetCapitalisationPostingHandler,
  DepreciationRunPostingHandler,
} from './fixed-asset.handlers';
import { WorkflowService } from '../workflow/workflow.service';

/** Fixed assets (US-897-025). */
@Module({
  providers: [
    FixedAssetService,
    FixedAssetCapitalisationPostingHandler,
    DepreciationRunPostingHandler,
  ],
  exports: [FixedAssetService],
})
export class FixedAssetsModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly capitalisationHandler: FixedAssetCapitalisationPostingHandler,
    private readonly depreciationHandler: DepreciationRunPostingHandler,
  ) {}

  onModuleInit(): void {
    this.workflow.register(this.capitalisationHandler);
    this.workflow.register(this.depreciationHandler);
  }
}
