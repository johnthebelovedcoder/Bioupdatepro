import { Injectable } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { AccountingRuleViolation } from '../common/errors';
import type { WorkflowActor, WorkflowPostingHandler } from '../workflow/workflow.types';
import { TaxPeriodService } from './tax-period.service';

/** Posts VAT clearing only after the shared workflow engine records approval. */
@Injectable()
export class VatSettlementPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'VAT_SETTLEMENT_RUN';

  constructor(private readonly periods: TaxPeriodService) {}

  async post(input: {
    transactionId: string;
    documentReference: string;
    payload: Prisma.JsonValue;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string | null }> {
    const transaction = await input.tx.workflowTransaction.findUniqueOrThrow({ where: { id: input.transactionId } });
    const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? input.payload as Prisma.JsonObject
      : null;
    const taxPeriodId = payload && typeof payload.taxPeriodId === 'string' ? payload.taxPeriodId : null;
    if (transaction.module !== 'tax' || transaction.documentType !== 'VatSettlementRun' || transaction.documentId !== taxPeriodId || !taxPeriodId) {
      throw new AccountingRuleViolation('YifrehCore COR-YFR-073A/B — approved settlement source', 'The VAT settlement approval is not linked to its submitted tax period.', { transactionId: transaction.id });
    }
    const result = await this.periods.postApprovedVatSettlement({
      companyId: transaction.companyId,
      taxPeriodId,
      actor: input.actor,
      tx: input.tx,
    });
    return { journalEntryId: result.journalEntryId };
  }
}
