import { Module } from '@nestjs/common';
import { PostingControlService } from './posting-control.service';
import { PostingControlChecksService } from './posting-control-checks.service';

/** Consolidated Reference §66 — table-driven posting. */
@Module({
  providers: [PostingControlService, PostingControlChecksService],
  exports: [PostingControlService, PostingControlChecksService],
})
export class PostingControlModule {}
