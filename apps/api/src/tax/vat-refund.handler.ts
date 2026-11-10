import { Injectable } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { AccountingRuleViolation } from '../common/errors';
import type { WorkflowActor, WorkflowPostingHandler } from '../workflow/workflow.types';
import { TaxPeriodService } from './tax-period.service';

/** Posts an authority refund receipt only after the refund claim is approved. */
@Injectable()
export class VatRefundPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'VAT_REFUND_CLAIM';

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
    const bankAccountId = payload && typeof payload.bankAccountId === 'string' ? payload.bankAccountId : null;
    const authorityAdviceReference = payload && typeof payload.authorityAdviceReference === 'string' ? payload.authorityAdviceReference : null;
    const amountKobo = payload && typeof payload.amountKobo === 'string' && /^\d+$/.test(payload.amountKobo) ? BigInt(payload.amountKobo) : 0n;
    if (transaction.module !== 'tax' || transaction.documentType !== 'VatRefundClaim' || !taxPeriodId || !bankAccountId || !authorityAdviceReference || transaction.documentId !== `${taxPeriodId}:${authorityAdviceReference}` || amountKobo <= 0n || transaction.amountKobo !== amountKobo) {
      throw new AccountingRuleViolation('YifrehCore COR-YFR-076 — approved refund source', 'The refund approval does not match its filed return, authority advice, bank, or approved amount.', { transactionId: transaction.id });
    }
    const result = await this.periods.postApprovedVatRefund({
      companyId: transaction.companyId,
      taxPeriodId,
      bankAccountId,
      authorityAdviceReference,
      amountKobo,
      actor: input.actor,
      tx: input.tx,
    });
    return { journalEntryId: result.journalEntryId };
  }
}
