import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { ProductionOrderService } from './production-order.service';
import { WorkflowActor, WorkflowPostingHandler } from '../workflow/workflow.types';

/** Registers a production order's abnormal-loss claim against the shared workflow engine. */
@Injectable()
export class ProductionOrderAbnormalLossPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'PRODUCTION_ORDER_ABNORMAL_LOSS';

  constructor(
    @Inject(forwardRef(() => ProductionOrderService))
    private readonly orders: ProductionOrderService,
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

    return this.orders.postApprovedAbnormalLoss({
      lossEventId: transaction.documentId,
      actor: input.actor,
      tx: input.tx,
    });
  }
}
