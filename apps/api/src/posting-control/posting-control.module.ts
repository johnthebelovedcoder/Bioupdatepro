import { Module } from '@nestjs/common';
import { PostingControlService } from './posting-control.service';
import { PostingControlChecksService } from './posting-control-checks.service';
import { PostingControlProvisioningService } from './posting-control-provisioning.service';
import { ChartUnificationService } from '../chart/chart-unification.service';
import { ApprovedCutoverService } from '../chart/approved-cutover.service';
import { RearingCostService } from '../biological-assets/rearing-cost.service';

/** Consolidated Reference §66 — table-driven posting. */
@Module({
  providers: [PostingControlService, PostingControlChecksService, PostingControlProvisioningService, ChartUnificationService, ApprovedCutoverService, RearingCostService],
  // All three exported: the controller that uses them is declared in AppModule.
  exports: [PostingControlService, PostingControlChecksService, PostingControlProvisioningService, ChartUnificationService, ApprovedCutoverService],
})
export class PostingControlModule {}
