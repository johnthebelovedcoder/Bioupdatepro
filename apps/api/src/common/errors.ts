import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Accounting rule violations are their own error class so they are never
 * confused with ordinary validation failures. Every one of these represents a
 * hard rule from the source documents, and each carries the rule reference so
 * the message is auditable rather than merely apologetic.
 */
export class AccountingRuleViolation extends HttpException {
  constructor(
    readonly rule: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(
      {
        error: 'AccountingRuleViolation',
        rule,
        message,
        details,
      },
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

export class UnbalancedJournalError extends AccountingRuleViolation {
  constructor(totalDebit: bigint, totalCredit: bigint) {
    super(
      'GL: debits must equal credits',
      `Journal does not balance: debits ${totalDebit} kobo, credits ${totalCredit} kobo, ` +
        `difference ${totalDebit - totalCredit} kobo.`,
      { totalDebit: totalDebit.toString(), totalCredit: totalCredit.toString() },
    );
  }
}

export class MissingDimensionError extends AccountingRuleViolation {
  constructor(dimension: string, reason: string, lineNumber?: number) {
    super(
      'Consolidated Reference §1.1 — Enterprise Dimensions',
      `Dimension "${dimension}" is required${
        lineNumber !== undefined ? ` on line ${lineNumber}` : ''
      }: ${reason}`,
      { dimension, lineNumber },
    );
  }
}

export class ClosedPeriodError extends AccountingRuleViolation {
  constructor(periodName: string, status: string) {
    super(
      'Consolidated Reference §8 — Period status',
      `Financial period "${periodName}" is ${status} and will not accept this posting.`,
      { periodName, status },
    );
  }
}

export class PostedTransactionImmutableError extends AccountingRuleViolation {
  constructor(reference: string) {
    super(
      'Rule 2 — Posted transactions are immutable',
      `${reference} is posted and cannot be modified or deleted. ` +
        `Post a reversing or adjusting document instead.`,
      { reference },
    );
  }
}

export class MakerCheckerViolation extends AccountingRuleViolation {
  constructor(reference: string, userId: string) {
    super(
      'Rule 4 — Maker-checker',
      `User ${userId} created ${reference} and therefore cannot approve it.`,
      { reference, userId },
    );
  }
}

export class IdempotencyConflictError extends AccountingRuleViolation {
  constructor(scope: string, key: string) {
    super(
      'Rule 6 — Idempotency',
      `Idempotency key "${key}" was already used in scope "${scope}" with a ` +
        `different request body. Reusing a key with changed content is a caller bug.`,
      { scope, key },
    );
  }
}
