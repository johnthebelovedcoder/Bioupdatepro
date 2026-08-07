import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { ManualJournalService } from './manual-journal.service';
import { WorkflowActor, WorkflowPostingHandler } from '../workflow/workflow.types';

/**
 * Registers the Accounting Adjustment Centre against the workflow engine.
 *
 * This is what a module-owned posting handler looks like, and it is the reason
 * the engine takes handlers rather than payloads for anything non-trivial: the
 * document already exists in the database with its lines and dimensions, so the
 * handler reads it rather than trusting a JSON blob captured at submit time. A
 * payload could be edited between submission and approval; the document cannot,
 * because its lines are frozen once it leaves DRAFT.
 */
@Injectable()
export class ManualJournalPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'MANUAL_JOURNAL';

  constructor(
    @Inject(forwardRef(() => ManualJournalService))
    private readonly journals: ManualJournalService,
  ) {}

  async post(input: {
    transactionId: string;
    documentReference: string;
    payload: Prisma.JsonValue;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const transaction = await input.tx.workflowTransaction.findUniqueOrThrow({
      where: { id: input.transactionId },
      select: { documentId: true },
    });

    return this.journals.postApproved({
      manualJournalId: transaction.documentId,
      // The APPROVER posts, not the maker. Who posted is a fact about the
      // approval, and Phase 1 records it on the journal entry.
      actor: input.actor,
      tx: input.tx,
    });
  }
}
