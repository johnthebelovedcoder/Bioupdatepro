import { Kobo } from '../common/money';
import { EnterpriseDimensions } from '../enterprise-dimensions/dimensions.types';

/**
 * The one and only shape in which anything enters the General Ledger.
 *
 * Procurement, Sales, Payroll, Processing and Period Close all build this and
 * hand it to PostingService.post(). No module writes journal rows itself.
 */
export interface PostingLine {
  glAccountId: string;
  description: string;
  /** Exactly one of debit/credit is non-zero. Both are non-negative. */
  debit?: Kobo;
  credit?: Kobo;
  dimensions: EnterpriseDimensions;
}

export interface PostingRequest {
  /** Which module produced this. Recorded for traceability, both directions. */
  sourceModule: string;
  sourceDocumentType: string;
  sourceDocumentId?: string | null;

  journalNumber: string;
  journalDate: Date;
  narration: string;

  /** Header-level mandatory dimensions. Lines inherit and may not contradict. */
  companyId: string;
  branchId: string;
  financialYearId: string;
  financialPeriodId: string;
  currencyId: string;
  exchangeRate: string;

  lines: PostingLine[];

  /** Rule 6. Required. */
  idempotencyKey: string;

  actor: {
    userId: string;
    roles: string[];
    ipAddress?: string | null;
    device?: string | null;
  };

  /** When set, this journal reverses the referenced one (Rule 2). */
  reversalOfId?: string | null;

  /**
   * Marks a year-end closing or opening entry, which is permitted into a CLOSED
   * period — see PeriodService.assertPostingAllowed. Set ONLY by YearEndService.
   * It is recorded on the audit record, so such a posting is never invisible.
   */
  isClosingEntry?: boolean;
}

export interface PostingResult {
  journalEntryId: string;
  journalNumber: string;
  /** True when an idempotent replay returned the original posting. */
  replayed: boolean;
  totalDebitKobo: bigint;
  totalCreditKobo: bigint;
}
