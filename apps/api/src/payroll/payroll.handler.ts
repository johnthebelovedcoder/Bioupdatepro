import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { PayrollRunService } from './payroll-run.service';
import { WorkflowActor, WorkflowPostingHandler } from '../workflow/workflow.types';

/** Registers payroll against the shared workflow engine (Rule 5). */
@Injectable()
export class PayrollPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'PAYROLL_RUN';

  constructor(
    @Inject(forwardRef(() => PayrollRunService))
    private readonly payroll: PayrollRunService,
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

    return this.payroll.postApproved({
      payrollRunId: transaction.documentId,
      actor: input.actor,
      tx: input.tx,
    });
  }
}
