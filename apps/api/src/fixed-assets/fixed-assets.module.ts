import { Module, OnModuleInit } from '@nestjs/common';
import { FixedAssetService } from './fixed-asset.service';
import { AssetChangeService } from './asset-change.service';
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
    AssetChangeService,
    FixedAssetCapitalisationPostingHandler,
    DepreciationRunPostingHandler,
    FixedAssetDisposalPostingHandler,
  ],
  // Exported because FixedAssetsController is registered in AppModule.
  exports: [FixedAssetService, AssetChangeService],
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
