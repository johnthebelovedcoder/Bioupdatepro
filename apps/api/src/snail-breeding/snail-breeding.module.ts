import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { AccountingRuleViolation } from '../common/errors';
import { SnailBreedingController } from './snail-breeding.controller';
import { SnailBreedingService } from './snail-breeding.service';
import { PostingControlModule } from '../posting-control/posting-control.module';
import { WorkflowService } from '../workflow/workflow.service';
import type { WorkflowActor, WorkflowPostingHandler } from '../workflow/workflow.types';

@Injectable()
class SnailEggRecognitionPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'SNAIL_EGG_RECOGNITION';
  constructor(private readonly breeding: SnailBreedingService) {}

  async post(input: { transactionId: string; documentReference: string; payload: Prisma.JsonValue; actor: WorkflowActor; tx: Prisma.TransactionClient }) {
    const transaction = await input.tx.workflowTransaction.findUniqueOrThrow({ where: { id: input.transactionId }, select: { documentId: true, transactionType: true } });
    if (transaction.transactionType !== this.transactionType) throw new AccountingRuleViolation('Snail egg recognition workflow', 'The approval transaction type does not match egg recognition.', { transactionType: transaction.transactionType });
    return this.breeding.postApprovedEggRecognition({ cycleId: transaction.documentId, workflowTransactionId: input.transactionId, actor: input.actor, tx: input.tx });
  }
}

/** Snail breeding cycles. Prisma and audit are global. */
@Module({
  imports: [PostingControlModule],
  controllers: [SnailBreedingController],
  providers: [SnailBreedingService, SnailEggRecognitionPostingHandler],
})
export class SnailBreedingModule implements OnModuleInit {
  constructor(private readonly workflow: WorkflowService, private readonly recognitionHandler: SnailEggRecognitionPostingHandler) {}
  onModuleInit(): void { this.workflow.register(this.recognitionHandler); }
}
