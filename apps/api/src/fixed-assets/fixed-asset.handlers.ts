import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { FixedAssetService } from './fixed-asset.service';
import { WorkflowActor, WorkflowPostingHandler } from '../workflow/workflow.types';

/** Registers fixed-asset capitalisation against the shared workflow engine. */
@Injectable()
export class FixedAssetCapitalisationPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'FIXED_ASSET_CAPITALISATION';

  constructor(
    @Inject(forwardRef(() => FixedAssetService))
    private readonly assets: FixedAssetService,
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

    return this.assets.postApprovedCapitalisation({
      assetId: transaction.documentId,
      actor: input.actor,
      tx: input.tx,
    });
  }
}

/** Registers a depreciation run against the shared workflow engine. */
@Injectable()
export class DepreciationRunPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'DEPRECIATION_RUN';

  constructor(
    @Inject(forwardRef(() => FixedAssetService))
    private readonly assets: FixedAssetService,
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

    return this.assets.postApprovedDepreciation({
      runId: transaction.documentId,
      actor: input.actor,
      tx: input.tx,
    });
  }
}

/** Registers fixed-asset disposal against the shared workflow engine. */
@Injectable()
export class FixedAssetDisposalPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'FIXED_ASSET_DISPOSAL';

  constructor(
    @Inject(forwardRef(() => FixedAssetService))
    private readonly assets: FixedAssetService,
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

    const payload = input.payload as { disposedOn?: string } | null;
    const disposedOn = payload?.disposedOn ? new Date(payload.disposedOn) : new Date();

    return this.assets.postApprovedDisposal({
      assetId: transaction.documentId,
      disposedOn,
      actor: input.actor,
      tx: input.tx,
    });
  }
}
