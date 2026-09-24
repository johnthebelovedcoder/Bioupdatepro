import { Module } from '@nestjs/common';
import { PostingControlService } from './posting-control.service';
import { PostingControlChecksService } from './posting-control-checks.service';
import { PostingControlProvisioningService } from './posting-control-provisioning.service';

/** Consolidated Reference §66 — table-driven posting. */
@Module({
  providers: [PostingControlService, PostingControlChecksService, PostingControlProvisioningService],
  // All three exported: the controller that uses them is declared in AppModule.
  exports: [PostingControlService, PostingControlChecksService, PostingControlProvisioningService],
})
export class PostingControlModule {}
