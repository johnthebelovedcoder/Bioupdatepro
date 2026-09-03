import { Module, OnModuleInit } from '@nestjs/common';
import { FixedAssetService } from './fixed-asset.service';
import {
  FixedAssetCapitalisationPostingHandler,
  DepreciationRunPostingHandler,
  FixedAssetDisposalPostingHandler,
} from './fixed-asset.handlers';
import { WorkflowService } from '../workflow/workflow.service';

/** Fixed assets (US-897-025). */
@Module({
  providers: [
    FixedAssetService,
    FixedAssetCapitalisationPostingHandler,
    DepreciationRunPostingHandler,
    FixedAssetDisposalPostingHandler,
  ],
  exports: [FixedAssetService],
})
export class FixedAssetsModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly capitalisationHandler: FixedAssetCapitalisationPostingHandler,
    private readonly depreciationHandler: DepreciationRunPostingHandler,
    private readonly disposalHandler: FixedAssetDisposalPostingHandler,
  ) {}

  onModuleInit(): void {
    this.workflow.register(this.capitalisationHandler);
    this.workflow.register(this.depreciationHandler);
    this.workflow.register(this.disposalHandler);
  }
}
