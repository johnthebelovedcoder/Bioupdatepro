/**
 * The Enterprise Dimension set — Consolidated Reference §1.1.
 *
 * One definition, used by every module. Procurement, Sales, Payroll and
 * Processing do not define their own; they populate this and hand it to the
 * PostingService.
 */

/** Mandatory on every GL-posting transaction, without exception. */
export interface MandatoryDimensions {
  companyId: string;
  branchId: string;
  financialYearId: string;
  financialPeriodId: string;
  currencyId: string;
  /** Decimal string. Stored as supplied; never recalculated after posting. */
  exchangeRate: string;
}

/** Configurable / conditional — required depending on account and context. */
export interface ManagementDimensions {
  departmentId?: string | null;
  costCentreId?: string | null;
  farmId?: string | null;
  penHouseId?: string | null;
  projectId?: string | null;
}

export type EnterpriseDimensions = MandatoryDimensions & ManagementDimensions;

export const MANDATORY_DIMENSION_KEYS = [
  'companyId',
  'branchId',
  'financialYearId',
  'financialPeriodId',
  'currencyId',
  'exchangeRate',
] as const satisfies readonly (keyof MandatoryDimensions)[];

/**
 * Human labels for error messages. A finance user reading "Cost Centre is
 * required" understands it; "costCentreId" is for us, not them.
 */
export const DIMENSION_LABELS: Record<string, string> = {
  companyId: 'Company',
  branchId: 'Branch',
  financialYearId: 'Financial Year',
  financialPeriodId: 'Financial Period',
  currencyId: 'Currency',
  exchangeRate: 'Exchange Rate',
  departmentId: 'Department',
  costCentreId: 'Cost Centre',
  farmId: 'Farm',
  penHouseId: 'Pen/House',
  projectId: 'Project',
};
