import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { BiologicalAssetService } from './biological-asset.service';
import { WorkflowActor, WorkflowPostingHandler } from '../workflow/workflow.types';

/** §61.6 — a valuation posts once approved, same as every other document. */
@Injectable()
export class BiologicalAssetValuationPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'BA_VALUATION';

  constructor(
    @Inject(forwardRef(() => BiologicalAssetService))
    private readonly assets: BiologicalAssetService,
  ) {}

  async post(input: {
    transactionId: string;
    documentReference: string;
    payload: Prisma.JsonValue;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string | null }> {
    const transaction = await input.tx.workflowTransaction.findUniqueOrThrow({
      where: { id: input.transactionId },
      select: { documentId: true },
    });
    return this.assets.postApprovedValuation({
      valuationId: transaction.documentId,
      actor: input.actor,
      tx: input.tx,
    });
  }
}
