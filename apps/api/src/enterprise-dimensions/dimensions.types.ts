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

/**
 * Business dimensions — §1.1 "contextual".
 *
 * Never validated as required: a depreciation line has no customer and a sales
 * line has no employee. They matter because they are what makes a customer
 * statement, a supplier statement and item-level analysis derivable FROM the
 * ledger instead of maintained beside it.
 *
 * Added in Phase 10, once Phase 4 had delivered the master tables they point at.
 */
export interface BusinessDimensions {
  customerId?: string | null;
  supplierId?: string | null;
  employeeId?: string | null;
  itemId?: string | null;
}

export type EnterpriseDimensions = MandatoryDimensions &
  ManagementDimensions &
  BusinessDimensions;

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
  customerId: 'Customer',
  supplierId: 'Supplier',
  employeeId: 'Employee',
  itemId: 'Inventory Item',
};
