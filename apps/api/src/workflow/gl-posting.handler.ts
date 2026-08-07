import { Injectable } from '@nestjs/common';
import { Prisma } from '@bioassetpro/database';
import { PostingService } from '../posting/posting.service';
import { kobo } from '../common/money';
import { AccountingRuleViolation } from '../common/errors';
import { WorkflowActor, WorkflowPostingHandler } from './workflow.types';

/**
 * The built-in handler for transaction types whose payload IS a journal.
 *
 * Manual journals, adjustments and reversals all fit this shape, so the engine
 * ships with one rather than making every such module write the same adapter.
 * Modules with their own document model (a PO, a payroll run) register their
 * own handler instead and build the PostingRequest from their own tables.
 *
 * Note it takes the actor from the APPROVER, not from the payload. Who posted
 * is a fact about the approval, and letting a stored payload name its own
 * poster would let a maker forge that attribution at submit time.
 */
@Injectable()
export class GlPostingHandler implements WorkflowPostingHandler {
  readonly transactionType = 'GL_JOURNAL';

  constructor(private readonly posting: PostingService) {}

  async post(input: {
    transactionId: string;
    documentReference: string;
    payload: Prisma.JsonValue;
    actor: WorkflowActor;
    tx: Prisma.TransactionClient;
  }): Promise<{ journalEntryId: string }> {
    const payload = input.payload as Record<string, unknown> | null;
    if (!payload || typeof payload !== 'object') {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Posting handler',
        `${input.documentReference} is configured to post on approval but carries no ` +
          `posting payload.`,
        { transactionId: input.transactionId },
      );
    }

    const lines = (payload.lines as Array<Record<string, unknown>> | undefined) ?? [];
    if (lines.length === 0) {
      throw new AccountingRuleViolation(
        'Consolidated Reference §2 — Posting handler',
        `${input.documentReference} has no journal lines to post.`,
        { transactionId: input.transactionId },
      );
    }

    const result = await this.posting.post(
      {
        sourceModule: String(payload.sourceModule ?? 'workflow'),
        sourceDocumentType: String(payload.sourceDocumentType ?? 'WorkflowTransaction'),
        sourceDocumentId: input.transactionId,
        journalNumber: String(payload.journalNumber),
        journalDate: new Date(String(payload.journalDate)),
        narration: String(payload.narration),
        companyId: String(payload.companyId),
        branchId: String(payload.branchId),
        financialYearId: String(payload.financialYearId),
        financialPeriodId: String(payload.financialPeriodId),
        currencyId: String(payload.currencyId),
        exchangeRate: String(payload.exchangeRate ?? '1.00000000'),
        // Rule 6: the workflow transaction id is a natural idempotency key —
        // one approved document can only ever produce one posting.
        idempotencyKey: `workflow:${input.transactionId}`,
        actor: input.actor,
        lines: lines.map((line) => ({
          glAccountId: String(line.glAccountId),
          description: String(line.description ?? ''),
          debit: line.debit !== undefined && line.debit !== null
            ? kobo(BigInt(String(line.debit)))
            : undefined,
          credit: line.credit !== undefined && line.credit !== null
            ? kobo(BigInt(String(line.credit)))
            : undefined,
          dimensions: line.dimensions as never,
        })),
      },
      input.tx,
    );

    return { journalEntryId: result.journalEntryId };
  }
}
