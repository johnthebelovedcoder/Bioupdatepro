import {
  Prisma,
  TaxTreatment,
  VatDirection,
  WhtDirection,
} from '@bioassetpro/database';
import { Kobo } from '../common/money';

/** What a caller asks the engine about one document line. */
export interface VatCalculationRequest {
  companyId: string;
  /** Code, not id — callers hold the code the item master carries. */
  taxCode: string;
  /**
   * The line amount. Whether this already includes VAT is decided by the tax
   * code's priceBasis, not by the caller, so the same code cannot be treated
   * inclusively in one module and exclusively in another.
   */
  amount: Kobo;
  /** Rate selection is date-driven; rates are effective-dated (Rule 8). */
  on: Date;
}

export interface VatCalculation {
  taxCodeId: string;
  taxCode: string;
  treatment: TaxTreatment;
  recoverable: boolean;
  appliedRate: string;
  /** The amount VAT was computed on. */
  taxableBaseKobo: bigint;
  taxKobo: bigint;
  /** base + tax, whatever the price basis was. */
  grossKobo: bigint;
  /** Plain-language account of what was applied, for the calculation trace. */
  explanation: string;
}

export interface WhtCalculationRequest {
  companyId: string;
  taxCode: string;
  /** The amount before VAT. */
  amount: Kobo;
  /** VAT on the same document, needed when the basis is gross-including-VAT. */
  vatAmount?: Kobo;
  on: Date;
}

export interface WhtCalculation {
  taxCodeId: string;
  taxCode: string;
  whtCategory: string;
  appliedRate: string;
  taxableBaseKobo: bigint;
  taxKobo: bigint;
  /** What the counterparty is actually paid after withholding. */
  netPayableKobo: bigint;
  explanation: string;
}

/** A whole document, so line rounding and the total agree by construction. */
export interface DocumentTaxRequest {
  companyId: string;
  on: Date;
  lines: Array<{
    lineNumber: number;
    taxCode: string;
    amount: Kobo;
  }>;
}

export interface DocumentTaxResult {
  lines: Array<VatCalculation & { lineNumber: number }>;
  totalTaxableBaseKobo: bigint;
  totalTaxKobo: bigint;
  totalGrossKobo: bigint;
}

/**
 * What the posting path hands back so the register can be written in the same
 * database transaction as the journal.
 */
export interface VatRegisterInput {
  companyId: string;
  branchId: string;
  direction: VatDirection;
  calculation: VatCalculation;
  sourceModule: string;
  sourceDocumentType: string;
  sourceDocumentId?: string | null;
  documentReference: string;
  documentDate: Date;
  counterpartyName?: string | null;
  counterpartyTin?: string | null;
  journalEntryId: string;
}

export interface WhtRegisterInput {
  companyId: string;
  branchId: string;
  direction: WhtDirection;
  calculation: WhtCalculation;
  grossAmountKobo: bigint;
  vatAmountKobo?: bigint;
  sourceModule: string;
  sourceDocumentType: string;
  sourceDocumentId?: string | null;
  documentReference: string;
  documentDate: Date;
  counterpartyName?: string | null;
  counterpartyTin?: string | null;
  creditNoteReference?: string | null;
  creditNoteDate?: Date | null;
  journalEntryId: string;
}

export interface TaxReconciliation {
  taxPeriodId: string;
  periodName: string;
  lines: Array<{
    direction: string;
    glAccountNumber: string;
    glAccountName: string;
    registerTaxKobo: string;
    ledgerBalanceKobo: string;
    differenceKobo: string;
    agrees: boolean;
  }>;
  agrees: boolean;
}

export type TaxTransactionClient = Prisma.TransactionClient;
