import { Module, OnModuleInit } from '@nestjs/common';
import { ManualJournalService } from './manual-journal.service';
import { RecurringJournalService } from './recurring-journal.service';
import { PartyLedgerService } from './party-ledger.service';
import { ManualJournalPostingHandler } from './manual-journal.handler';
import { WorkflowService } from '../workflow/workflow.service';

/**
 * The Accounting Adjustment Centre (§3).
 *
 * Registers its posting handler with the shared workflow engine at startup,
 * which is the pattern every later module follows: a module declares how its
 * documents post, and the engine owns when.
 */
@Module({
  providers: [
    ManualJournalService,
    RecurringJournalService,
    PartyLedgerService,
    ManualJournalPostingHandler,
  ],
  exports: [ManualJournalService, RecurringJournalService, PartyLedgerService],
})
export class JournalsModule implements OnModuleInit {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly handler: ManualJournalPostingHandler,
  ) {}

  onModuleInit(): void {
    this.workflow.register(this.handler);
  }
}
